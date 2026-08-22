// spikeyCrossDexScorer.js
// Módulo de scoring para oportunidades cross-DEX envolvendo SPIKEY.
// Funções puras: recebem dados, devolvem resultado. Sem I/O, sem rede.

/**
 * Calcula o lucro percentual entre dois preços (compra e venda).
 * @param {number} buyPrice - preço de compra
 * @param {number} sellPrice - preço de venda
 * @returns {number} lucro percentual (positivo se lucro)
 */
function calculateProfitPct(buyPrice, sellPrice) {
  if (buyPrice <= 0 || sellPrice <= 0) return 0;
  return ((sellPrice - buyPrice) / buyPrice) * 100;
}

/**
 * Calcula o lucro absoluto em USDC para um trade de tamanho dado.
 * @param {number} buyPrice - preço de compra
 * @param {number} sellPrice - preço de venda
 * @param {number} amountIn - quantidade de token comprada (em unidades do token)
 * @returns {number} lucro em USDC
 */
function calculateProfitUSDC(buyPrice, sellPrice, amountIn) {
  if (buyPrice <= 0 || sellPrice <= 0 || amountIn <= 0) return 0;
  const cost = buyPrice * amountIn;
  const revenue = sellPrice * amountIn;
  return revenue - cost;
}

/**
 * Verifica se a liquidez de um pool é suficiente para o trade.
 * @param {number} liquidity - liquidez do pool em USDC
 * @param {number} tradeSize - tamanho do trade em USDC
 * @param {number} minLiquidityRatio - rácio mínimo liquidez/trade (ex: 10)
 * @returns {boolean}
 */
function hasEnoughLiquidity(liquidity, tradeSize, minLiquidityRatio = 10) {
  if (liquidity <= 0 || tradeSize <= 0) return false;
  return liquidity >= tradeSize * minLiquidityRatio;
}

/**
 * Calcula uma pontuação para uma oportunidade cross-DEX.
 * Critérios:
 * - Lucro percentual (peso 60%)
 * - Lucro absoluto em USDC (peso 30%)
 * - Liquidez (peso 10%)
 * A pontuação é normalizada de 0 a 100.
 *
 * @param {Object} opportunity - dados da oportunidade
 * @param {number} opportunity.buyPrice - preço de compra
 * @param {number} opportunity.sellPrice - preço de venda
 * @param {number} opportunity.amountIn - quantidade a comprar
 * @param {number} opportunity.liquidity - liquidez do pool de venda
 * @param {Object} config - configuração de scoring
 * @param {number} config.minProfitPct - lucro mínimo percentual (ex: 2)
 * @param {number} config.minLiquidityRatio - rácio mínimo liquidez/trade
 * @returns {number} pontuação de 0 a 100
 */
function scoreOpportunity(opportunity, config) {
  const { buyPrice, sellPrice, amountIn, liquidity } = opportunity;
  const { minProfitPct, minLiquidityRatio } = config;

  // Se preços inválidos, retorna 0
  if (buyPrice <= 0 || sellPrice <= 0 || amountIn <= 0) return 0;

  const profitPct = calculateProfitPct(buyPrice, sellPrice);
  const profitUSDC = calculateProfitUSDC(buyPrice, sellPrice, amountIn);
  const enoughLiq = hasEnoughLiquidity(liquidity, profitUSDC, minLiquidityRatio);

  // Se não cumpre lucro mínimo ou liquidez, pontuação 0
  if (profitPct < minProfitPct || !enoughLiq) return 0;

  // Normalizar lucro percentual: 0 a 10% -> 0 a 100
  const profitPctScore = Math.min(profitPct / 10, 1) * 100;

  // Normalizar lucro absoluto: 0 a 10 USDC -> 0 a 100
  const profitUSDCScore = Math.min(profitUSDC / 10, 1) * 100;

  // Liquidez: se suficiente, score 100; senão 0 (já filtrado)
  const liquidityScore = enoughLiq ? 100 : 0;

  // Pesos: 60% lucro pct, 30% lucro USDC, 10% liquidez
  const finalScore = profitPctScore * 0.6 + profitUSDCScore * 0.3 + liquidityScore * 0.1;

  return Math.round(finalScore);
}

/**
 * Filtra e ordena oportunidades cross-DEX com SPIKEY.
 * @param {Array<Object>} opportunities - lista de oportunidades
 * @param {Object} config - configuração de scoring
 * @returns {Array<Object>} oportunidades ordenadas por pontuação decrescente
 */
function filterAndRankOpportunities(opportunities, config) {
  return opportunities
    .map(opp => ({
      ...opp,
      score: scoreOpportunity(opp, config)
    }))
    .filter(opp => opp.score > 0)
    .sort((a, b) => b.score - a.score);
}

module.exports = {
  calculateProfitPct,
  calculateProfitUSDC,
  hasEnoughLiquidity,
  scoreOpportunity,
  filterAndRankOpportunities
};
