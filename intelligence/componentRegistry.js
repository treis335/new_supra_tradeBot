// intelligence/componentRegistry.js
//
// Lista de componentes aprovados que estão "ligados" ao bot real. Nunca é a
// IA a editar loop/tick.js ou detector/arbDetector.js -- esses ficheiros têm
// UM ponto de extensão fixo (chamado a partir de loop/tick.js), e isto é só
// uma lista de "quais componentes aprovados correm nesse ponto". Ligar/
// desligar um componente é só adicionar/remover uma linha aqui -- nunca uma
// edição de código.
//
// Carregado UMA VEZ no arranque do bot (por isso ligar/desligar um
// componente exige reiniciar -- ver utils/botSupervisor.js), para o
// comportamento de trading nunca mudar a meio de um tick.

const fs = require('fs');
const path = require('path');

const REGISTRY_FILE = path.join(__dirname, '..', 'data', 'active_components.json');
const PROJECT_ROOT = path.join(__dirname, '..');

// Únicos tipos de ponto de extensão que existem. Uma proposta de
// wire_component só pode apontar para um destes -- não é possível "inventar"
// um hook novo só por pedir.
const KNOWN_HOOKS = ['score_modifier'];

function loadRegistry() {
    try {
        if (!fs.existsSync(REGISTRY_FILE)) return [];
        const data = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error('[componentRegistry] falha ao ler, a tratar como vazio:', e.message);
        return [];
    }
}

function saveRegistry(list) {
    const dir = path.dirname(REGISTRY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(list, null, 2));
}

// Carrega (com require fresco, sem cache) os componentes ativos para um hook
// específico. Cada require() está isolado em try/catch -- um componente com
// um bug de sintaxe introduzido depois de aprovado (ex: alguém editou o
// ficheiro à mão) nunca deve impedir o bot de arrancar.
function getActiveComponentsForHook(hookName, log = console.log) {
    const registry = loadRegistry();
    const entries = registry.filter(e => e.hookName === hookName);
    const loaded = [];

    for (const entry of entries) {
        const fullPath = path.join(PROJECT_ROOT, entry.targetPath);
        try {
            delete require.cache[require.resolve(fullPath)];
            const mod = require(fullPath);
            const fn = mod[entry.exportName];
            if (typeof fn !== 'function') {
                log(`⚠️ Componente ${entry.targetPath} não exporta "${entry.exportName}" -- ignorado.`);
                continue;
            }
            loaded.push({ ...entry, fn });
        } catch (e) {
            log(`⚠️ Componente ${entry.targetPath} falhou ao carregar (${e.message}) -- ignorado, bot continua sem ele.`);
        }
    }
    return loaded;
}

function addComponent({ targetPath, exportName, hookName, proposalId, description }) {
    if (!KNOWN_HOOKS.includes(hookName)) {
        throw new Error(`hook "${hookName}" desconhecido -- só são permitidos: ${KNOWN_HOOKS.join(', ')}`);
    }
    const registry = loadRegistry();
    if (registry.some(e => e.targetPath === targetPath && e.hookName === hookName)) {
        return { added: false, reason: 'já está ativo neste hook' };
    }
    registry.push({ targetPath, exportName, hookName, proposalId, description, activatedAt: Date.now() });
    saveRegistry(registry);
    return { added: true };
}

function removeComponent({ targetPath, hookName }) {
    const registry = loadRegistry();
    const next = registry.filter(e => !(e.targetPath === targetPath && e.hookName === hookName));
    saveRegistry(next);
    return { removed: next.length !== registry.length };
}

// Aplica todos os componentes ativos no hook 'score_modifier' a uma lista de
// oportunidades. Cada componente devolve um fator (idealmente perto de 1.0);
// o fator é SEMPRE preso entre 0.5x e 2x antes de ser aplicado, e cada
// chamada está isolada -- um componente que rebente (erro, valor inválido,
// NaN) é ignorado nesse ciclo e não afeta os outros nem o resto do tick.
const SCORE_MODIFIER_MIN_FACTOR = 0.5;
const SCORE_MODIFIER_MAX_FACTOR = 2.0;

function applyScoreModifiers(opps, context, log = console.log) {
    const components = getActiveComponentsForHook('score_modifier', log);
    if (components.length === 0) return;

    for (const opp of opps) {
        let totalFactor = 1;
        for (const comp of components) {
            try {
                const factor = comp.fn(opp, context);
                if (typeof factor !== 'number' || !Number.isFinite(factor)) continue;
                const clamped = Math.max(SCORE_MODIFIER_MIN_FACTOR, Math.min(SCORE_MODIFIER_MAX_FACTOR, factor));
                totalFactor *= clamped;
            } catch (e) {
                // Um componente com bug não pode afetar os outros nem parar o tick.
                continue;
            }
        }
        // O produto de vários fatores também fica preso ao mesmo intervalo,
        // para dois componentes moderados não poderem somar um efeito extremo.
        totalFactor = Math.max(SCORE_MODIFIER_MIN_FACTOR, Math.min(SCORE_MODIFIER_MAX_FACTOR, totalFactor));
        opp.score = Math.round(opp.score * totalFactor);
    }
}

module.exports = { loadRegistry, getActiveComponentsForHook, addComponent, removeComponent, applyScoreModifiers, KNOWN_HOOKS };
