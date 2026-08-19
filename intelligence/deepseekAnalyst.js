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
                { role: 'system', content: systemPrompt },
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

        const applied = {};
        for (const [key, bounds] of Object.entries(SAFE_BOUNDS)) {
            const suggested = result.suggestions?.[key];
            if (suggested === null || suggested === undefined) continue;
            const clamped = clamp(Number(suggested), bounds);
            if (clamped !== CONFIG.autoExecute[key]) {
                applied[key] = { from: CONFIG.autoExecute[key], to: clamped };
                CONFIG.autoExecute[key] = clamped;
            }
        }

        const reportEntry = {
            ts: Date.now(), type: 'performance_analysis',
            summary, reasoning: result.reasoning, confidence: result.confidence, applied,
        };
        fs.appendFileSync(REPORT_FILE, JSON.stringify(reportEntry) + '\n');
        logEvent('analyst_config_change', { applied, reasoning: result.reasoning });

        if (Object.keys(applied).length > 0) {
            log(`{cyan-fg}🧠 Analista: ${Object.keys(applied).length} parametro(s) ajustado(s). "${result.reasoning}"{/}`);
        }

        return { applied, reasoning: result.reasoning };
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

module.exports = { analyzePerformance, assessNewPool };
