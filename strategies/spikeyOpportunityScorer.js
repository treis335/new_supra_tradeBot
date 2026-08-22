// spikeyOpportunityScorer.js
// Módulo de análise pura para avaliar oportunidades de arbitragem no DEX SPIKEY.
// Recebe dados de pools e trades históricos, devolve um score de oportunidade.
// Não lê/escreve ficheiros, não faz chamadas de rede, não executa trades.

/**
 * Calcula um score de oportunidade (0-100) para um par de tokens no SPIKEY.
 * @param {Object} poolData - Dados da pool no SPIKEY: { tokenA, tokenB, priceA, priceB, liquidity, volume24h }
 * @param {Object} dexlynData - Dados da pool equivalente no DEXLYN: { priceA, priceB, liquidity, volume24h }
 * @param {Object} history - Histórico de trades do par: { totalTrades, successRate, avgProfitPct }
 * @returns {Object} - { score, spreadPct, liquidityScore, volumeScore, historyScore, confidence, recommendation }
 */
function scoreSpikeyOpportunity(poolData, dexlynData, history) {
  // Validação básica de entradas
  if (!poolData || !dexlynData || !history) {
    throw new Error('Dados incompletos para calcular score');
  }

  // 1. Calcular spread percentual entre DEXs (assumindo mesmo par de tokens)
  const priceSpikey = (poolData.priceA + poolData.priceB) / 2;
  const priceDexlyn = (dexlynData.priceA + dexlynData.priceB) / 2;
  if (priceSpikey <= 0 || priceDexlyn <= 0) {
    return { score: 0, spreadPct: 0, liquidityScore: 0, volumeScore: 0, historyScore: 0, confidence: 0, recommendation: 'Preço inválido' };
  }
  const spreadPct = Math.abs(priceSpikey - priceDexlyn) / Math.min(priceSpikey, priceDexlyn) * 100;

  // 2. Score de liquidez (0-25): quanto maior a liquidez, melhor
  const liquidityScore = Math.min(25, (poolData.liquidity / 10000) * 25); // assume liquidez em USD

  // 3. Score de volume (0-25): volume alto indica atividade e menor slippage
  const volumeScore = Math.min(25, (poolData.volume24h / 50000) * 25);

  // 4. Score de histórico (0-25): baseado em trades passados
  let historyScore = 0;
  if (history.totalTrades > 0) {
    const successFactor = history.successRate || 0;
    const profitFactor = Math.min(1, (history.avgProfitPct || 0) / 5); // normaliza lucro médio
    historyScore = (successFactor * 0.6 + profitFactor * 0.4) * 25;
  }

  // 5. Score de spread (0-25): spread mínimo de 2% para ser interessante
  const spreadScore = Math.max(0, Math.min(25, (spreadPct - 2) * 5));

  // Score total (0-100)
  const score = liquidityScore + volumeScore + historyScore + spreadScore;

  // Confiança: baseada em volume de dados e consistência
  const confidence = Math.min(1, (history.totalTrades / 10) * 0.5 + (poolData.volume24h / 100000) * 0.3 + (poolData.liquidity / 50000) * 0.2);

  // Recomendação simples
  let recommendation;
  if (score >= 70 && spreadPct >= 2) {
    recommendation = 'Alta oportunidade: considerar configurar SPIKEY para este par';
  } else if (score >= 40 && spreadPct >= 1) {
    recommendation = 'Oportunidade moderada: monitorizar e recolher mais dados';
  } else {
    recommendation = 'Baixa oportunidade: não recomendado configurar agora';
  }

  return {
    score: Math.round(score * 100) / 100,
    spreadPct: Math.round(spreadPct * 100) / 100,
    liquidityScore: Math.round(liquidityScore * 100) / 100,
    volumeScore: Math.round(volumeScore * 100) / 100,
    historyScore: Math.round(historyScore * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    recommendation
  };
}

/**
 * Analisa múltiplos pares e devolve os melhores candidatos para SPIKEY.
 * @param {Array} pools - Lista de pools SPIKEY com dados
 * @param {Object} dexlynPools - Mapa de pools DEXLYN por par
 * @param {Object} histories - Histórico de trades por par
 * @returns {Array} - Lista ordenada por score decrescente
 */
function analyzeSpikeyOpportunities(pools, dexlynPools, histories) {
  const results = [];
  for (const pool of pools) {
    const pairKey = `${pool.tokenA}_${pool.tokenB}`;
    const dexlynData = dexlynPools[pairKey];
    const history = histories[pairKey] || { totalTrades: 0, successRate: 0, avgProfitPct: 0 };
    if (dexlynData) {
      const result = scoreSpikeyOpportunity(pool, dexlynData, history);
      results.push({ pair: pairKey, ...result });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

module.exports = { scoreSpikeyOpportunity, analyzeSpikeyOpportunities };
