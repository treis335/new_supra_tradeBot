// intelligence/generated/spikeyCrossDexScoreModifier.js
//
// Score modifier para o hook 'score_modifier' do componentRegistry.
// Contrato obrigatório:  modifyScore(opp, context) → number (fator)
// O registry já prende o fator entre 0.5x e 2.0x.
//
// Regras (dados reais da opp, sem I/O, sem rede, sem wallet):
// - Ciclos com SPIKEY e/ou CROSS-DEX recebem ajuste fino.
// - Cross-DEX exige margem maior; se o lucro for fraco, penaliza.
// - Triangular (3 hops) com Spikey recebe boost suave.
// - % impossíveis ou dados inválidos → fator neutro 1.0 (Hunter já filtra).

/**
 * Extrai os DEXs únicos das legs da oportunidade.
 * @param {object} opp
 * @returns {string[]}
 */
function getDexes(opp) {
  const steps = opp?.result?.steps || [];
  return [...new Set(steps.map((s) => s.dex).filter(Boolean))];
}

/**
 * Número de hops do ciclo (path length - 1).
 * @param {object} opp
 * @returns {number}
 */
function getHops(opp) {
  const path = opp?.cycle?.path;
  if (!Array.isArray(path) || path.length < 2) return 0;
  return path.length - 1;
}

/**
 * Liquidez aproximada das legs (mínimo de reserveA/reserveB quando existirem).
 * Usado só como sinal relativo, não como valor em USDC.
 * @param {object} opp
 * @returns {number}
 */
function minStepLiquidity(opp) {
  const steps = opp?.result?.steps || [];
  let min = Infinity;
  for (const s of steps) {
    const ps = s.pair || s;
    const a = Number(ps.reserveA);
    const b = Number(ps.reserveB);
    if (Number.isFinite(a) && a > 0) min = Math.min(min, a);
    if (Number.isFinite(b) && b > 0) min = Math.min(min, b);
  }
  return Number.isFinite(min) ? min : 0;
}

/**
 * Ponto de entrada do registry.
 * @param {object} opp - oportunidade do arbDetector / hunter
 * @param {object} context - { history } (opcional; não obrigatório)
 * @returns {number} fator multiplicativo do score (idealmente ~0.7–1.4)
 */
function modifyScore(opp, context = {}) {
  try {
    if (!opp || !opp.result) return 1.0;

    const pct = Number(opp.result.profitPct);
    if (!Number.isFinite(pct) || pct <= 0) return 1.0;
    // Segurança: não mexer em outliers (o Hunter já rejeita >50)
    if (pct > 50) return 1.0;

    const dexes = getDexes(opp);
    const hasSpikey = dexes.some((d) => String(d).toUpperCase().includes('SPIKEY'));
    const hasDexlyn = dexes.some((d) => String(d).toUpperCase().includes('DEXLYN'));
    const isCrossDex = hasSpikey && hasDexlyn;
    const onlySpikey = hasSpikey && !hasDexlyn;
    const hops = getHops(opp);
    const liq = minStepLiquidity(opp);

    let factor = 1.0;

    // --- Cross-DEX (Dexlyn + Spikey): não atómico → exigir margem ---
    if (isCrossDex) {
      if (pct >= 3.0) factor *= 1.18;
      else if (pct >= 2.0) factor *= 1.08;
      else if (pct >= 1.0) factor *= 0.92;
      else factor *= 0.75; // abaixo de 1% em cross-DEX: desprioritizar
    }

    // --- Só Spikey: boost moderado se lucro saudável ---
    if (onlySpikey) {
      if (pct >= 0.5) factor *= 1.12;
      else if (pct >= 0.25) factor *= 1.05;
    }

    // --- Triangular (3 hops) com Spikey no ciclo ---
    if (hasSpikey && hops === 3) {
      factor *= 1.10;
    }

    // --- 4 hops: mais slippage → penalização leve ---
    if (hops >= 4) {
      factor *= 0.92;
    }

    // --- Liquidez muito baixa nas legs → cautela ---
    // (thresholds relativos; pools secos já devem ter sido filtrados no tick)
    if (liq > 0 && liq < 100) {
      factor *= 0.85;
    } else if (liq >= 10000) {
      factor *= 1.05;
    }

    // --- Histórico opcional (se context.history tiver trades da mesma rota) ---
    const pathKey = (opp.cycle?.path || []).join('→');
    const history = context.history;
    if (pathKey && Array.isArray(history) && history.length > 0) {
      const related = history.filter((h) => {
        if (!h || h.type !== 'trade_executed') return false;
        const p = h.path || h.data?.path || '';
        return String(p).includes(pathKey.split('→')[0]) || String(p) === pathKey;
      });
      if (related.length >= 3) {
        const ok = related.filter((h) => h.success === true || h.data?.success === true).length;
        const rate = ok / related.length;
        if (rate >= 0.6) factor *= 1.12;
        else if (rate < 0.3) factor *= 0.80;
      }
    }

    // Clamp suave local (o registry volta a prender em 0.5–2.0)
    if (!Number.isFinite(factor) || factor <= 0) return 1.0;
    return Math.max(0.55, Math.min(1.45, factor));
  } catch {
    return 1.0;
  }
}

module.exports = {
  modifyScore,
  // aliases úteis para testes / propostas
  scoreModifier: modifyScore,
  getDexes,
  getHops,
};