// intelligence/deepseekAnalyst.js
//
// Corre PERIODICAMENTE (nao a cada trade -- LLMs sao lentos demais para decisoes
// em tempo real de arbitragem). Le o historico persistente, pede a DeepSeek para
// analisar padroes e sugerir ajustes de configuracao, e aplica-os DENTRO DE LIMITES
// SEGUROS fixos no codigo (nunca confia cegamente na resposta do modelo).
//
// Tambem avalia pools novos que a Spikey descobriu sozinha (spikeyDiscovery.js),
// decidindo se sao seguros para trading automatico ou se ficam de quarentena
// (ex: liquidez demasiado baixa, nome de token suspeito).

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config/config');
const { readRecentHistory, logEvent } = require('./historyLogger');
const { logError } = require('../utils/logError');
const { addProposal } = require('./proposalQueue');
const { withCharter } = require('./agentCharter');

const REPORT_FILE = path.join(__dirname, '..', 'data', 'analyst_reports.jsonl');

// Limites de seguranca -- a DeepSeek pode sugerir valores dentro destes intervalos,
// nunca fora deles, independentemente do que "achar" que seria melhor.
const SAFE_BOUNDS = {
    minProfitPct: { min: 0.15, max: 1.5 },
    crossDexMinProfitPct: { min: 0.5, max: 3.0 },
    cooldownMs: { min: 800, max: 5000 },
    maxTradesPerTick: { min: 1, max: 6 },
};

function clamp(value, bounds) {
    return Math.max(bounds.min, Math.min(bounds.max, value));
}

