// intelligence/proposalApplier.js
//
// Corre periodicamente (chamado do loop/tick.js). So faz uma coisa: procura
// propostas com status "approved" que ainda nao foram aplicadas, aplica-as,
// e marca como "applied". NUNCA aplica propostas "pending" -- so depois de
// aprovadas explicitamente no dashboard (POST /api/proposals/:id/decide).
//
// Reaplica os limites de seguranca aqui tambem (defesa em profundidade -- mesmo
// que algo escrevesse um payload fora dos limites por engano, isto nao deixa passar).

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config/config');
const { listProposals } = require('./proposalQueue');
const { logEvent } = require('./historyLogger');
const { logError } = require('../utils/logError');

const PROPOSALS_FILE = path.join(__dirname, '..', 'data', 'proposals.jsonl');
const POOLS_FILE = path.join(__dirname, '..', 'spikeyPools.json');

const SAFE_BOUNDS = {
    minProfitPct: { min: 0.15, max: 1.5 },
    crossDexMinProfitPct: { min: 0.5, max: 3.0 },
    cooldownMs: { min: 800, max: 5000 },
    maxTradesPerTick: { min: 1, max: 6 },
};
function clamp(value, bounds) { return Math.max(bounds.min, Math.min(bounds.max, value)); }

function markApplied(id, note) {
    const all = listProposals();
    const updated = all.map(p => (p.id === id ? { ...p, status: 'applied', appliedAt: Date.now(), applyNote: note } : p));
    fs.writeFileSync(PROPOSALS_FILE, updated.map(p => JSON.stringify(p)).join('\n') + '\n');
}

function applyConfigChange(proposal) {
    const changes = [];
    for (const [key, value] of Object.entries(proposal.payload || {})) {
        if (!SAFE_BOUNDS[key]) continue;
        const clamped = clamp(Number(value), SAFE_BOUNDS[key]);
        CONFIG.autoExecute[key] = clamped;
        changes.push(`${key}=${clamped}`);
    }
    return changes.join(', ');
}

function applyNewPool(proposal, log) {
    try {
        const { address, tokenA, tokenB } = proposal.payload;
        let pools = [];
        if (fs.existsSync(POOLS_FILE)) pools = JSON.parse(fs.readFileSync(POOLS_FILE, 'utf8'));
        if (pools.some(p => p.address === address)) return 'pool já existia';

        pools.push({ address, tokenA, tokenB, discovered: false, addedViaProposal: true, addedAt: new Date().toISOString() });
        fs.writeFileSync(POOLS_FILE, JSON.stringify(pools, null, 2));

        // Atualiza tambem em memoria, para o proximo tick ja incluir sem reiniciar
        const { SPIKEY_CONFIG } = require('../dexes/spikey/spikeyConfig');
        SPIKEY_CONFIG.pools = pools;

        return `pool ${tokenA}/${tokenB} adicionado`;
    } catch (e) {
        logError('proposalApplier.applyNewPool', e);
        return `erro: ${e.message}`;
    }
}

function applyApprovedProposals(log = () => {}) {
    const approved = listProposals({ statusFilter: 'approved' });
    if (approved.length === 0) return { applied: 0 };

    let count = 0;
    for (const proposal of approved) {
        let note = '';
        try {
            if (proposal.type === 'config_change') note = applyConfigChange(proposal);
            else if (proposal.type === 'new_pool') note = applyNewPool(proposal, log);
            else { note = 'tipo de proposta sem ação automática (é só uma ideia para leres)'; }

            markApplied(proposal.id, note);
            logEvent('proposal_applied', { id: proposal.id, type: proposal.type, note });
            log(`{green-fg}✅ Proposta aplicada: ${proposal.title} (${note}){/}`);
            count++;
        } catch (e) {
            logError('proposalApplier', e);
        }
    }
    return { applied: count };
}

module.exports = { applyApprovedProposals };
