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

    // Evita duplicados: se ja existir uma proposta PENDENTE do mesmo tipo com
    // o mesmo payload (ex: "ajustar minProfitPct para 0.1" outra vez, sem a
    // anterior ter sido decidida ainda), nao cria outra -- so devolve a
    // existente. Isto era o que fazia o dashboard encher-se com a mesma
    // sugestao repetida a cada vez que o analista corria.
    const payloadKey = JSON.stringify(payload);
    const existing = list.find(p =>
        p.status === 'pending' && p.type === type && JSON.stringify(p.payload) === payloadKey
    );
    if (existing) {
        require('../tui/systemLog').pushSystemLog(
            `{grey-fg}🧠 Analista: sugestão igual à já pendente (${type}), não duplicada.{/}`
        );
        return existing;
    }

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
    // ANTES: console.log direto aqui corrompia o ecrã do blessed (a mesma
    // classe de bug do discovery/ removido). Agora vai para o systemLog,
    // que aparece no painel de log da TUI em vez de escrever por cima do ecrã.
    try {
        require('../tui/systemLog').pushSystemLog(`{cyan-fg}📋 Nova proposta (${type}): ${summary}{/}`);
    } catch { /* tui/systemLog pode nao existir se isto correr fora da TUI (ex: dashboard standalone) */ }
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