async function callDeepSeek(systemPrompt, userPrompt) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return null;

    const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: withCharter(systemPrompt) },
                { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2, // baixa -- queremos consistencia, nao criatividade, em decisoes de dinheiro real
        }),
    });

    if (!res.ok) {
        throw new Error(`DeepSeek API respondeu ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content);
}

// ── Analise de performance geral + ajuste de parametros ──────────────────
async function analyzePerformance(log = () => {}) {
    const events = readRecentHistory({ sinceHoursAgo: 24 });
    if (events.length < 10) {
        return { skipped: true, reason: 'historico insuficiente (< 10 eventos nas ultimas 24h)' };
    }

    const trades = events.filter(e => e.type === 'trade_executed');
    const snapshots = events.filter(e => e.type === 'opportunity_snapshot');
    const successCount = trades.filter(t => t.success).length;
    const failCount = trades.filter(t => !t.success).length;
    const totalProfitAbs = trades.filter(t => t.success).reduce((s, t) => s + (t.profitAbs || 0), 0);

    const summary = {
        periodHours: 24,
        totalTrades: trades.length,
        successCount, failCount,
        successRate: trades.length ? (successCount / trades.length) : 0,
        totalProfitAbs,
        avgOpportunitiesSeen: snapshots.length ? (snapshots.reduce((s, e) => s + e.count, 0) / snapshots.length) : 0,
        avgBestProfitPct: snapshots.length ? (snapshots.reduce((s, e) => s + e.bestProfitPct, 0) / snapshots.length) : 0,
        crossDexOpportunitiesSeen: snapshots.reduce((s, e) => s + (e.crossDexCount || 0), 0),
        currentConfig: {
            minProfitPct: CONFIG.autoExecute.minProfitPct,
            crossDexMinProfitPct: CONFIG.autoExecute.crossDexMinProfitPct,
            cooldownMs: CONFIG.autoExecute.cooldownMs,
            maxTradesPerTick: CONFIG.autoExecute.maxTradesPerTick,
        },
    };

    const systemPrompt = `Es um analista de risco para um bot de arbitragem cripto (rede Supra blockchain, DEXs Dexlyn e Spikey). 
A tua funcao e sugerir ajustes de configuracao com base em dados de performance reais, para maximizar lucro sem aumentar risco desnecessariamente.
Responde APENAS em JSON com esta estrutura exata:
{
  "reasoning": "explicacao curta em portugues do que observaste",
  "suggestions": {
    "minProfitPct": <numero ou null se nao sugerires mudanca>,
    "crossDexMinProfitPct": <numero ou null>,
    "cooldownMs": <numero ou null>,
    "maxTradesPerTick": <numero ou null>
  },
  "confidence": "low" | "medium" | "high"
}
Se os dados forem insuficientes ou ambiguos para uma sugestao especifica, usa null nesse campo em vez de adivinhar.
Se successRate for baixa (<50%), considera SUBIR os limiares de lucro minimo (menos trades, mas mais seguras), nao descer.`;

    const userPrompt = `Dados de performance das ultimas ${summary.periodHours}h:\n${JSON.stringify(summary, null, 2)}`;

    try {
        const result = await callDeepSeek(systemPrompt, userPrompt);
        if (!result) return { skipped: true, reason: 'DEEPSEEK_API_KEY nao configurada' };

        // Alinhado com o design do proposalQueue/proposalApplier: NADA se aplica
        // sozinho, mesmo dentro de limites seguros. Cria uma proposta "config_adjust"
        // e fica a aguardar aprovacao no dashboard -- os limites de SAFE_BOUNDS sao
        // reaplicados no momento de aprovar (proposalApplier.js), como defesa extra.
        const suggestedChanges = {};
        for (const key of Object.keys(SAFE_BOUNDS)) {
            const suggested = result.suggestions?.[key];
            if (suggested === null || suggested === undefined) continue;
            if (Number(suggested) !== CONFIG.autoExecute[key]) suggestedChanges[key] = Number(suggested);
        }

        let proposal = null;
        if (Object.keys(suggestedChanges).length > 0) {
            proposal = addProposal({
                type: 'config_adjust',
                summary: `Analista sugere ajustar: ${Object.entries(suggestedChanges).map(([k, v]) => `${k}=${v}`).join(', ')} — "${result.reasoning}"`,
                payload: suggestedChanges,
                source: 'deepseekAnalyst.analyzePerformance',
            });
        }

        const reportEntry = {
            ts: Date.now(), type: 'performance_analysis',
            summary, reasoning: result.reasoning, confidence: result.confidence,
            proposalId: proposal?.id || null,
        };
        fs.appendFileSync(REPORT_FILE, JSON.stringify(reportEntry) + '\n');
        logEvent('analyst_suggestion', { suggestedChanges, reasoning: result.reasoning });

        if (proposal) {
            log(`{cyan-fg}🧠 Analista: proposta nova no dashboard (${Object.keys(suggestedChanges).length} parâmetro(s)). "${result.reasoning}"{/}`);
        }

        return { proposal, reasoning: result.reasoning };
    } catch (e) {
        logError('deepseekAnalyst.analyzePerformance', e);
        return { error: e.message };
    }
}

// ── Avaliacao de risco de pools novos (Spikey) antes de ativar trading neles ──
async function assessNewPool(pool, log = () => {}) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return { safe: true, reason: 'sem DEEPSEEK_API_KEY -- aceita por defeito' };

    const systemPrompt = `Es um analista de risco a avaliar se um pool de liquidez novo (recem-descoberto on-chain
na Spikey, rede Supra) deve ser ativado para trading automatico com dinheiro real.
Considera: nomes de tokens suspeitos (imitacoes de tokens conhecidos, nomes de scam comuns tipo "SAFEMOON",
"ELON", excesso de emojis/caracteres estranhos), decimais anormais, pares sem contraparte reconhecida (SUPRA/DEXUSDC/etc).
Responde APENAS em JSON: {"safe": true|false, "reason": "explicacao curta em portugues", "confidence": "low"|"medium"|"high"}
Em caso de duvida real, usa safe:false (mais vale ficar de fora de um pool bom do que arriscar um pool mau).`;

    const userPrompt = `Pool novo detectado: ${JSON.stringify(pool)}`;

    try {
        const result = await callDeepSeek(systemPrompt, userPrompt);
        if (!result) return { safe: true, reason: 'resposta vazia -- aceita por defeito' };

        logEvent('analyst_pool_assessment', { pool: pool.address, tokenA: pool.tokenA, tokenB: pool.tokenB, ...result });
        if (!result.safe) {
            log(`{yellow-fg}🧠 Analista: pool ${pool.tokenA}/${pool.tokenB} marcado como suspeito -- "${result.reason}". Nao ativado.{/}`);
        }
        return result;
    } catch (e) {
        logError('deepseekAnalyst.assessNewPool', e);
        return { safe: true, reason: 'erro na analise -- aceita por defeito (falha aberta)' };
    }
}

// ── Ideias mais abertas (novos pares a vigiar, padroes horarios, etc) ─────
// Diferente de analyzePerformance (numeros dentro de limites fixos, aplicados
// direto -- ja aprovaste esse padrao), isto pode sugerir coisas mais amplas.
// Por isso NAO aplica nada sozinho -- cria uma proposta "idea" que so serve
// para leres no dashboard. Nunca vira codigo ou config sem passares por ali.
async function generateCapabilityReport(log = () => {}) {
    const events = readRecentHistory({ sinceHoursAgo: 48, maxEvents: 5000 });
    const marketSnapshots = events.filter(e => e.type === 'market_snapshot');
    const activityBatches = events.filter(e => e.type === 'market_activity_batch');
    const trades = events.filter(e => e.type === 'trade_executed');

    if (marketSnapshots.length < 2 && activityBatches.length < 5) {
        return { skipped: true, reason: 'dados insuficientes ainda (deixa o bot correr mais tempo)' };
    }

    const activityByPair = {};
    for (const batch of activityBatches) {
        for (const a of (batch.activities || [])) {
            const key = `${a.dex}_${a.tokenA}/${a.tokenB}`;
            if (!activityByPair[key]) activityByPair[key] = { count: 0, buys: 0, sells: 0 };
            activityByPair[key].count++;
            if (a.isBuyA) activityByPair[key].buys++; else activityByPair[key].sells++;
        }
    }
    const topActivePairs = Object.entries(activityByPair)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 15)
        .map(([key, stats]) => ({ pair: key, ...stats }));

    const systemPrompt = `Es um analista de mercado para um bot de arbitragem cripto (Supra blockchain, DEXs Dexlyn e Spikey).
Com base em dados reais de atividade de mercado (nao inventados), sugere ideias CONCRETAS e ACIONAVEIS para
o operador humano considerar -- NUNCA sugiras auto-implementacao ou auto-modificacao de codigo, so ideias.
Responde APENAS em JSON:
{
  "summary": "resumo curto em portugues do que observaste nos dados",
  "suggestions": [
    {"idea": "descricao curta", "reasoning": "porque, baseado em que dado", "priority": "low"|"medium"|"high"}
  ]
}
Maximo 5 sugestoes. So sugere coisas suportadas pelos dados fornecidos -- nao adivinhes tendencias sem base nos numeros.`;

    const userPrompt = `Pares mais ativos (ultimas 48h, ${activityBatches.length} lotes de atividade observados):
${JSON.stringify(topActivePairs, null, 2)}

Trades executadas pelo bot: ${trades.length} (${trades.filter(t => t.success).length} sucesso)
Snapshots de mercado completo capturados: ${marketSnapshots.length}`;

    try {
        const result = await callDeepSeek(systemPrompt, userPrompt);
        if (!result) return { skipped: true, reason: 'DEEPSEEK_API_KEY nao configurada' };

        const reportEntry = { ts: Date.now(), type: 'capability_report', ...result };
        fs.appendFileSync(REPORT_FILE, JSON.stringify(reportEntry) + '\n');

        // Cada sugestao vira uma proposta "idea" -- fica so para leres, sem efeito
        // automatico nenhum no bot.
        for (const s of (result.suggestions || [])) {
            addProposal({
                type: 'idea',
                summary: `${s.idea} — ${s.reasoning} (prioridade: ${s.priority})`,
                payload: s,
                source: 'deepseekAnalyst.generateCapabilityReport',
            });
        }

        if (result.suggestions?.length > 0) {
            log(`{cyan-fg}🧠 Analista: ${result.suggestions.length} ideia(s) nova(s) no dashboard, a aguardar leitura{/}`);
        }
        return result;
    } catch (e) {
        logError('deepseekAnalyst.generateCapabilityReport', e);
        return { error: e.message };
    }
}

module.exports = { analyzePerformance, assessNewPool, generateCapabilityReport };
