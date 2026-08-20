// hunter/opportunityMemory.js
// Memória real de oportunidades de arbitragem (só dados observados)

const fs = require('fs');
const path = require('path');

const MEM_PATH = path.join(__dirname, '..', 'data', 'opportunity_memory.json');
const MAX_ENTRIES = 5000; // evita ficheiro infinito

function ensureDir() {
  const dir = path.dirname(MEM_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadMemory() {
  ensureDir();
  try {
    if (!fs.existsSync(MEM_PATH)) return { entries: [], stats: {} };
    return JSON.parse(fs.readFileSync(MEM_PATH, 'utf8'));
  } catch {
    return { entries: [], stats: {} };
  }
}

function saveMemory(mem) {
  ensureDir();
  // Manter só as mais recentes
  if (mem.entries.length > MAX_ENTRIES) {
    mem.entries = mem.entries.slice(-MAX_ENTRIES);
  }
  fs.writeFileSync(MEM_PATH, JSON.stringify(mem, null, 2), 'utf8');
}

function recordOpportunity(opp) {
  const mem = loadMemory();
  const pathKey = (opp.cycle?.path || []).join('→');
  const dexes = [...new Set((opp.result?.steps || []).map(s => s.dex))].sort().join('+');

  const entry = {
    ts: new Date().toISOString(),
    path: pathKey,
    dexes,
    profitPct: opp.result?.profitPct || 0,
    profitAbs: opp.result?.profitAbs || 0,
    score: opp.score || 0,
    amount: opp.optimalAmount || 0,
    hops: (opp.cycle?.path?.length || 1) - 1,
  };

  mem.entries.push(entry);

  // Stats agregadas por rota e por combo de DEX
  if (!mem.stats.byPath) mem.stats.byPath = {};
  if (!mem.stats.byDex) mem.stats.byDex = {};

  const p = mem.stats.byPath[pathKey] || { count: 0, sumProfit: 0, maxProfit: 0, lastSeen: null };
  p.count++;
  p.sumProfit += entry.profitPct;
  p.maxProfit = Math.max(p.maxProfit, entry.profitPct);
  p.lastSeen = entry.ts;
  p.avgProfit = p.sumProfit / p.count;
  mem.stats.byPath[pathKey] = p;

  const d = mem.stats.byDex[dexes] || { count: 0, sumProfit: 0, maxProfit: 0 };
  d.count++;
  d.sumProfit += entry.profitPct;
  d.maxProfit = Math.max(d.maxProfit, entry.profitPct);
  d.avgProfit = d.sumProfit / d.count;
  mem.stats.byDex[dexes] = d;

  saveMemory(mem);
  return entry;
}

function getHotRoutes(minCount = 3) {
  const mem = loadMemory();
  const paths = Object.entries(mem.stats.byPath || {})
    .filter(([, s]) => s.count >= minCount)
    .sort((a, b) => b[1].avgProfit - a[1].avgProfit);
  return paths.map(([path, s]) => ({ path, ...s }));
}

function getDexPerformance() {
  const mem = loadMemory();
  return Object.entries(mem.stats.byDex || {})
    .map(([dexes, s]) => ({ dexes, ...s }))
    .sort((a, b) => b.avgProfit - a.avgProfit);
}

module.exports = {
  recordOpportunity,
  getHotRoutes,
  getDexPerformance,
  loadMemory,
  MEM_PATH,
};