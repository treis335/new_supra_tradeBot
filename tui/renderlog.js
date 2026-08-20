const { CONFIG } = require('../config/config');
const { arbLog } = require('../detector/arbDetector');
const { getActivityLog } = require('../tracker/tradeActivityTracker');
const { getSystemLog } = require('./systemLog');

const DEX_LABELS = {
  DEXLYN: 'DLyn',
  DEXLYN_V3: 'DLV3',
  SPIKEY: 'Spky',
};

function getDexLabel(dex) {
  return DEX_LABELS[dex] || (dex ? dex.substring(0, 4) : '???');
}

// Evita relogar a MESMA oportunidade a cada tick (2s) enquanto ela persistir --
// isso e o que fazia o painel parecer cheio de "trades" quando era so a mesma
// deteccao repetida. So regista de novo se a rota for nova, ou se ja passou
// tempo suficiente desde a ultima vez que essa rota foi registada (heartbeat).
const lastLoggedByRoute = new Map(); // routeKey -> timestamp
const REPEAT_LOG_INTERVAL_MS = 60000; // 1 minuto -- "ainda ativa" em vez de spam a cada 2s

function renderLog(opps, boxes) {
  const { logBox } = boxes;
  const now = new Date().toLocaleTimeString('pt-PT');
  const nowMs = Date.now();

  for (const { cycle, result, score } of opps) {
    const pathParts = cycle.path.map((token, idx) => {
      const sym = CONFIG.tokens[token]?.symbol || token;
      if (idx === 0) return sym;
      const prevEdge = cycle.edges[idx - 1];
      const dexLabel = getDexLabel(prevEdge.pair.dex);
      return `[${dexLabel}] → ${sym}`;
    });
    const fullPath = pathParts.join(' ');
    const routeKey = cycle.path.join('>');

    const lastLogged = lastLoggedByRoute.get(routeKey);
    if (lastLogged && (nowMs - lastLogged) < REPEAT_LOG_INTERVAL_MS) continue; // ja visto recentemente, nao repete
    lastLoggedByRoute.set(routeKey, nowMs);

    arbLog.unshift({
      time: now,
      ts: Date.now(),
      path: fullPath,
      profitPct: result.profitPct,
      profitAbs: result.profitAbs,
      score,
      symIn: CONFIG.tokens[cycle.path[0]]?.symbol || cycle.path[0],
    });
  }
  while (arbLog.length > CONFIG.arbLogMax) arbLog.pop();

  // Junta 3 fontes de eventos, ordenadas por tempo: oportunidades detectadas,
  // atividade real de mercado (outros traders), e mensagens de sistema
  // (analista, descoberta de pools, execucoes) -- que antes so apareciam
  // (e desapareciam) no rodape, sem ficarem visiveis a tempo de leres.
  const activity = getActivityLog();
  const systemMsgs = getSystemLog();
  const combined = [
    ...arbLog.map(e => ({ kind: 'arb', ...e })),
    ...activity.map(e => ({ kind: 'activity', ...e })),
    ...systemMsgs.map(e => ({ kind: 'system', ...e })),
  ].sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const L = [];
  if (!combined.length) {
    L.push('{grey-fg} Aguardando actividade de mercado...{/}');
  } else {
    for (const e of combined.slice(0, CONFIG.arbLogMax + 20)) {
      if (e.kind === 'arb') {
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