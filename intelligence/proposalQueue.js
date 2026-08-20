// intelligence/proposalQueue.js
//
// Aqui fica a "evolução" do bot: a DeepSeek pode propor mudanças (ajustes de
// parâmetros, ideias de novas funcionalidades, pools a considerar), mas NADA
// entra em vigor sozinho. Cada proposta fica registada com status "pending"
// até um humano aprovar ou rejeitar via dashboard (/api/proposals/:id/decide)
// ou via CLI (scripts/reviewProposals.js).
//
// Isto é deliberado: um sistema que decide sozinho ajustar parâmetros de risco
// ou mexer no código de execução, sem ninguém ver antes, é como um bot antigo
// tentou fazer (agent/executorActions.js) -- e tinha bugs que corrompiam dados
// silenciosamente. A fila de aprovação existe precisamente para apanhar isso.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROPOSALS_FILE = path.join(__dirname, '..', 'data', 'proposals.jsonl');

function ensureDataDir() {
    const dir = path.dirname(PROPOSALS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function createProposal({ type, title, description, payload }) {
    ensureDataDir();
    const proposal = {
        id: crypto.randomUUID(),
        ts: Date.now(),
        type, // 'config_change' | 'new_pool' | 'idea'
        title, description, payload,
        status: 'pending', // 'pending' | 'approved' | 'rejected'
    };
    fs.appendFileSync(PROPOSALS_FILE, JSON.stringify(proposal) + '\n');
    return proposal;
}

function listProposals({ statusFilter = null } = {}) {
    try {
        if (!fs.existsSync(PROPOSALS_FILE)) return [];
        const lines = fs.readFileSync(PROPOSALS_FILE, 'utf8').split('\n').filter(Boolean);
        const all = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        return statusFilter ? all.filter(p => p.status === statusFilter) : all;
    } catch {
        return [];
    }
}

function decideProposal(id, decision) {
    if (!['approved', 'rejected'].includes(decision)) throw new Error('decision invalida');
    const all = listProposals();
    const updated = all.map(p => (p.id === id ? { ...p, status: decision, decidedAt: Date.now() } : p));
    fs.writeFileSync(PROPOSALS_FILE, updated.map(p => JSON.stringify(p)).join('\n') + '\n');
    return updated.find(p => p.id === id);
}

module.exports = { createProposal, listProposals, decideProposal };
