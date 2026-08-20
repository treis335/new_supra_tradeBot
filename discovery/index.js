// discovery/index.js
const store = require('./discoveryStore');
const graph = require('./dynamicGraph');
const scanner = require('./poolScanner');

let discoveryInterval = null;
let scanning = false;

function startDiscoveryLoop(intervalMs = 60000) {
  if (discoveryInterval) return;

  console.log(`[Discovery] Loop autónomo iniciado (a cada ${intervalMs / 1000}s)`);

  const run = () => {
    if (scanning) return;
    scanning = true;
    scanner
      .runDiscoveryScan()
      .catch((e) => console.error('[Discovery] Erro no scan:', e.message))
      .finally(() => {
        scanning = false;
      });
  };

  run();
  discoveryInterval = setInterval(run, intervalMs);
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