// discovery/discoveryStore.js
// Persistência atómica de pools descobertos (evita "Unexpected end of JSON input")

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'discovered_pools.json');
const GRAPH_PATH = path.join(__dirname, '..', 'data', 'dynamic_graph.json');

function ensureDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath, data) {
  ensureDir();
  const tmp = filePath + '.tmp';
  const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, json, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    // Windows: se rename falhar, tenta overwrite
    try {
      fs.writeFileSync(filePath, json, 'utf8');
      try { fs.unlinkSync(tmp); } catch {}
    } catch (e2) {
      console.error('[DiscoveryStore] Erro a gravar:', e2.message);
    }
  }
}

function safeParse(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || !raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error('[DiscoveryStore] JSON inválido em', path.basename(filePath), '—', e.message);
    // Backup do ficheiro partido
    try {
      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, filePath + '.corrupt.' + Date.now());
      }
    } catch {}
    return fallback;
  }
}

function loadPools() {
  ensureDir();
  const data = safeParse(STORE_PATH, []);
  return Array.isArray(data) ? data : [];
}

function savePools(pools) {
  atomicWrite(STORE_PATH, Array.isArray(pools) ? pools : []);
}

function loadGraph() {
  ensureDir();
  return safeParse(GRAPH_PATH, { nodes: {}, edges: [], updatedAt: null });
}

function saveGraph(graph) {
  const g = graph || { nodes: {}, edges: [] };
  g.updatedAt = new Date().toISOString();
  atomicWrite(GRAPH_PATH, g);
}

function upsertPool(pool) {
  const pools = loadPools();
  const key = `${pool.dex}:${pool.address}`.toLowerCase();
  const idx = pools.findIndex(
    (p) => `${p.dex}:${p.address}`.toLowerCase() === key
  );

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