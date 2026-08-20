// discovery/poolScanner.js
// Scanner real de pools (Dexlyn + Spikey) — dados da mainnet

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config/config');
const { upsertPool, loadPools } = require('./discoveryStore');
const { buildGraph } = require('./dynamicGraph');
const { logError } = require('../utils/logError');

const RPC = CONFIG.rpc || 'https://rpc-mainnet.supra.com';
const VIEW_RPC = RPC.includes('/rpc/v1') ? RPC : `${RPC.replace(/\/$/, '')}/rpc/v1`;
const SPIKEY_ADDR = '0x3045d27b5fada1e30897a741fb184e48ef0bff3717aea23918ebc1e5c7153083';

async function callView(moduleAddress, func, args = [], typeArgs = []) {
  try {
    const res = await axios.post(`${VIEW_RPC}/view`, {
      function: `${moduleAddress}::${func}`,
      type_arguments: typeArgs,
      arguments: args,
    }, { timeout: 12000 });
    return res.data?.result ?? res.data;
  } catch (e) {
    return null;
  }
}

async function scanSpikeyPools() {
  const poolsFile = path.join(__dirname, '..', 'spikeyPools.json');
  let known = [];
  try {
    known = JSON.parse(fs.readFileSync(poolsFile, 'utf8'));
  } catch {
    known = [];
  }

  const results = [];
  for (const p of known) {
    try {
      const reserves = await callView(SPIKEY_ADDR, 'amm_pair::get_reserves', [p.address]);
      if (!reserves || reserves.length < 2) continue;

      const r0 = Number(reserves[0]);
      const r1 = Number(reserves[1]);
      if (r0 === 0 && r1 === 0) continue;

      let fee = 25;
      try {
        const feeRes = await callView(SPIKEY_ADDR, 'amm_controller::get_swap_fee');
        fee = Number(Array.isArray(feeRes) ? feeRes[0] : feeRes) || 25;
      } catch {}

      const entry = {
        dex: 'SPIKEY',
        address: p.address,
        tokenA: p.tokenA,
        tokenB: p.tokenB,
        reserveA: r0,
        reserveB: r1,
        fee,
        source: 'spikeyPools.json',
      };

      upsertPool(entry);
      results.push(entry);
    } catch (e) {
      logError(`scanSpikey ${p.address}`, e);
    }
  }
  return results;
}

async function scanDexlynFromConfig() {
  const results = [];
  const dexlyn = CONFIG.dexes?.DEXLYN;
  if (!dexlyn || !dexlyn.pairs) return results;

  // Por agora validamos os pares já conhecidos no config
  // (a descoberta automática de novos pools Dexlyn exige views de factory — próximo passo)
  for (const [tokenA, tokenB, curve] of dexlyn.pairs) {
    const entry = {
      dex: 'DEXLYN',
      address: `${tokenA}-${tokenB}-${curve}`, // placeholder até termos o address real do pool
      tokenA,
      tokenB,
      curve: curve || 'uncorrelated',
      source: 'config',
      // reservas serão preenchidas pelo loop principal / detector
    };
    upsertPool(entry);
    results.push(entry);
  }
  return results;
}

async function runDiscoveryScan() {
  console.log(`[Discovery] Scan iniciado — ${new Date().toISOString()}`);
  const spikey = await scanSpikeyPools();
  const dexlyn = await scanDexlynFromConfig();

  const all = loadPools();
  const graph = buildGraph(all);

  console.log(`[Discovery] Spikey ativos: ${spikey.length} | Dexlyn conhecidos: ${dexlyn.length} | Total no store: ${all.length}`);
  console.log(`[Discovery] Grafo: ${Object.keys(graph.nodes).length} tokens | ${graph.edges.length} edges`);

  return { spikey, dexlyn, total: all.length, graph };
}

module.exports = {
  runDiscoveryScan,
  scanSpikeyPools,
  scanDexlynFromConfig,
  callView,
};