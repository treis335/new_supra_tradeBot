// intelligence/proposalApplier.js
//
// O ÚNICO caminho no código que efetivamente muda o comportamento do bot com
// base numa sugestão de IA. Só corre depois de aprovação humana explícita
// (via dashboard). Reaplica sempre os mesmos limites de segurança (SAFE_BOUNDS)
// do motor de evolução -- aprovar uma proposta não é um cheque em branco,
// os valores continuam sempre a ser presos dentro de limites sensatos.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { CONFIG } = require('../config/config');
const { getProposal, setStatus } = require('./proposalQueue');
const { scanCode } = require('./codeSafetyScanner');

const OVERRIDES_FILE = path.join(__dirname, '..', 'data', 'live_overrides.json');
const POOLS_FILE = path.join(__dirname, '..', 'spikeyPools.json');
const PROJECT_ROOT = path.join(__dirname, '..');
const LAST_APPLIED_FILE = path.join(__dirname, '..', 'data', 'last_applied.json');
const RESTART_REQUEST_FILE = path.join(__dirname, '..', 'data', 'restart_request.json');

// Únicas pastas onde código gerado por IA pode ser escrito. Qualquer
// targetPath fora disto é recusado -- mesmo que a proposta pareça aprovada,
// mesmo que o próprio codeAgent.js já tenha tentado restringir isto (nunca
// confiamos só na camada anterior).
const ALLOWED_CODE_DIRS = ['strategies', 'intelligence/generated'];

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
    const previousAutoExecute = { ...CONFIG.autoExecute };
    const clamped = {};
    for (const [key, bounds] of Object.entries(SAFE_BOUNDS)) {
        if (payload[key] === undefined || payload[key] === null) continue;
        clamped[key] = clamp(payload[key], bounds);
    }
    Object.assign(CONFIG.autoExecute, clamped);
    const dir = path.dirname(OVERRIDES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify({ autoExecute: { ...CONFIG.autoExecute }, savedAt: Date.now() }, null, 2));
    return { applied: clamped, rollbackInfo: { previousAutoExecute } };
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
    return { applied: true, pool: { address, tokenA, tokenB }, rollbackInfo: { addedAddress: address } };
}

// execute_trade NUNCA é auto-aplicável por este caminho -- trades reais
// exigem o fluxo normal do bot (auto-execute com os limiares configurados,
// ou execução manual pela TUI). Aprovar uma proposta deste tipo não dispara
// uma trade -- só regista a intenção para referência humana.
function applyExecuteTrade(payload) {
    return { applied: false, reason: 'execução de trade não é feita por aprovação de proposta -- usa o fluxo normal do bot' };
}

// 'idea' vem do analista (deepseekAnalyst.generateCapabilityReport) -- sao
// sugestoes abertas (ex: "vigiar este par", "considerar isto"), nunca codigo
// ou config. "Aprovar" so serve para marcar como lida/aceite -- nunca muda
// nada no bot sozinho.
function applyIdea(payload) {
    return { applied: false, reason: 'ideia registada -- não gera mudança automática, é só para leitura' };
}

// 'code_change' -- ficheiro novo escrito pela IA (intelligence/codeAgent.js).
// Segunda verificação de segurança AQUI, mesmo que já tenha passado no
// codeAgent.js -- nunca confiamos só na camada anterior, porque o payload
// vive em data/proposals.json e podia teoricamente ter sido editado à mão
// entre a criação e a aprovação.
function applyCodeChange(payload) {
    const { targetPath, code } = payload || {};
    if (typeof targetPath !== 'string' || typeof code !== 'string') {
        throw new Error('proposta de código incompleta (falta targetPath ou code)');
    }

    // Normaliza e confirma que o caminho fica DENTRO de uma pasta permitida,
    // sem ../ para escapar, sem caminho absoluto.
    // NOTA (bug corrigido): antes comparava so o 1o segmento do caminho
    // (ex: "intelligence" de "intelligence/generated/x.js") contra a lista
    // ALLOWED_CODE_DIRS que tem entradas compostas ("intelligence/generated").
    // Isso fazia "intelligence/generated" nunca corresponder a nada -- SEMPRE
    // rejeitava ficheiros nessa pasta, mesmo estando na allowlist. Agora
    // compara o caminho inteiro (normalizado com "/") contra cada entrada
    // permitida, aceitando tanto a pasta exata como qualquer coisa dentro dela.
    const normalized = path.normalize(targetPath).replace(/^(\.\.[/\\])+/, '');
    const normalizedForwardSlash = normalized.split(path.sep).join('/');
    const isInAllowedDir = ALLOWED_CODE_DIRS.some(dir =>
        normalizedForwardSlash === dir || normalizedForwardSlash.startsWith(dir + '/')
    );
    if (path.isAbsolute(targetPath) || normalized.includes('..') || !isInAllowedDir) {
        throw new Error(`targetPath "${targetPath}" não está numa pasta permitida (${ALLOWED_CODE_DIRS.join(', ')})`);
    }

    const fullPath = path.join(PROJECT_ROOT, normalized);
    if (!fullPath.startsWith(PROJECT_ROOT)) {
        throw new Error('targetPath tenta escapar do diretório do projeto');
    }

    const tmpFile = path.join(require('os').tmpdir(), `applycheck_${Date.now()}.js`);
    fs.writeFileSync(tmpFile, code);
    try {
        execSync(`node --check "${tmpFile}"`, { stdio: 'pipe' });
    } catch (e) {
        fs.unlinkSync(tmpFile);
        throw new Error(`código tem erro de sintaxe, recusado: ${e.stderr?.toString()?.slice(0, 300) || e.message}`);
    }
    fs.unlinkSync(tmpFile);

    const scan = scanCode(code);
    if (!scan.safe) {
        throw new Error(`código bloqueado pelo scan de segurança: ${scan.blocks.join('; ')}`);
    }

    // Guarda o conteúdo anterior (se existia) para poder reverter -- ficheiros
    // gerados são quase sempre novos, mas se um dia isto sobrescrever um
    // componente já aprovado antes, queremos poder voltar atrás.
    const existedBefore = fs.existsSync(fullPath);
    const previousContent = existedBefore ? fs.readFileSync(fullPath, 'utf8') : null;

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, code);

    return {
        applied: true,
        writtenTo: normalized,
        warnings: scan.warnings,
        note: 'ficheiro criado, mas não está ligado a nada do bot ainda -- para o usar (ex: no loop de trading), isso é uma proposta separada.',
        rollbackInfo: { targetPath: normalized, existedBefore, previousContent },
    };
}

