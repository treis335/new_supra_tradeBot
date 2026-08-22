// network-status-card.js
// Módulo puro que gera um cartão de estado da rede para o dashboard.
// Recebe dados de latência e conectividade e devolve um objeto formatado.
// Não faz chamadas de rede, não lê ficheiros, não importa o executor.

/**
 * Gera um cartão de estado da rede.
 * @param {Object} networkData - Dados de conectividade e latência.
 * @param {Object} networkData.supra - { connected: boolean, latencyMs: number }
 * @param {Object} networkData.dexlyn - { connected: boolean, latencyMs: number }
 * @param {Object} networkData.spikey - { connected: boolean, latencyMs: number }
 * @param {number} networkData.timestamp - Timestamp da medição (ms).
 * @returns {Object} Cartão formatado para o dashboard.
 */
function generateNetworkStatusCard(networkData) {
  // Validação básica: se faltar algum dado, assume desconectado com latência infinita.
  const defaultStatus = { connected: false, latencyMs: Infinity };
  const supra = networkData.supra || defaultStatus;
  const dexlyn = networkData.dexlyn || defaultStatus;
  const spikey = networkData.spikey || defaultStatus;

  // Função auxiliar para formatar latência: se Infinity, mostra 'N/A'.
  const formatLatency = (latencyMs) => {
    if (!Number.isFinite(latencyMs)) return 'N/A';
    return `${Math.round(latencyMs)} ms`;
  };

  // Determina o estado geral: se todos conectados, 'online'; senão, 'degradado'.
  const allConnected = supra.connected && dexlyn.connected && spikey.connected;
  const overallStatus = allConnected ? 'online' : 'degraded';

  // Constrói o cartão com estrutura compatível com o dashboard existente.
  return {
    type: 'network-status',
    title: 'Estado da Rede',
    timestamp: networkData.timestamp || Date.now(),
    overallStatus,
    services: {
      supra: {
        connected: supra.connected,
        latencyMs: supra.latencyMs,
        latencyDisplay: formatLatency(supra.latencyMs),
      },
      dexlyn: {
        connected: dexlyn.connected,
        latencyMs: dexlyn.latencyMs,
        latencyDisplay: formatLatency(dexlyn.latencyMs),
      },
      spikey: {
        connected: spikey.connected,
        latencyMs: spikey.latencyMs,
        latencyDisplay: formatLatency(spikey.latencyMs),
      },
    },
    // Mensagem de resumo para o humano.
    summary: allConnected
      ? 'Todos os serviços conectados.'
      : 'Alguns serviços estão indisponíveis. Verifique a conectividade.',
  };
}

module.exports = { generateNetworkStatusCard };
