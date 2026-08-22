// intelligence/strategist.js
//
// O quarto papel da equipa: "pensa". Não ajusta parâmetros (isso é o
// Analista, deepseekAnalyst.js) nem escreve código (isso é o Programador,
// codeAgent.js) -- olha para o panorama completo (que rotas têm dado
// lucro, que DEXs performam melhor, que propostas têm sido aprovadas vs
// rejeitadas vs revertidas, que componentes estão ativos) e escreve um
// briefing de prioridades. Esse briefing é injetado automaticamente no
// prompt de TODOS os outros agentes (ver agentCharter.js), para eles
// pensarem dentro do mesmo foco em vez de cada um andar a puxar para um
// lado. Nunca aplica nada sozinho -- no máximo cria propostas 'idea'
// (sempre informativas, nunca mudam o bot sozinhas).

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config/config');
const { readRecentHistory } = require('./historyLogger');
const { listProposals, addProposal } = require('./proposalQueue');
const { loadRegistry } = require('./componentRegistry');
const { withCharter } = require('./agentCharter');
const { generateComponent } = require('./codeAgent');
const { logError } = require('../utils/logError');

const BRIEF_FILE = path.join(__dirname, '..', 'data', 'strategic_brief.json');
const DISPATCH_LOG_FILE = path.join(__dirname, '..', 'data', 'strategist_dispatch_log.json');

let hunterMemory = null;
try { hunterMemory = require('../hunter/opportunityMemory'); } catch { hunterMemory = null; }