// Tipos de proposta cuja mudança só faz efeito completo depois de o bot
// reiniciar (hoje: nenhum -- config aplica-se logo em memória, código novo
// fica isolado até outra proposta o ligar ao bot). Mantido como lista
// explícita para quando isso deixar de ser verdade (ex: proposta que liga
// um componente ao loop de trading).
const TYPES_REQUIRING_RESTART = [];

function requestRestart(reason) {
    const dir = path.dirname(RESTART_REQUEST_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RESTART_REQUEST_FILE, JSON.stringify({ reason, requestedAt: Date.now() }, null, 2));
}

function recordLastApplied(proposal, result) {
    const dir = path.dirname(LAST_APPLIED_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LAST_APPLIED_FILE, JSON.stringify({
        proposalId: proposal.id,
        type: proposal.type,
        appliedAt: Date.now(),
        rollbackInfo: result?.rollbackInfo || null,
        rolledBack: false,
    }, null, 2));
}

// Chamado pelo utils/botSupervisor.js quando o bot cai logo a seguir a um
// reinício pedido por uma mudança aplicada -- reverte com base no que foi
// gravado em recordLastApplied(), para NUNCA deixar o bot preso a correr
// com uma mudança que o está a fazer rebentar.
function rollbackToPreviousChampion(lastApplied) {
    if (!lastApplied || !lastApplied.rollbackInfo) {
        throw new Error('sem informação de rollback disponível para esta mudança');
    }
    const { type, rollbackInfo } = lastApplied;

    switch (type) {
        case 'config_adjust': {
            Object.assign(CONFIG.autoExecute, rollbackInfo.previousAutoExecute);
            fs.writeFileSync(OVERRIDES_FILE, JSON.stringify({ autoExecute: { ...CONFIG.autoExecute }, savedAt: Date.now(), revertedFrom: lastApplied.proposalId }, null, 2));
            return;
        }
        case 'add_pool': {
            if (!fs.existsSync(POOLS_FILE)) return;
            let pools = [];
            try { pools = JSON.parse(fs.readFileSync(POOLS_FILE, 'utf8')); } catch { return; }
            pools = pools.filter(p => p.address !== rollbackInfo.addedAddress);
            fs.writeFileSync(POOLS_FILE, JSON.stringify(pools, null, 2));
            return;
        }
        case 'code_change': {
            const fullPath = path.join(PROJECT_ROOT, rollbackInfo.targetPath);
            if (rollbackInfo.existedBefore) {
                fs.writeFileSync(fullPath, rollbackInfo.previousContent);
            } else if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
            return;
        }
        default:
            throw new Error(`rollback não suportado para o tipo '${type}'`);
    }
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
            case 'idea': result = applyIdea(proposal.payload); break;
            case 'code_change': result = applyCodeChange(proposal.payload); break;
            default: throw new Error(`tipo de proposta desconhecido: ${proposal.type}`);
        }
        setStatus(id, 'applied', { result });

        if (result?.rollbackInfo) {
            recordLastApplied(proposal, result);
        }
        if (TYPES_REQUIRING_RESTART.includes(proposal.type)) {
            requestRestart(`proposta ${proposal.id} (${proposal.type}) aprovada`);
        }

        return result;
    } catch (e) {
        setStatus(id, 'apply_failed', { error: e.message });
        throw e;
    }
}

// Reinício pedido manualmente pelo humano no dashboard (ex: depois de editar
// algo à mão, ou só para confirmar que o mecanismo funciona). Também passa
// pelo mesmo registo -- se o bot cair logo a seguir, mas não há
// rollbackInfo de nenhuma proposta recente, o supervisor tenta reiniciar
// sem reverter nada (não há nada para reverter).
function requestManualRestart(reason) {
    requestRestart(reason || 'reinício manual pedido no dashboard');
}

module.exports = { applyProposal, rollbackToPreviousChampion, requestManualRestart, SAFE_BOUNDS };
