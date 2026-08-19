const asyncLimit = require('../utils/asyncLimit');
const { CONFIG } = require('../config/config');
const priceEngine = require('../dexes/dexlyn/dexlynEngine');
const priceEngineV3 = require('../dexes/dexlyn/dexlynEngineV3');
const spikeyEngine = require('../dexes/spikey/spikeyEngine');
const { SPIKEY_CONFIG } = require('../dexes/spikey/spikeyConfig');
const { discoverNewPools } = require('../dexes/spikey/spikeyDiscovery');
const { logEvent } = require('../intelligence/historyLogger');
const { analyzePerformance } = require('../intelligence/deepseekAnalyst');
const graphEngine = require('../engine/graphEngine');
const { arbDetector } = require('../detector/arbDetector');
const { logError } = require('../utils/logError');
const renderPrices = require('../tui/renderPrices');
const { trackActivity } = require('../tracker/tradeActivityTracker');
const renderArb = require('../tui/renderArb');
const renderLog = require('../tui/renderlog');
const { renderFooter, setRpcHealthy } = require('../tui/renderFooter');
const { fetchWalletBalance } = require('../utils/walletBalance');

let bestOpportunity = null;
let currentOpps = [];

function taskWithTimeout(task, ms = 20000) {
    return Promise.race([
        task,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Task timeout')), ms)
        )
    ]);
}

let lastAutoTxTime = 0;
let autoTxInProgress = false;
let tickCounter = 0;

// Escolhe o executor certo consoante os DEXs envolvidos no ciclo.
// ANTES: chamava sempre dexlynExecute (modulo Dexlyn) mesmo para ciclos com
// pools Spikey/Atmos/Dfmm/Evo -> essas transacoes falhavam ou nunca eram tentadas
// corretamente, o que reduzia drasticamente o numero de trades bem sucedidos.
function pickExecutor(opp) {
    const dexesInCycle = new Set(opp.result.steps.map(s => s.dex));
    const onlyDexlyn = [...dexesInCycle].every(d => d === 'DEXLYN' || d === 'DEXLYN_V3');
    const onlySpikey = [...dexesInCycle].every(d => d === 'SPIKEY');
    const isCrossDex = [...dexesInCycle].every(d => d === 'DEXLYN' || d === 'SPIKEY') && dexesInCycle.size > 1;

    if (onlyDexlyn) return { execute: require('../dexes/dexlyn/dexlynExecute').executeArbitrage, label: 'DEXLYN' };
    if (onlySpikey) return { execute: require('../dexes/spikey/spikeyExecute').executeSpikeySwap, label: 'SPIKEY' };

    // Cross-DEX (Dexlyn+Spikey no mesmo ciclo): executa legs SEPARADAS, NAO atomico.
    // Ha risco real de o preco se mover entre legs. So aceita se o lucro estimado
    // tiver uma margem extra (cfg.crossDexMinProfitPct), para absorver esse risco.
    if (isCrossDex) {
        if (opp.result.profitPct < (CONFIG.autoExecute.crossDexMinProfitPct || 1.0)) return null;
        return { execute: require('../executor/crossDexExecute').executeCrossDexArbitrage, label: 'CROSS-DEX (não-atómico)' };
    }

    // Envolve DEXLYN_V3 misturado com outra DEX, ou outros DEXs nao suportados: nao arrisca.
    return null;
}

