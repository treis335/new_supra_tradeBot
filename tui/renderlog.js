const { CONFIG } = require('../config/config');
const { arbLog } = require('../detector/arbDetector');
const { getActivityLog } = require('../tracker/tradeActivityTracker');

const DEX_LABELS = {
  DEXLYN: 'DLyn',
  DEXLYN_V3: 'DLV3',
  SPIKEY: 'Spky',
};

function getDexLabel(dex) {
  return DEX_LABELS[dex] || (dex ? dex.substring(0, 4) : '???');
}

function renderLog(opps, boxes) {
  const { logBox } = boxes;
  const now = new Date().toLocaleTimeString('pt-PT');
  for (const { cycle, result, score } of opps) {
    const pathParts = cycle.path.map((token, idx) => {
      const sym = CONFIG.tokens[token]?.symbol || token;
      if (idx === 0) return sym;
      const prevEdge = cycle.edges[idx - 1];
      const dexLabel = getDexLabel(prevEdge.pair.dex);
      return `[${dexLabel}] → ${sym}`;
    });
    const fullPath = pathParts.join(' ');

    arbLog.unshift({
      time: now,
      path: fullPath,
      profitPct: result.profitPct,
      profitAbs: result.profitAbs,
      score,
      symIn: CONFIG.tokens[cycle.path[0]]?.symbol || cycle.path[0],
    });
  }
  while (arbLog.length > CONFIG.arbLogMax) arbLog.pop();

  // Junta o log de oportunidades com a atividade de mercado real (trades de outros
  // traders detectados via mudanca de reservas entre ticks), ordenado por tempo,
  // para o painel nao ficar parado mesmo quando nao ha oportunidades novas.
  const activity = getActivityLog();
  const combined = [
    ...arbLog.map(e => ({ isArb: true, ...e })),
    ...activity.map(e => ({ isArb: false, ...e })),
  ];
  // arbLog e activityLog ja vem cada um ordenado do mais recente para o mais antigo,
  // e ambos foram populados no mesmo tick -- juntar mantendo essa ordem relativa e suficiente.

  const L = [];
  if (!combined.length) {
    L.push('{grey-fg} Aguardando actividade de mercado...{/}');
  } else {
    for (const e of combined.slice(0, CONFIG.arbLogMax + 15)) {
      if (e.isArb) {
        const color = e.score >= 70 ? 'bright-green' : e.score >= 40 ? 'yellow' : 'grey';
        L.push(
          `{grey-fg}${e.time}{/} {${color}-fg}◆ +${e.profitPct.toFixed(3)}%{/}` +
          ` {grey-fg}sc:${e.score}{/} {grey-fg}${e.path}{/}`
        );
      } else {
        L.push(e.text);
      }
    }
  }
  logBox.setContent(L.join('\n'));
  logBox.scrollTo(0);
}

module.exports = renderLog;