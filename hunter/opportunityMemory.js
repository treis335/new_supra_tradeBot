// hunter/opportunityMemory.js
// Memória real de oportunidades — escrita atómica

const fs = require('fs');
const path = require('path');

const MEM_PATH = path.join(__dirname, '..', 'data', 'opportunity_memory.json');
const MAX_ENTRIES = 5000;

function ensureDir() {
  const dir = path.dirname(MEM_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath, obj) {
  ensureDir();
  const tmp = filePath + '.tmp';
  const json = JSON.stringify(obj, null, 2);
  fs.writeFileSync(tmp, json, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    fs.writeFileSync(filePath, json, 'utf8');
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function loadMemory() {
  ensureDir();
  try {
    if (!fs.existsSync(MEM_PATH)) return { entries: [], stats: {} };
    const raw = fs.readFileSync(MEM_PATH, 'utf8');
    if (!raw || !raw.trim()) return { entries: [], stats: {} };
    const data = JSON.parse(raw);
    return {
      entries: Array.isArray(data.entries) ? data.entries : [],
      stats: data.stats || {},
    };
  } catch (e) {
    console.error('[OpportunityMemory] JSON inválido — a recomeçar:', e.message);
    try {
      if (fs.existsSync(MEM_PATH)) {
        fs.renameSync(MEM_PATH, MEM_PATH + '.corrupt.' + Date.now());
      }
    } catch {}
    return { entries: [], stats: {} };
  }
}

function saveMemory(mem) {
  if (mem.entries.length > MAX_ENTRIES) {
    mem.entries = mem.entries.slice(-MAX_ENTRIES);
  }
  atomicWrite(MEM_PATH, mem);
}

function recordOpportunity(opp) {
  const mem = loadMemory();
  const pathKey = (opp.cycle?.path || []).join('→');
  const dexes = [...new Set((opp.result?.steps || []).map((s) => s.dex))]
    .filter(Boolean)
    .sort()
    .join('+');

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

  // Não gravar % impossíveis
  if (entry.profitPct > 50) return entry;

  mem.entries.push(entry);

  if (!mem.stats.byPath) mem.stats.byPath = {};
  if (!mem.stats.byDex) mem.stats.byDex = {};

  const p = mem.stats.byPath[pathKey] || {
    count: 0,
    sumProfit: 0,
    maxProfit: 0,
    lastSeen: null,
  };
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
  return Object.entries(mem.stats.byPath || {})
    .filter(([, s]) => s.count >= minCount && s.avgProfit <= 50)
    .sort((a, b) => b[1].avgProfit - a[1].avgProfit)
    .map(([path, s]) => ({ path, ...s }));
}

function getDexPerformance() {
  const mem = loadMemory();
  return Object.entries(mem.stats.byDex || {})
    .filter(([, s]) => s.avgProfit <= 50)
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