async function maybeAutoExecute(opps, balances, boxes) {
    const cfg = CONFIG.autoExecute;
    if (!cfg || !cfg.enabled) return;
    if (autoTxInProgress) return;

    const now = Date.now();
    if (now - lastAutoTxTime < cfg.cooldownMs) return;
    if (!opps || opps.length === 0) return;

    let availableSUPRA = Math.max(0, (balances.SUPRA || 0) - cfg.gasReserveSUPRA);

    const viableOpps = opps.filter(opp => {
        const tokenIn = opp.cycle.path[0];
        if (tokenIn !== 'SUPRA') return false;
        if (opp.result.profitPct < cfg.minProfitPct) return false;
        if (opp.score < cfg.minScore) return false;
        if (opp.optimalAmount > availableSUPRA) return false;
        if (!pickExecutor(opp)) return false; // so mantem ciclos com executor funcional
        return true;
    });

    if (viableOpps.length === 0) return;

    autoTxInProgress = true;
    lastAutoTxTime = now;

    const log = (msg) => {
        boxes.footerBox.setContent(msg);
        boxes.screen.render();
    };

    const maxPerTick = cfg.maxTradesPerTick || 3;
    let executed = 0;

    for (const opp of viableOpps) {
        if (executed >= maxPerTick) break;
        if (opp.optimalAmount > availableSUPRA) continue; // saldo ja usado neste tick

        const executor = pickExecutor(opp);
        const pathLabel = opp.cycle.path.map(t => CONFIG.tokens[t]?.symbol || t).join(' → ');
        log(`{yellow-fg}🤖 Auto-execução [${executor.label}]: ${pathLabel} (+${opp.result.profitPct.toFixed(3)}%){/}`);

        try {
            const res = await executor.execute(opp, () => {});
            if (res && res.txHash) {
                log(`{green-fg}✅ Sucesso! Tx: ${res.txHash.slice(0,10)}...{/}`);
                availableSUPRA -= opp.optimalAmount;
                executed++;
                logEvent('trade_executed', {
                    dex: executor.label, path: pathLabel,
                    profitPct: opp.result.profitPct, profitAbs: opp.result.profitAbs,
                    amount: opp.optimalAmount, txHash: res.txHash, success: true,
                });
            } else {
                log(`{red-fg}❌ Falhou: ${pathLabel}{/}`);
                logEvent('trade_executed', {
                    dex: executor.label, path: pathLabel,
                    profitPct: opp.result.profitPct, amount: opp.optimalAmount, success: false,
                });
            }
        } catch (e) {
            log(`{red-fg}❌ Erro: ${e.message}{/}`);
            logEvent('trade_executed', {
                dex: executor.label, path: pathLabel, success: false, error: e.message,
            });
        }
    }

    // 🔥 Removida a lógica que desligava o automático após falhas consecutivas.
    // O bot permanece em modo AUTO até que o utilizador pressione a tecla 'a'.

    autoTxInProgress = false;
}