async function callDeepSeek(systemPrompt, userPrompt) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return null;

    const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: withCharter(systemPrompt) },
                { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.5,
        }),
    });

    if (!res.ok) throw new Error(`DeepSeek API respondeu ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    return content ? JSON.parse(content) : null;
}

function buildTeamContext() {
    const events = readRecentHistory({ sinceHoursAgo: 7 * 24 });
    const trades = events.filter(e => e.type === 'trade_executed');

    const allProposals = listProposals();
    const proposalStats = {
        total: allProposals.length,
        applied: allProposals.filter(p => p.status === 'applied').length,
        rejected: allProposals.filter(p => p.status === 'rejected').length,
        rolledBack: allProposals.filter(p => p.type === 'rollback').length,
        byType: {},
    };
    for (const p of allProposals) {
        proposalStats.byType[p.type] = (proposalStats.byType[p.type] || 0) + 1;
    }

    return {
        janela: '7 dias',
        totalTrades: trades.length,
        successRate: trades.length ? trades.filter(t => t.success).length / trades.length : null,
        rotasQuentes: hunterMemory ? hunterMemory.getHotRoutes(3).slice(0, 8) : [],
        performancePorDex: hunterMemory ? hunterMemory.getDexPerformance() : [],
        historicoDePropostas: proposalStats,
        componentesAtivos: loadRegistry().map(c => ({ targetPath: c.targetPath, hookName: c.hookName, ativoDesde: new Date(c.activatedAt).toISOString() })),
        configAtual: CONFIG.autoExecute,
        dexesConfigurados: Object.keys(CONFIG.dexes || {}),
    };
}

const SYSTEM_PROMPT = `És o Estratega da equipa de agentes deste bot de arbitragem na blockchain Supra. Não ajustas parâmetros nem escreves código -- olhas para o panorama completo (rotas, DEXs, histórico de propostas, componentes ativos) e decides ONDE vale a pena o resto da equipa (Analista de performance, Programador de componentes) gastar esforço a seguir.

O teu objetivo de fundo: o bot deve focar-se em capturar oportunidades de lucro REAIS dentro do ecossistema Supra -- não estás limitado a uma lista fixa de rotas, mas cada prioridade que apontares tem de estar ancorada nos dados que te dou, não em ideias genéricas de arbitragem sem ligação ao que este bot já viu.

Responde APENAS em JSON:
{
  "resumo": "1-2 frases sobre o estado geral, em português",
  "prioridades": [
    { "foco": "titulo curto", "porque": "justificacao com base nos dados dados", "paraQuem": "analista" | "programador" | "ambos" }
  ],
  "ideiasParaHumano": [
    { "ideia": "algo que vale a pena o humano considerar mas que nao e um simples ajuste de parametro ou componente -- ex: novo par a vigiar, nova fonte de dados", "prioridade": "baixa" | "media" | "alta" }
  ]
}
No máximo 4 prioridades e 3 ideias. Sem preenchimento -- se os dados não sustentam mais do que 1-2 prioridades claras, não inventes as restantes.`;

async function generateStrategicBrief(log = console.log) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return { skipped: true, reason: 'DEEPSEEK_API_KEY não configurada' };

    const context = buildTeamContext();
    if (context.totalTrades < 5 && context.rotasQuentes.length === 0) {
        return { skipped: true, reason: 'ainda sem dados suficientes (poucas trades e sem rotas quentes) para uma análise estratégica útil' };
    }

    let result;
    try {
        result = await callDeepSeek(SYSTEM_PROMPT, JSON.stringify(context, null, 2));
    } catch (e) {
        logError('strategist.callDeepSeek', e);
        return { error: e.message };
    }
    if (!result) return { skipped: true, reason: 'resposta vazia da DeepSeek' };

    const brief = {
        resumo: result.resumo || '',
        prioridades: Array.isArray(result.prioridades) ? result.prioridades.slice(0, 4) : [],
        ideiasParaHumano: Array.isArray(result.ideiasParaHumano) ? result.ideiasParaHumano.slice(0, 3) : [],
        generatedAt: Date.now(),
    };

    try {
        const dir = path.dirname(BRIEF_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(BRIEF_FILE, JSON.stringify(brief, null, 2));
    } catch (e) {
        logError('strategist.saveBrief', e);
    }

    // Ideias mais relevantes ficam também como propostas 'idea' -- aparecem
    // no dashboard como qualquer outra proposta, mas nunca mudam nada
    // sozinhas (proposalApplier.applyIdea é sempre um no-op informativo).
    for (const ideia of brief.ideiasParaHumano) {
        if (ideia.prioridade === 'alta' || ideia.prioridade === 'media') {
            addProposal({
                type: 'idea',
                summary: `[Estratega] ${ideia.ideia}`,
                payload: ideia,
                source: 'strategist.generateStrategicBrief',
            });
        }
    }

    // Prioridades para o Programador disparam automaticamente um pedido de
    // componente -- ninguém precisa de escrever nada na caixa de texto. O
    // Programador continua a passar pelo scan de segurança e o resultado
    // fica sempre como proposta 'pending' -- isto só remove o "humano tem
    // de pedir por palavras", nunca o "humano tem de aprovar antes de ir
    // para produção".
    await dispatchToProgrammer(brief.prioridades, log);

    log(`{magenta-fg}🧭 Estratega atualizou prioridades: ${brief.resumo}{/}`);
    return { brief };
}

function loadLatestBrief() {
    try {
        if (!fs.existsSync(BRIEF_FILE)) return null;
        return JSON.parse(fs.readFileSync(BRIEF_FILE, 'utf8'));
    } catch { return null; }
}

// Máximo de pedidos automáticos ao Programador por briefing -- mesmo que o
// Estratega devolva 4 prioridades para "programador", nunca dispara mais do
// que isto de uma vez. É uma fila de propostas para reveres, não uma
// enxurrada -- várias propostas simultâneas tornam a revisão pior, não melhor.
const MAX_AUTO_DISPATCH_PER_CYCLE = 2;

// Não repete o mesmo pedido ao Programador antes de passar este tempo,
// mesmo que a prioridade continue a aparecer ciclo após ciclo (ex: porque
// ainda ninguém reviu a proposta anterior). Registo próprio -- comparar
// contra o resumo da proposta gerada não funciona, porque o Programador
// escreve a sua própria explicação, não repete o "foco" original.
const DISPATCH_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 dias

function loadDispatchLog() {
    try {
        if (!fs.existsSync(DISPATCH_LOG_FILE)) return [];
        const data = JSON.parse(fs.readFileSync(DISPATCH_LOG_FILE, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch { return []; }
}

function saveDispatchLog(list) {
    const dir = path.dirname(DISPATCH_LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Mantém só entradas recentes -- este ficheiro é só para dedupe, não precisa de histórico longo.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    fs.writeFileSync(DISPATCH_LOG_FILE, JSON.stringify(list.filter(e => e.dispatchedAt > cutoff), null, 2));
}

function normalizeFoco(foco) {
    return String(foco).toLowerCase().trim();
}

async function dispatchToProgrammer(prioridades, log) {
    const paraProgramador = prioridades.filter(p => p.paraQuem === 'programador' || p.paraQuem === 'ambos');
    if (paraProgramador.length === 0) return;

    const dispatchLog = loadDispatchLog();

    let dispatched = 0;
    for (const p of paraProgramador) {
        if (dispatched >= MAX_AUTO_DISPATCH_PER_CYCLE) break;

        const focoNorm = normalizeFoco(p.foco);
        const jaPedidoRecentemente = dispatchLog.some(e => e.foco === focoNorm && (Date.now() - e.dispatchedAt) < DISPATCH_COOLDOWN_MS);
        if (jaPedidoRecentemente) continue;

        try {
            const request = `${p.foco}. ${p.porque}`;
            const result = await generateComponent(request, log);
            if (result.proposal) {
                log(`{cyan-fg}🧭→🛠️ Estratega pediu ao Programador: "${p.foco}" -- proposta criada, aguarda revisão.{/}`);
                dispatched++;
                dispatchLog.push({ foco: focoNorm, dispatchedAt: Date.now() });
            }
        } catch (e) {
            logError('strategist.dispatchToProgrammer', e);
        }
    }
    saveDispatchLog(dispatchLog);
}

module.exports = { generateStrategicBrief, loadLatestBrief };
