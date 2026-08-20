// discovery/index.js
const store = require('./discoveryStore');
const graph = require('./dynamicGraph');
const scanner = require('./poolScanner');

let discoveryInterval = null;

function startDiscoveryLoop(intervalMs = 25000) {
  if (discoveryInterval) return;

  console.log(`[Discovery] Loop autónomo iniciado (a cada ${intervalMs / 1000}s)`);

  // Primeiro scan imediato
  scanner.runDiscoveryScan().catch(e => console.error('[Discovery] Erro no scan inicial:', e.message));

  discoveryInterval = setInterval(() => {
    scanner.runDiscoveryScan().catch(e => console.error('[Discovery] Erro no scan:', e.message));
  }, intervalMs);
}

function stopDiscoveryLoop() {
  if (discoveryInterval) {
    clearInterval(discoveryInterval);
    discoveryInterval = null;
    console.log('[Discovery] Loop parado');
  }
}

module.exports = {
  ...store,
  ...graph,
  ...scanner,
  startDiscoveryLoop,
  stopDiscoveryLoop,
};