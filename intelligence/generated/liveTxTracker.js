// liveTxTracker.js
// Módulo para rastrear transações em tempo real na blockchain Supra.
// Fornece dados estruturados para visualização no dashboard.
// Funções puras: recebem dados, devolvem resultados, sem efeitos colaterais.

/**
 * Processa um bloco bruto e extrai transações relevantes.
 * @param {Object} block - Bloco com campo 'transactions' (array de tx objects).
 * @param {Object} options - Opções de filtro (ex: { addresses: ['0x...'] }).
 * @returns {Array} Lista de transações formatadas.
 */
function processBlock(block, options = {}) {
  if (!block || !Array.isArray(block.transactions)) {
    return [];
  }

  const { addresses = [] } = options;
  const addressSet = new Set(addresses.map(a => a.toLowerCase()));

  return block.transactions
    .filter(tx => {
      // Se não há filtro de endereços, inclui todas
      if (addressSet.size === 0) return true;
      // Inclui se algum endereço aparece no from/to
      const from = tx.from ? tx.from.toLowerCase() : '';
      const to = tx.to ? tx.to.toLowerCase() : '';
      return addressSet.has(from) || addressSet.has(to);
    })
    .map(tx => ({
      txid: tx.hash || tx.txid || 'unknown',
      block: block.number || block.height || 0,
      timestamp: block.timestamp || Date.now(),
      from: tx.from || '',
      to: tx.to || '',
      value: tx.value || '0',
      method: tx.method || 'unknown'
    }));
}

/**
 * Agrega transações de múltiplos blocos, ordenando por timestamp.
 * @param {Array} blocks - Lista de blocos processados.
 * @returns {Array} Lista agregada de transações, ordenada por timestamp descendente.
 */
function aggregateTransactions(blocks) {
  const all = blocks.flatMap(b => b.transactions || []);
  return all.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Formata os dados para visualização no dashboard.
 * @param {Array} transactions - Lista de transações.
 * @param {Object} currentBlock - Informação do bloco atual (ex: { number: 12345 }).
 * @returns {Object} Estrutura com bloco atual e lista de transações.
 */
function formatForDashboard(transactions, currentBlock) {
  return {
    currentBlock: currentBlock ? currentBlock.number || 0 : 0,
    totalTransactions: transactions.length,
    transactions: transactions.slice(0, 100) // limita a 100 para performance
  };
}

module.exports = {
  processBlock,
  aggregateTransactions,
  formatForDashboard
};
