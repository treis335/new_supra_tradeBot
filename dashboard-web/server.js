// dashboard-web/server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { DeepSeekAPI } = require('../agent/deepseekClient');
const { listProposals, getProposal, setStatus } = require('../intelligence/proposalQueue');
const { applyProposal, requestManualRestart } = require('../intelligence/proposalApplier');
const { readRecentHistory } = require('../intelligence/historyLogger');
const { generateComponent } = require('../intelligence/codeAgent');
const { addProposal } = require('../intelligence/proposalQueue');
const { loadRegistry } = require('../intelligence/componentRegistry');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configurações
const PORT = 3000;
const brainLogFile = path.join(__dirname, '../.brain_memory.json');
const botStatsFile = path.join(__dirname, '../.bot_stats.json');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Instância do DeepSeek
const deepseek = new DeepSeekAPI();

// ============================================
// ESTADO GLOBAL
// ============================================

let clients = [];
// Sem dados reais ainda -- é isto que se via ANTES de o bot escrever
// .bot_stats.json alguma vez. Não é um placeholder "bonito", é honesto:
// diz claramente que não há bot ligado.
let botStats = {
    running: false,
    balance: 'sem dados',
    pairs: 0,
    totalTrades: 0,
    profit: 'sem dados',
    successRate: 'sem dados',
    opportunities: 0,
    updatedAt: null,
};

let brainLogs = [];
let trades = [];
let marketData = [];

// ============================================
// FUNÇÕES DE COLETA DE DADOS
// ============================================

// Considera o bot "morto" se não escreveu stats há mais de 15s -- evita
// mostrar um número real mas antigo como se fosse ao vivo.
const STATS_STALE_MS = 15000;

function loadBotStats() {
    try {
        if (fs.existsSync(botStatsFile)) {
            const data = JSON.parse(fs.readFileSync(botStatsFile, 'utf8'));
            const isFresh = data.updatedAt && (Date.now() - data.updatedAt) < STATS_STALE_MS;
            botStats = isFresh
                ? { ...data, running: true }
                : { ...data, running: false, balance: 'bot desligado', successRate: 'sem dados' };
        } else {
            botStats = { running: false, balance: 'sem dados', pairs: 0, totalTrades: 0, profit: 'sem dados', successRate: 'sem dados', opportunities: 0, updatedAt: null };
        }
    } catch (e) {
        botStats = { running: false, balance: 'erro ao ler stats', pairs: 0, totalTrades: 0, profit: 'sem dados', successRate: 'sem dados', opportunities: 0, updatedAt: null };
    }
}

function loadBrainLogs() {
    try {
        if (fs.existsSync(brainLogFile)) {
            const data = JSON.parse(fs.readFileSync(brainLogFile, 'utf8'));
            brainLogs = data.learnings || [];
        }
    } catch (e) {}
}

// Mercado e trades reais, lidos do histórico persistente do bot
// (data/history.jsonl) -- nunca inventados. Se não há bot a correr, listas
// vêm vazias, honestamente, em vez de preenchidas com Math.random().
function loadRealMarketAndTrades() {
    const events = readRecentHistory({ sinceHoursAgo: 6, maxEvents: 100 });

    const tradeEvents = events.filter(e => e.type === 'trade_executed').slice(-15).reverse();
    trades = tradeEvents.map(e => ({
        time: new Date(e.ts).toTimeString().substring(0, 8),
        icon: '◆',
        color: e.success ? 'green' : 'red',
        text: `${e.dex || '?'} ${e.path || ''}`.trim(),
        profit: e.profitPct != null ? `${e.success ? '+' : ''}${e.profitPct.toFixed(3)}%` : '',
    }));

    const snapshotEvents = events.filter(e => e.type === 'opportunity_snapshot').slice(-9);
    marketData = snapshotEvents.map(e => ({
        pair: new Date(e.ts).toTimeString().substring(0, 8),
        price: e.bestProfitPct != null ? e.bestProfitPct.toFixed(3) : '0',
        change: e.count || 0,
        changePositive: true,
    }));
}

// ============================================
// BROADCAST PARA CLIENTES
// ============================================

