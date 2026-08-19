// dexes/spikey/spikeyDiscovery.js
//
// Descoberta 100% automatica de pools novos na Spikey. Diferente da Atmos, a Spikey
// tem um factory on-chain com uma funcao real "lista tudo" (amm_factory::all_pairs),
// e o standard Fungible Asset da Move framework tem funcoes universais para ler o
// simbolo e as casas decimais de qualquer token diretamente da blockchain
// (0x1::fungible_asset::symbol / decimals). Por isso, ao contrario da Atmos, aqui
// nao e preciso nenhum input manual, nem sequer mapear contra CONFIG.tokens.
//
// Isto corre automaticamente dentro do loop do bot (ver loop/tick.js) a cada
// DISCOVERY_INTERVAL_TICKS ticks -- nao precisas de correr nada a mao.

const fs = require('fs');
const path = require('path');
const callView = require('../../utils/callView');
const { logError } = require('../../utils/logError');
const { SPIKEY_CONFIG } = require('./spikeyConfig');

const POOLS_FILE = path.join(__dirname, '..', '..', 'spikeyPools.json');
const FA_MODULE = '0x1::fungible_asset';

async function getTokenInfo(metadataAddress) {
    const [symbolRes, decimalsRes] = await Promise.all([
        callView(FA_MODULE, 'symbol', [], [metadataAddress]),
        callView(FA_MODULE, 'decimals', [], [metadataAddress]),
    ]);
    const symbol = Array.isArray(symbolRes) ? symbolRes[0] : symbolRes;
    const decimalsRaw = Array.isArray(decimalsRes) ? decimalsRes[0] : decimalsRes;
    return {
        symbol: String(symbol),
        decimals: Math.pow(10, Number(decimalsRaw)),
        metadataAddress,
    };
}

async function discoverNewPools(log = () => {}) {
    try {
        const allPairAddresses = await callView(SPIKEY_CONFIG.routerAddress, 'amm_factory::all_pairs', [], []);
        if (!allPairAddresses || !Array.isArray(allPairAddresses)) {
            logError('spikeyDiscovery', new Error('all_pairs nao devolveu um array'));
            return { added: 0 };
        }

        const existingPools = SPIKEY_CONFIG.pools || [];
        const knownAddresses = new Set(existingPools.map(p => p.address.toLowerCase()));
        const newAddresses = allPairAddresses.filter(addr => !knownAddresses.has(addr.toLowerCase()));

        if (newAddresses.length === 0) return { added: 0 };

        log(`{yellow-fg}🔍 Spikey: ${newAddresses.length} pool(s) novo(s) detectado(s), a identificar tokens...{/}`);

        const newPools = [];
        for (const address of newAddresses) {
            try {
                const [meta0, meta1] = await Promise.all([
                    callView(SPIKEY_CONFIG.routerAddress, 'amm_router::token0', [], [address]),
                    callView(SPIKEY_CONFIG.routerAddress, 'amm_router::token1', [], [address]),
                ]);
                const m0 = (meta0?.inner || meta0?.[0]?.inner || meta0?.[0] || meta0);
                const m1 = (meta1?.inner || meta1?.[0]?.inner || meta1?.[0] || meta1);

                const [tokenA, tokenB] = await Promise.all([getTokenInfo(m0), getTokenInfo(m1)]);

                newPools.push({
                    address,
                    tokenA: tokenA.symbol,
                    tokenB: tokenB.symbol,
                    decimalsA: tokenA.decimals,
                    decimalsB: tokenB.decimals,
                    discovered: true,
                    discoveredAt: new Date().toISOString(),
                });

                log(`{green-fg}  ✅ Novo pool: ${tokenA.symbol}/${tokenB.symbol} (${address.slice(0, 8)}...){/}`);
            } catch (e) {
                logError(`spikeyDiscovery pool ${address}`, e);
            }
        }

        if (newPools.length === 0) return { added: 0 };

        const merged = [...existingPools, ...newPools];
        fs.writeFileSync(POOLS_FILE, JSON.stringify(merged, null, 2));
        SPIKEY_CONFIG.pools = merged; // atualiza em memoria tambem, sem precisar de reiniciar o bot

        log(`{green-fg}✅ Spikey: ${newPools.length} pool(s) novo(s) adicionado(s) automaticamente ao bot.{/}`);
        return { added: newPools.length };
    } catch (e) {
        logError('spikeyDiscovery', e);
        return { added: 0, error: e.message };
    }
}

module.exports = { discoverNewPools };