async function tick(boxes) {
    const t0 = Date.now();
    const limit = asyncLimit(CONFIG.maxConcurrent);

    // Descoberta automatica de pools novos na Spikey. Corre a cada N ticks (nao todos,
    // para nao sobrecarregar o RPC) -- 100% automatico, zero trabalho manual.
    tickCounter++;
    const DISCOVERY_EVERY_N_TICKS = 30; // com pollingMs=2000, ~1 minuto
    if (tickCounter % DISCOVERY_EVERY_N_TICKS === 0) {
        discoverNewPools((msg) => {
            if (boxes?.footerBox) {
                boxes.footerBox.setContent(msg);
                boxes.screen.render();
            }
        }).then(res => {
            if (res && res.added > 0) logEvent('pools_discovered', { count: res.added });
        }).catch(e => logError('discoverNewPools', e));
    }

    // Analista de performance (DeepSeek): corre a cada ~2h (nao a cada tick -- e uma
    // analise de tendencias, nao uma decisao de trade individual). Ajusta parametros
    // dentro de limites seguros com base no que realmente performou.
    const ANALYST_EVERY_N_TICKS = Math.floor((2 * 3600 * 1000) / (CONFIG.pollingMs || 2000));
    if (tickCounter % ANALYST_EVERY_N_TICKS === 0) {
        analyzePerformance((msg) => {
            if (boxes?.footerBox) {
                boxes.footerBox.setContent(msg);
                boxes.screen.render();
            }
        }).catch(e => logError('analyzePerformance', e));
    }

    const tasks = [];

    // ═══ 1. Dexlyn V2 ═══
    for (const [dexKey, dex] of Object.entries(CONFIG.dexes)) {
        for (const [tokenA, tokenB, curve] of dex.pairs) {
            tasks.push(limit(() =>
                taskWithTimeout(
                    priceEngine.fetchPairState(dexKey, tokenA, tokenB, curve),
                    20000
                ).catch(e => {
                    logError(`fetchPair ${tokenA}/${tokenB}`, e);
                    return null;
                })
            ));
        }
    }

    // ═══ 2. Dexlyn V3 ═══
    if (CONFIG.v3Pools && CONFIG.v3Pools.pools && CONFIG.v3Pools.pools.length > 0) {
        for (const v3pool of CONFIG.v3Pools.pools) {
            tasks.push(limit(() =>
                taskWithTimeout(
                    (async () => {
                        const state = await priceEngineV3.fetchPoolState(v3pool.address, v3pool.tokenA, v3pool.tokenB);
                        if (!state) return null;
                        return {
                            dex: 'DEXLYN_V3',
                            tokenA: v3pool.tokenA,
                            tokenB: v3pool.tokenB,
                            curve: 'clmm',
                            poolAddress: v3pool.address,
                            state: state,
                            reserveA: state.assetA,
                            reserveB: state.assetB,
                            fee: state.feeRate,
                            feeScale: 1000000,
                            priceAinB: priceEngineV3.getPrice(state, 'AB'),
                            _simulate: (direction, amountIn) => priceEngineV3.simulateTrade(state, direction, amountIn)
                        };
                    })(),
                    20000
                ).catch(e => {
                    logError(`fetchPoolV3 ${v3pool.address}`, e);
                    return null;
                })
            ));
        }
    }

    // ═══ 3. Spikey ═══
    if (SPIKEY_CONFIG && SPIKEY_CONFIG.pools && SPIKEY_CONFIG.pools.length > 0) {
        for (const pool of SPIKEY_CONFIG.pools) {
            if (pool.active === false) continue; // pool em quarentena pelo analista -- nao negoceia
            tasks.push(limit(() =>
                taskWithTimeout(
                    spikeyEngine.fetchPairState(pool.address, pool.tokenA, pool.tokenB),
                    20000
                ).catch(e => {
                    logError(`fetchSpikeyPair ${pool.address}`, e);
                    return null;
                })
            ));
        }
    }

    let pairStates, graph, cycles, opps;
    try {
        pairStates = await Promise.all(tasks);
        pairStates = pairStates.flat().filter(Boolean);
        setRpcHealthy(pairStates.length > 0);
    } catch (e) {
        logError('Promise.all pairStates', e);
        pairStates = [];
        setRpcHealthy(false);
    }

    await new Promise(resolve => setImmediate(resolve));

    try {
        graph = graphEngine.buildGraph(pairStates);
        cycles = graphEngine.findCycles(graph, 4);
    } catch (e) {
        logError('buildGraph/findCycles', e);
        graph = {};
        cycles = [];
    }

    try {
        opps = arbDetector.analyzeAll(cycles);
        bestOpportunity = opps[0] || null;
        currentOpps = opps;
    } catch (e) {
        logError('analyzeAll', e);
        opps = [];
        bestOpportunity = null;
        currentOpps = [];
    }

    // Snapshot periodico das oportunidades vistas (nao a cada tick -- ficheiro cresceria
    // demasiado rapido). Serve de contexto para o analista perceber o "estado geral do
    // mercado" ao longo do tempo, nao so as trades que executamos.
    const SNAPSHOT_EVERY_N_TICKS = 15; // ~30s
    if (tickCounter % SNAPSHOT_EVERY_N_TICKS === 0 && opps.length > 0) {
        logEvent('opportunity_snapshot', {
            count: opps.length,
            bestProfitPct: opps[0]?.result.profitPct || 0,
            bestScore: opps[0]?.score || 0,
            crossDexCount: opps.filter(o => new Set(o.result.steps.map(s => s.dex)).size > 1).length,
        });
    }

    const walletBalances = process.env.SENDER_ADDRESS
        ? await fetchWalletBalance(process.env.SENDER_ADDRESS).catch(() => ({}))
        : {};

    if (CONFIG.autoExecute && CONFIG.autoExecute.enabled) {
        await maybeAutoExecute(opps, walletBalances, boxes).catch(e => logError('autoExecute', e));
    }

    try { renderPrices(pairStates, boxes, walletBalances); } catch (e) { logError('renderPrices', e); }
    try { trackActivity(pairStates); } catch (e) { logError('trackActivity', e); }
    try { renderArb(opps, boxes); } catch (e) { logError('renderArb', e); }
    try { renderLog(opps, boxes); } catch (e) { logError('renderLog', e); }
    try { renderFooter(opps, Date.now() - t0, boxes); } catch (e) { logError('renderFooter', e); }

    try { boxes.screen.render(); } catch {}
}

function getBestOpportunity() { return bestOpportunity; }
function getOpps() { return currentOpps || []; }

module.exports = { tick, getBestOpportunity, getOpps };