// intelligence/proposalApplier.js
//
// O ÚNICO caminho no código que efetivamente muda o comportamento do bot com
// base numa sugestão de IA. Só corre depois de aprovação humana explícita
// (via dashboard). Reaplica sempre os mesmos limites de segurança (SAFE_BOUNDS)
// do motor de evolução -- aprovar uma proposta não é um cheque em branco,
// os valores continuam sempre a ser presos dentro de limites sensatos.

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config/config');
const { getProposal, setStatus } = require('./proposalQueue');

const OVERRIDES_FILE = path.join(__dirname, '..', 'data', 'live_overrides.json');
const POOLS_FILE = path.join(__dirname, '..', 'spikeyPools.json');

// Mesmos limites usados pelo evolver.js -- uma proposta aprovada nunca pode
// sair destes limites, mesmo que o valor pedido seja diferente.
const SAFE_BOUNDS = {
    minProfitPct: { min: 0.15, max: 1.5 },
    crossDexMinProfitPct: { min: 0.5, max: 3.0 },
    cooldownMs: { min: 800, max: 5000 },
    maxTradesPerTick: { min: 1, max: 6 },
    minScore: { min: 10, max: 60 },
    maxConsecutiveFails: { min: 2, max: 6 },
};

function clamp(value, bounds) {
    return Math.max(bounds.min, Math.min(bounds.max, Number(value)));
}

function applyConfigAdjust(payload) {
    const clamped = {};
    for (const [key, bounds] of Object.entries(SAFE_BOUNDS)) {
        if (payload[key] === undefined || payload[key] === null) continue;
        clamped[key] = clamp(payload[key], bounds);
    }
    Object.assign(CONFIG.autoExecute, clamped);
    const dir = path.dirname(OVERRIDES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify({ autoExecute: { ...CONFIG.autoExecute }, savedAt: Date.now() }, null, 2));
    return { applied: clamped };
}

function applyAddPool(payload) {
    // Exige estrutura mínima válida -- nunca aceita uma string solta ou um
    // objeto incompleto, que é o que causava corrupção do ficheiro de pools.
    const { address, tokenA, tokenB } = payload || {};
    if (typeof address !== 'string' || !address.startsWith('0x') || address.length < 10) {
        throw new Error('endereço de pool inválido');
    }
    if (typeof tokenA !== 'string' || typeof tokenB !== 'string') {
        throw new Error('tokenA/tokenB em falta ou inválidos');
    }
    let pools = [];
    if (fs.existsSync(POOLS_FILE)) {
        try { pools = JSON.parse(fs.readFileSync(POOLS_FILE, 'utf8')); } catch { pools = []; }
        if (!Array.isArray(pools)) pools = [];
    }
    if (pools.some(p => p.address === address)) {
        return { applied: false, reason: 'pool já existe' };
    }
    pools.push({ address, tokenA, tokenB, addedAt: Date.now(), source: 'proposal_approved' });
    fs.writeFileSync(POOLS_FILE, JSON.stringify(pools, null, 2));
    return { applied: true, pool: { address, tokenA, tokenB } };
}

// execute_trade NUNCA é auto-aplicável por este caminho -- trades reais
// exigem o fluxo normal do bot (auto-execute com os limiares configurados,
// ou execução manual pela TUI). Aprovar uma proposta deste tipo não dispara
// uma trade -- só regista a intenção para referência humana.
function applyExecuteTrade(payload) {
    return { applied: false, reason: 'execução de trade não é feita por aprovação de proposta -- usa o fluxo normal do bot' };
}

function applyProposal(id) {
    const proposal = getProposal(id);
    if (!proposal) throw new Error('proposta não encontrada');
    if (proposal.status !== 'approved') throw new Error(`proposta tem estado '${proposal.status}', esperava 'approved'`);

    try {
        let result;
        switch (proposal.type) {
            case 'config_adjust': result = applyConfigAdjust(proposal.payload); break;
            case 'add_pool': result = applyAddPool(proposal.payload); break;
            case 'execute_trade': result = applyExecuteTrade(proposal.payload); break;
            default: throw new Error(`tipo de proposta desconhecido: ${proposal.type}`);
        }
        setStatus(id, 'applied', { result });
        return result;
    } catch (e) {
        setStatus(id, 'apply_failed', { error: e.message });
        throw e;
    }
}

module.exports = { applyProposal, SAFE_BOUNDS };
