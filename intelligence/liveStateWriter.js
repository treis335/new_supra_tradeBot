// intelligence/liveStateWriter.js
//
// O TUI (loop/tick.js) e o dashboard web (dashboard-web/server.js) correm como
// processos Node separados -- nao partilham memoria. Para o dashboard mostrar
// dados REAIS (nao inventados), o TUI escreve aqui um retrato do estado atual
// a cada tick, e o dashboard le este ficheiro em vez de gerar numeros aleatorios.

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'data', 'live_state.json');

function ensureDataDir() {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeLiveState({ walletBalances, pairStates, opps, tickCounter, recentTrades }) {
    try {
        ensureDataDir();
        const state = {
            updatedAt: new Date().toISOString(),
            running: true,
            walletBalances: walletBalances || {},
            pairCount: (pairStates || []).length,
            // Nao gravamos TODOS os pares a cada tick (ficheiro ficaria grande demais
            // sendo reescrito 0.5x/seg) -- so um resumo representativo.
            topPairs: (pairStates || []).slice(0, 20).map(ps => ({
                dex: ps.dex, tokenA: ps.tokenA, tokenB: ps.tokenB, priceAinB: ps.priceAinB,
            })),
            opportunityCount: (opps || []).length,
            bestOpportunity: opps && opps[0] ? {
                profitPct: opps[0].result.profitPct,
                score: opps[0].score,
                path: opps[0].cycle.path?.join(' → '),
            } : null,
            tickCounter,
            recentTrades: recentTrades || [],
        };
        // Escrita atomica (escreve para ficheiro temporario, depois renomeia) para o
        // dashboard nunca ler um JSON a meio de ser escrito (ficheiro corrompido).
        const tmpFile = STATE_FILE + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
        fs.renameSync(tmpFile, STATE_FILE);
    } catch (e) {
        // nunca deixar isto derrubar o loop principal do bot
        console.error('[liveStateWriter] falha:', e.message);
    }
}

function readLiveState() {
    try {
        if (!fs.existsSync(STATE_FILE)) return null;
        const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        // Se o ficheiro nao for atualizado ha mais de 15s, o bot provavelmente nao esta a correr
        const ageMs = Date.now() - new Date(data.updatedAt).getTime();
        data.running = ageMs < 15000;
        data.staleForMs = ageMs;
        return data;
    } catch (e) {
        return null;
    }
}

module.exports = { writeLiveState, readLiveState };