function broadcast(data) {
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function updateAllData() {
    loadBotStats();
    loadBrainLogs();
    loadRealMarketAndTrades();
    
    const payload = {
        type: 'update',
        data: {
            botStats,
            brainLogs: brainLogs.slice(-5),
            marketData,
            trades,
            pendingProposals: listProposals('pending'),
            timestamp: new Date().toISOString()
        }
    };
    
    broadcast(payload);
}

// ============================================
// WEBHOOKS E API ENDPOINTS
// ============================================

// API: Status do bot
app.get('/api/status', (req, res) => {
    res.json({ success: true, data: botStats });
});

// API: Pensamentos do cérebro
app.get('/api/brain', (req, res) => {
    res.json({ success: true, data: brainLogs.slice(-10) });
});

// API: Mercado
app.get('/api/market', (req, res) => {
    loadRealMarketAndTrades();
    res.json({ success: true, data: marketData });
});

// API: Trades
app.get('/api/trades', (req, res) => {
    res.json({ success: true, data: trades });
});

// API: Dashboard completo
app.get('/api/dashboard', (req, res) => {
    loadBotStats();
    loadBrainLogs();
    loadRealMarketAndTrades();
    
    res.json({
        success: true,
        data: {
            botStats,
            brainLogs: brainLogs.slice(-10),
            marketData,
            trades,
            pendingProposals: listProposals('pending'),
            timestamp: new Date().toISOString()
        }
    });
});

// ── Propostas pendentes de aprovação humana ────────────────────────
// Nenhuma proposta muda o bot sozinha. O agente só pode CRIAR propostas
// (via intelligence/proposalQueue.js); só um humano, clicando aqui, é que
// as transforma em mudança real (via intelligence/proposalApplier.js).
app.get('/api/proposals', (req, res) => {
    const status = req.query.status || null;
    res.json({ success: true, data: listProposals(status) });
});

app.post('/api/proposals/:id/approve', (req, res) => {
    const proposal = getProposal(req.params.id);
    if (!proposal) return res.status(404).json({ success: false, error: 'proposta não encontrada' });
    if (proposal.status !== 'pending') return res.status(400).json({ success: false, error: `proposta já está '${proposal.status}'` });

    setStatus(req.params.id, 'approved');
    try {
        const result = applyProposal(req.params.id);
        broadcast({ type: 'proposal_applied', data: { id: req.params.id, result } });
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/proposals/:id/reject', (req, res) => {
    const proposal = getProposal(req.params.id);
    if (!proposal) return res.status(404).json({ success: false, error: 'proposta não encontrada' });
    if (proposal.status !== 'pending') return res.status(400).json({ success: false, error: `proposta já está '${proposal.status}'` });

    setStatus(req.params.id, 'rejected', { reason: req.body?.reason || null });
    broadcast({ type: 'proposal_rejected', data: { id: req.params.id } });
    res.json({ success: true });
});

// Pede à DeepSeek para escrever um componente novo (estratégia/detetor).
// Nunca escreve nada sozinho -- fica registado como proposta 'code_change',
// visível aqui no dashboard, à espera de aprovação. Ver intelligence/codeAgent.js.
app.post('/api/generate-component', async (req, res) => {
    const { request } = req.body || {};
    if (!request || typeof request !== 'string') {
        return res.status(400).json({ success: false, error: 'falta o campo "request" (descreve o que queres que o agente construa)' });
    }
    try {
        const result = await generateComponent(request);
        if (result.error) return res.status(500).json({ success: false, error: result.error });
        if (result.skipped) return res.status(400).json({ success: false, error: result.reason });
        if (result.rejected) return res.status(400).json({ success: false, error: `código descartado: ${result.reason}` });
        broadcast({ type: 'proposal_created', data: result.proposal });
        res.json({ success: true, data: result.proposal });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Reinício manual do bot -- pede ao utils/botSupervisor.js (se o bot estiver
// a correr via start-all.js) para reiniciar o processo de trading. Útil
// depois de aprovar uma mudança, ou só para testar o mecanismo. Se o bot
// cair logo a seguir a este reinício, o supervisor tenta reverter sozinho
// a última mudança aplicada (ver intelligence/proposalApplier.js).
app.post('/api/restart-bot', (req, res) => {
    try {
        requestManualRestart(req.body?.reason);
        res.json({ success: true, message: 'Reinício pedido -- só tem efeito se o bot estiver a correr via "node start-all.js".' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// A "equipa" de agentes: Estratega (pensa), Analista (analisa), Programador
// (constrói), Executor (age -- sempre determinístico, nunca IA). Isto é só
// visibilidade -- nenhum destes endpoints muda o bot sozinho.
app.get('/api/team-brief', (req, res) => {
    try {
        const { loadLatestBrief } = require('../intelligence/strategist');
        res.json({ success: true, data: loadLatestBrief() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/generate-brief', async (req, res) => {
    try {
        const { generateStrategicBrief } = require('../intelligence/strategist');
        const result = await generateStrategicBrief();
        if (result.error) return res.status(500).json({ success: false, error: result.error });
        if (result.skipped) return res.status(400).json({ success: false, error: result.reason });
        broadcast({ type: 'brief_updated', data: result.brief });
        res.json({ success: true, data: result.brief });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Lista os componentes atualmente ligados ao bot real (ver
// intelligence/componentRegistry.js). Só para leitura -- ligar/desligar
// passa sempre por uma proposta (abaixo).
app.get('/api/active-components', (req, res) => {
    try {
        res.json({ success: true, data: loadRegistry() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Componentes que já passaram por uma proposta code_change aprovada mas
// ainda não estão ligados a nenhum hook -- candidatos a "Ativar no bot".
app.get('/api/available-components', (req, res) => {
    try {
        const applied = listProposals('applied').filter(p => p.type === 'code_change');
        const active = loadRegistry();
        const notWired = applied.filter(p => !active.some(a => a.targetPath === p.payload?.targetPath));
        res.json({ success: true, data: notWired.map(p => ({ targetPath: p.payload.targetPath, explanation: p.payload.explanation, proposalId: p.id })) });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Propor ligar um componente já aprovado (code_change aplicado) a um ponto
// de extensão real do bot. Cria uma proposta 'wire_component' -- passa
// sempre pelo mesmo aprovar/rejeitar que tudo o resto, nunca ativa sozinho.
app.post('/api/wire-component', (req, res) => {
    const { targetPath, exportName, hookName, description } = req.body || {};
    if (!targetPath || !exportName || !hookName) {
        return res.status(400).json({ success: false, error: 'faltam targetPath, exportName ou hookName' });
    }
    const proposal = addProposal({
        type: 'wire_component',
        summary: `Ligar ${targetPath} (${exportName}) ao hook "${hookName}"`,
        payload: { targetPath, exportName, hookName, description },
        source: 'dashboard.wire-component',
    });
    broadcast({ type: 'proposal_created', data: proposal });
    res.json({ success: true, data: proposal });
});

app.post('/api/unwire-component', (req, res) => {
    const { targetPath, hookName } = req.body || {};
    if (!targetPath || !hookName) {
        return res.status(400).json({ success: false, error: 'faltam targetPath ou hookName' });
    }
    const proposal = addProposal({
        type: 'unwire_component',
        summary: `Desligar ${targetPath} do hook "${hookName}"`,
        payload: { targetPath, hookName },
        source: 'dashboard.unwire-component',
    });
    broadcast({ type: 'proposal_created', data: proposal });
    res.json({ success: true, data: proposal });
});

// API: Comandos
app.post('/api/command', async (req, res) => {
    const { command } = req.body;
    
    if (!command) {
        return res.json({ success: false, error: 'Comando não fornecido' });
    }
    
    const cmd = command.toLowerCase().trim();
    let response = '';
    
    switch(cmd) {
        case 'status':
            response = `📊 STATUS DO BOT:\n🟢 ${botStats.running ? 'ATIVO' : 'PAUSADO'}\n💰 ${botStats.balance}\n📈 ${botStats.pairs} pares\n🔄 ${botStats.totalTrades} trades\n💹 ${botStats.profit}`;
            break;
        case 'pausar':
            botStats.running = false;
            response = '⏸️ Bot pausado!';
            break;
        case 'retomar':
            botStats.running = true;
            response = '▶️ Bot retomado!';
            break;
        case 'performance':
            response = `📊 PERFORMANCE:\n💹 Lucro: ${botStats.profit}\n🔄 Trades: ${botStats.totalTrades}\n🎯 Sucesso: ${botStats.successRate}\n⚡ Oportunidades: ${botStats.opportunities}`;
            break;
        default:
            // Usar DeepSeek para respostas naturais
            try {
                const aiResponse = await deepseek.chat([
                    { role: 'system', content: 'Você é um assistente de trading. Responda de forma útil e concisa.' },
                    { role: 'user', content: command }
                ]);
                response = aiResponse;
            } catch (e) {
                response = '❓ Não entendi o comando. Tente: status, pausar, retomar, performance';
            }
    }
    
    // Adicionar ao log
    trades.unshift({
        time: new Date().toTimeString().substring(0, 8),
        icon: '💬',
        color: 'white',
        text: `Comando: ${command}`,
        profit: ''
    });
    
    res.json({
        success: true,
        response: response,
        command: command
    });
    
    // Atualizar todos os clientes
    updateAllData();
});

// ============================================
// WEBSOCKET
// ============================================

wss.on('connection', (ws) => {
    console.log('🟢 Cliente conectado!');
    clients.push(ws);
    
    // Enviar dados iniciais
    updateAllData();
    
    ws.on('close', () => {
        clients = clients.filter(client => client !== ws);
        console.log('🔴 Cliente desconectado');
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// ============================================
// ATUALIZAÇÃO AUTOMÁTICA (a cada 3 segundos)
// ============================================

setInterval(() => {
    updateAllData();
}, 3000);

// ============================================
// INICIAR SERVIDOR
// ============================================

server.listen(PORT, () => {
    console.log('🚀 Dashboard Web iniciado!');
    console.log(`📊 Acesse: http://localhost:${PORT}`);
    console.log('='.repeat(50));
    console.log('💡 Comandos disponíveis na interface:');
    console.log('  - status: Ver status do bot');
    console.log('  - pausar: Pausar operações');
    console.log('  - retomar: Retomar operações');
    console.log('  - performance: Ver métricas');
    console.log('  - Qualquer pergunta em português!');
    console.log('='.repeat(50));
});