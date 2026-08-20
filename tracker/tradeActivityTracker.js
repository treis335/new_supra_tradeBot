// tracker/tradeActivityTracker.js
//
// O bot ja busca as reservas de cada pool a cada tick (2s), mas so mostra o
// "estado atual" -- nao destaca quando uma trade real aconteceu entretanto
// (de outro trader qualquer, nao do nosso bot). Isto compara as reservas do
// tick anterior com as do tick atual: se mudaram, uma trade aconteceu on-chain
// nesse pool entre os dois ticks. Nao inventa nada -- e so a diferenca de
// dados que ja estavamos a receber, agora exposta como "evento" em vez de
// ficar escondida dentro de um numero que muda silenciosamente.

const { CONFIG } = require('../config/config');

const previousReserves = new Map(); // key -> { reserveA, reserveB }
const activityLog = [];
const MAX_ACTIVITY_LOG = 30;

// Filtra ruido: variacoes minusculas (arredondamento, taxas acumuladas) nao contam como trade
const MIN_CHANGE_PCT = 0.02; // 0.02% de variacao minima na reserva para contar

function getDexLabel(dex) {
    const labels = { DEXLYN: 'DLyn', DEXLYN_V3: 'DLV3', SPIKEY: 'Spky' };
    return labels[dex] || (dex ? dex.substring(0, 4) : '???');
}

function fmtAmount(n) {
    if (n >= 1000) return n.toFixed(0);
    if (n >= 1) return n.toFixed(2);
    return n.toFixed(4);
}

function trackActivity(pairStates) {
    const now = new Date().toLocaleTimeString('pt-PT');
    let newEvents = 0;

    for (const ps of pairStates) {
        if (!ps || !ps.tokenA || !ps.tokenB || ps.reserveA == null || ps.reserveB == null) continue;

        const key = `${ps.dex || 'UNK'}_${ps.tokenA}_${ps.tokenB}_${ps.curve || 'unknown'}_${ps.pairAddress || ''}`;
        const prev = previousReserves.get(key);

        previousReserves.set(key, { reserveA: ps.reserveA, reserveB: ps.reserveB });

        if (!prev) continue; // primeira vez a ver este par, nao ha "antes" para comparar

        const deltaA = ps.reserveA - prev.reserveA;
        if (prev.reserveA === 0) continue;
        const pctChange = Math.abs(deltaA / prev.reserveA) * 100;

        if (pctChange < MIN_CHANGE_PCT) continue; // ruido, ignora

        const decA = CONFIG.tokens[ps.tokenA]?.decimals || (ps.decA) || 1e6;
        const decB = CONFIG.tokens[ps.tokenB]?.decimals || (ps.decB) || 1e6;

        // Reserva de A subiu -> alguem VENDEU A (comprou B). Reserva de A desceu -> alguem COMPROU A.
        const isBuyA = deltaA < 0;
        const amountA = Math.abs(deltaA) / decA;
        const approxAmountB = amountA * (ps.priceAinB || (ps.reserveB / decB) / (ps.reserveA / decA));

        const dexLabel = getDexLabel(ps.dex);
        const action = isBuyA
            ? `{green-fg}COMPROU{/} ${fmtAmount(amountA)} {bold}${ps.tokenA}{/} {grey-fg}(pagou ~${fmtAmount(approxAmountB)} ${ps.tokenB}){/}`
            : `{red-fg}VENDEU{/} ${fmtAmount(amountA)} {bold}${ps.tokenA}{/} {grey-fg}(recebeu ~${fmtAmount(approxAmountB)} ${ps.tokenB}){/}`;

        activityLog.unshift({
            time: now,
            ts: Date.now(),
            type: 'trade',
            text: `{grey-fg}${now}{/} {magenta-fg}[${dexLabel}]{/} ${action} {grey-fg}${ps.tokenA}/${ps.tokenB}{/}`,
        });
        newEvents++;
    }

    while (activityLog.length > MAX_ACTIVITY_LOG) activityLog.pop();
    return newEvents;
}

function getActivityLog() {
    return activityLog;
}

module.exports = { trackActivity, getActivityLog };
