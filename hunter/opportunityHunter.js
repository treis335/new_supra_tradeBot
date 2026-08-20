// hunter/opportunityHunter.js
// Cérebro de caça a arbitragem — ranking inteligente + memória real
// CORRIGIDO: rejeita lucros impossíveis (>50%) — falsos positivos de simulação/decimais

const { CONFIG } = require('../config/config');
const { recordOpportunity, getHotRoutes, getDexPerformance } = require('./opportunityMemory');
const { logError } = require('../utils/logError');

const hunterState = {
  lastRun: null,
  totalSeen: 0,
  totalAboveThreshold: 0,
  totalRejectedInsane: 0,
  bestEverPct: 0,
  focusBoost: {}, // path -> multiplier aprendido
};

/**
 * Aplica boost inteligente com base no histórico real.
 * Rotas que consistentemente mostram edge recebem prioridade.
 * NÃO faz boost em rotas com avgProfit absurdo (bug histórico).
 */
function applyLearningBoost(opps) {
  const hot = getHotRoutes(2);
  const boostMap = {};

  for (const h of hot) {
    if (h.avgProfit > 50 || h.maxProfit > 50) continue;
    if (h.avgProfit > 0.15) boostMap[h.path] = 1.15;
    else if (h.avgProfit > 0.08) boostMap[h.path] = 1.08;
  }

  return opps
    .map((opp) => {
      const pathKey = (opp.cycle?.path || []).join('→');
      let mult = boostMap[pathKey] || 1;

      // Boost fixo para arbitragem triangular (3 hops)
      const hops = (opp.cycle?.path?.length || 1) - 1;
      if (hops === 3) mult *= 1.12;

      return {
        ...opp,
        score: Math.round((opp.score || 0) * mult),
        _learnedBoost: mult,
        _pathKey: pathKey,
        _hops: hops,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Filtra para focar em arbitragem de baixo risco e realista.
 * Preferência: ciclos curtos, lucro claro, liquidez decente, sem % impossíveis.
 */
/**
 * Filtra para focar em arbitragem triangular realista (3 hops).
 * 2-hop e 4-hop entram com regras mais estritas.
 */
function filterHighQualityArb(opps) {
  const minPct = CONFIG.minProfitPct || 0.1;
  const crossDexMin = CONFIG.autoExecute?.crossDexMinProfitPct || 2.0;
  const MAX_REALISTIC_PROFIT_PCT = 50;

  return opps.filter((opp) => {
    if (!opp.result) return false;

    const pct = Number(opp.result.profitPct);
    if (!Number.isFinite(pct)) return false;
    if (pct > MAX_REALISTIC_PROFIT_PCT) {
      hunterState.totalRejectedInsane++;
      return false;
    }
    if (pct < minPct) return false;
    if (!opp.result.endAmount || opp.result.endAmount <= 0) return false;
    if (opp.result.profitAbs != null && opp.result.profitAbs <= 0) return false;

    const hops = (opp.cycle?.path?.length || 1) - 1;
    // Foco: triangular = 3 hops | 2-hop ok | 4-hop só com lucro maior
    if (hops < 2 || hops > 4) return false;
    if (hops === 4 && pct < Math.max(minPct * 2, 0.4)) return false;

    const steps = opp.result.steps || [];
    if (steps.length === 0) return false;
    for (const s of steps) {
      if (!s.amtOut || s.amtOut <= 0) return false;
    }

    const dexes = new Set(steps.map((s) => s.dex).filter(Boolean));
    if (dexes.size > 1 && pct < crossDexMin) return false;

    for (const s of steps) {
      const ps = s.pair;
      if (!ps) continue;
      const rA = Number(ps.reserveA);
      const rB = Number(ps.reserveB);
      if (Number.isFinite(rA) && Number.isFinite(rB) && (rA <= 0 || rB <= 0)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Entrada principal do Hunter.
 * Recebe as opps do arbDetector e devolve lista refinada + grava memória.
 */
function hunt(opps = []) {
  try {
    hunterState.lastRun = new Date().toISOString();
    hunterState.totalSeen += opps.length;

    const quality = filterHighQualityArb(opps);
    hunterState.totalAboveThreshold += quality.length;

    // Gravar na memória apenas oportunidades realistas (não contaminar o histórico)
    for (const opp of quality.slice(0, 20)) {
      recordOpportunity(opp);
      if (opp.result.profitPct > hunterState.bestEverPct && opp.result.profitPct <= 50) {
        hunterState.bestEverPct = opp.result.profitPct;
      }
    }

    const ranked = applyLearningBoost(quality);

    return {
      opportunities: ranked,
      best: ranked[0] || null,
      stats: {
        seen: opps.length,
        quality: quality.length,
        rejectedInsane: hunterState.totalRejectedInsane,
        bestPct: ranked[0]?.result?.profitPct || 0,
        bestEverPct: hunterState.bestEverPct,
        hotRoutes: getHotRoutes(3).slice(0, 5),
        dexPerf: getDexPerformance().slice(0, 5),
      },
    };
  } catch (e) {
    logError('opportunityHunter.hunt', e);
    return { opportunities: opps, best: opps[0] || null, stats: {} };
  }
}

function getHunterState() {
  return { ...hunterState };
}

module.exports = {
  hunt,
  getHunterState,
  filterHighQualityArb,
  applyLearningBoost,
};