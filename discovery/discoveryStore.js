// discovery/discoveryStore.js
// Persistência simples e fiável de pools descobertos (dados reais)

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'discovered_pools.json');
const GRAPH_PATH = path.join(__dirname, '..', 'data', 'dynamic_graph.json');

function ensureDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadPools() {
  ensureDir();
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[DiscoveryStore] Erro a carregar pools:', e.message);
    return [];
  }
}

function savePools(pools) {
  ensureDir();
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(pools, null, 2), 'utf8');
  } catch (e) {
    console.error('[DiscoveryStore] Erro a guardar pools:', e.message);
  }
}

function loadGraph() {
  ensureDir();
  try {
    if (!fs.existsSync(GRAPH_PATH)) return { nodes: {}, edges: [], updatedAt: null };
    return JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
  } catch {
    return { nodes: {}, edges: [], updatedAt: null };
  }
}

function saveGraph(graph) {
  ensureDir();
  try {
    graph.updatedAt = new Date().toISOString();
    fs.writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2), 'utf8');
  } catch (e) {
    console.error('[DiscoveryStore] Erro a guardar grafo:', e.message);
  }
}

function upsertPool(pool) {
  const pools = loadPools();
  const key = `${pool.dex}:${pool.address}`.toLowerCase();
  const idx = pools.findIndex(p => `${p.dex}:${p.address}`.toLowerCase() === key);

  const entry = {
    ...pool,
    lastSeen: new Date().toISOString(),
    firstSeen: idx >= 0 ? pools[idx].firstSeen : new Date().toISOString(),
  };

  if (idx >= 0) pools[idx] = { ...pools[idx], ...entry };
  else pools.push(entry);

  savePools(pools);
  return entry;
}

module.exports = {
  loadPools,
  savePools,
  loadGraph,
  saveGraph,
  upsertPool,
  STORE_PATH,
  GRAPH_PATH,
};