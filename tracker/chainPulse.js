// tracker/chainPulse.js
// Pulso da blockchain — mostra atividade real (txids) sem persistir em disco.
// Corre independente de haver arb ou não.

const axios = require('axios');
const { CONFIG } = require('../config/config');

const RPC = (CONFIG.rpc || 'https://rpc-mainnet.supra.com').replace(/\/$/, '');

// Contas / módulos a observar (DEX + wallet se existir)
function watchedAddresses() {
  const list = [];

  // Dexlyn router/module
  if (CONFIG.dexes?.DEXLYN?.moduleAddress) {
    list.push({
      address: CONFIG.dexes.DEXLYN.moduleAddress,
      label: 'DEXLYN',
    });
  }

  // Spikey (se a config existir)
  try {
    const { SPIKEY_CONFIG } = require('../dexes/spikey/spikeyConfig');
    if (SPIKEY_CONFIG?.moduleAddress) {
      list.push({ address: SPIKEY_CONFIG.moduleAddress, label: 'SPIKEY' });
    } else if (SPIKEY_CONFIG?.packageAddress) {
      list.push({ address: SPIKEY_CONFIG.packageAddress, label: 'SPIKEY' });
    }
  } catch {}

  // A tua wallet (txs tuas)
  if (process.env.SENDER_ADDRESS) {
    list.push({ address: process.env.SENDER_ADDRESS, label: 'WALLET' });
  }

  // dedupe por address
  const seen = new Set();
  return list.filter((x) => {
    const k = String(x.address).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Ring buffer em memória (não grava ficheiro)
const MAX_EVENTS = 40;
const events = []; // { ts, time, label, hash, shortHash, seq, rawHint }
const seenHashes = new Set();

function shortHash(h) {
  if (!h || typeof h !== 'string') return '????????';
  const s = h.startsWith('0x') ? h.slice(2) : h;
  if (s.length < 12) return s;
  return s.slice(0, 6) + '…' + s.slice(-4);
}

function pushEvent(ev) {
  const key = (ev.hash || '') + ':' + (ev.label || '');
  if (ev.hash && seenHashes.has(key)) return false;
  if (ev.hash) {
    seenHashes.add(key);
    // limita set
    if (seenHashes.size > 500) {
      const arr = [...seenHashes];
      seenHashes.clear();
      arr.slice(-200).forEach((k) => seenHashes.add(k));
    }
  }
  events.unshift(ev);
  while (events.length > MAX_EVENTS) events.pop();
  return true;
}

function extractTxList(payload) {
  // A API pode devolver array direto ou { record: [...] }
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.record)) return payload.record;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.transactions)) return payload.transactions;
  return [];
}

function normalizeTx(tx, label) {
  if (!tx || typeof tx !== 'object') return null;

  const hash =
    tx.hash ||
    tx.txn_hash ||
    tx.transaction_hash ||
    tx.tx_hash ||
    tx.version?.toString?.() ||
    null;

  const seq =
    tx.sequence_number ??
    tx.seq ??
    tx.sequenceNumber ??
    null;

  // hint do payload (Move entry function, se existir)
  let hint = '';
  try {
    const p = tx.payload || tx.transaction?.payload || {};
    hint =
      p.function ||
      p.entry_function_id_str ||
      p.type ||
      (Array.isArray(p) ? '' : '') ||
      '';
    if (typeof hint === 'string' && hint.includes('::')) {
      const parts = hint.split('::');
      hint = parts.slice(-2).join('::'); // module::fn
    }
  } catch {
    hint = '';
  }

  return {
    ts: Date.now(),
    time: new Date().toLocaleTimeString('pt-PT'),
    label,
    hash: hash ? String(hash) : null,
    shortHash: hash ? shortHash(String(hash)) : 'no-hash',
    seq,
    hint: hint || 'tx',
  };
}

/**
 * Um pulso: pede txs recentes a cada endereço observado.
 * Não bloqueia o tick se falhar.
 */
async function pulseOnce(opts = {}) {
  const count = opts.count || 8;
  const addresses = watchedAddresses();
  if (addresses.length === 0) return { newCount: 0, events: getEvents() };

  let newCount = 0;

  await Promise.all(
    addresses.map(async ({ address, label }) => {
      try {
        const url = `${RPC}/rpc/v3/accounts/${address}/transactions`;
        const { data } = await axios.get(url, {
          params: { count },
          timeout: 8000,
        });
        const list = extractTxList(data);
        // API costuma devolver mais recentes primeiro ou último — tratamos ambos
        for (const tx of list.slice(0, count)) {
          const ev = normalizeTx(tx, label);
          if (!ev) continue;
          if (pushEvent(ev)) newCount++;
        }
      } catch (e) {
        // silencioso: RPC falhou neste endereço; o bot continua
        pushEvent({
          ts: Date.now(),
          time: new Date().toLocaleTimeString('pt-PT'),
          label: 'RPC',
          hash: null,
          shortHash: '--------',
          seq: null,
          hint: `fail ${label}: ${(e.message || '').slice(0, 40)}`,
        });
      }
    })
  );

  return { newCount, events: getEvents() };
}

function getEvents() {
  return events.slice();
}

/** Linhas prontas para o TUI (blessed tags) */
function getDisplayLines(max = 12) {
  return events.slice(0, max).map((e) => {
    const tag =
      e.label === 'DEXLYN'
        ? '{cyan-fg}DLyn{/}'
        : e.label === 'SPIKEY'
          ? '{magenta-fg}Spky{/}'
          : e.label === 'WALLET'
            ? '{yellow-fg}Wallet{/}'
            : '{grey-fg}' + e.label + '{/}';
    const hx = e.hash
      ? `{green-fg}${e.shortHash}{/}`
      : `{red-fg}${e.shortHash}{/}`;
    return `{grey-fg}${e.time}{/} ${tag} ${hx} {grey-fg}${e.hint}{/}`;
  });
}

/** Para o dashboard-web (JSON simples) */
function getDashboardFeed(max = 20) {
  return events.slice(0, max).map((e) => ({
    time: e.time,
    ts: e.ts,
    dex: e.label,
    txid: e.hash,
    short: e.shortHash,
    hint: e.hint,
  }));
}

module.exports = {
  pulseOnce,
  getEvents,
  getDisplayLines,
  getDashboardFeed,
  watchedAddresses,
};