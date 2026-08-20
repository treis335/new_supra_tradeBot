// intelligence/proposalQueue.js
//
// QUALQUER coisa que o agente (DeepSeek, autonomousBrain, executorActions,
// agentCore) queira mudar no bot -- parâmetros, pools, o que for -- passa
// primeiro por aqui. Nada é aplicado automaticamente. Uma proposta só se
// torna real depois de alguém a aprovar explicitamente (via dashboard ou
// função applyProposal chamada manualmente).
//
// Isto substitui os pontos do código que antes escreviam diretamente em
// config/config.js ou executavam trades sem ninguém ver.

const fs = require('fs');
const path = require('path');

const PROPOSALS_FILE = path.join(__dirname, '..', 'data', 'proposals.json');
const MAX_PROPOSALS = 200;

function loadAll() {
    try {
        if (!fs.existsSync(PROPOSALS_FILE)) return [];
        return JSON.parse(fs.readFileSync(PROPOSALS_FILE, 'utf8'));
    } catch (e) {
        console.error('[proposalQueue] falha ao ler, a começar vazio:', e.message);
        return [];
    }
}

function saveAll(list) {
    const dir = path.dirname(PROPOSALS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PROPOSALS_FILE, JSON.stringify(list.slice(-MAX_PROPOSALS), null, 2));
}

function addProposal({ type, summary, payload, source }) {
    const list = loadAll();
    const proposal = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        type,        // 'config_adjust' | 'add_pool' | 'execute_trade' | 'other'
        summary,     // texto legível para mostrar no dashboard
        payload,     // dados estruturados necessários para aplicar, se aprovado
        source: source || 'unknown',
        status: 'pending', // 'pending' | 'approved' | 'rejected' | 'applied' | 'apply_failed'
        reviewedAt: null,
    };
    list.push(proposal);
    saveAll(list);
    console.log(`📋 [proposalQueue] Nova proposta pendente (${type}): ${summary}`);
    return proposal;
}

function listProposals(status = null) {
    const list = loadAll();
    return status ? list.filter(p => p.status === status) : list;
}

function getProposal(id) {
    return loadAll().find(p => p.id === id) || null;
}

function setStatus(id, status, extra = {}) {
    const list = loadAll();
    const idx = list.findIndex(p => p.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], status, reviewedAt: Date.now(), ...extra };
    saveAll(list);
    return list[idx];
}

module.exports = { addProposal, listProposals, getProposal, setStatus };
