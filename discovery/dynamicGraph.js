// discovery/dynamicGraph.js
// Grafo vivo de tokens e pools (construído a partir de dados reais)

const { loadPools, saveGraph } = require('./discoveryStore');

function buildGraph(pools = null) {
  const list = pools || loadPools();
  const nodes = {};
  const edges = [];

  for (const p of list) {
    if (!p.tokenA || !p.tokenB || !p.address) continue;

    // Nodes
    if (!nodes[p.tokenA]) nodes[p.tokenA] = { symbol: p.tokenA, pools: 0 };
    if (!nodes[p.tokenB]) nodes[p.tokenB] = { symbol: p.tokenB, pools: 0 };
    nodes[p.tokenA].pools++;
    nodes[p.tokenB].pools++;

    // Edges (bidirecionais)
    edges.push({
      from: p.tokenA,
      to: p.tokenB,
      dex: p.dex,
      address: p.address,
      reserveA: p.reserveA || 0,
      reserveB: p.reserveB || 0,
      fee: p.fee || 25,
      liquidityScore: estimateLiquidity(p),
    });
  }

  const graph = { nodes, edges, updatedAt: new Date().toISOString() };
  saveGraph(graph);
  return graph;
}

function estimateLiquidity(pool) {
  // Heurística simples e realista (podes melhorar depois)
  const rA = Number(pool.reserveA) || 0;
  const rB = Number(pool.reserveB) || 0;
  return Math.sqrt(rA * rB);
}

function getNeighbors(graph, token) {
  return graph.edges.filter(e => e.from === token || e.to === token);
}

function findPossibleCycles(graph, maxLen = 4) {
  // Versão leve — o detector principal já tem lógica mais avançada
  const cycles = [];
  const tokens = Object.keys(graph.nodes);

  for (const start of tokens) {
    const stack = [{ path: [start], visited: new Set([start]) }];

    while (stack.length) {
      const { path, visited } = stack.pop();
      const current = path[path.length - 1];

      if (path.length > 1 && current === start) {
        cycles.push([...path]);
        continue;
      }
      if (path.length >= maxLen) continue;

      for (const edge of graph.edges) {
        let next = null;
        if (edge.from === current) next = edge.to;
        else if (edge.to === current) next = edge.from;

        if (next && (!visited.has(next) || next === start)) {
          const newVisited = new Set(visited);
          newVisited.add(next);
          stack.push({ path: [...path, next], visited: newVisited });
        }
      }
    }
  }

  // Remover duplicados simples
  const seen = new Set();
  return cycles.filter(c => {
    const key = c.slice(0, -1).sort().join('-');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  buildGraph,
  getNeighbors,
  findPossibleCycles,
  estimateLiquidity,
};