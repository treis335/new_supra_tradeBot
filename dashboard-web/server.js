// dashboard-web/server.js
//
// CORRIGIDO: a versao anterior gerava dados de mercado e trades com Math.random(),
// e o saldo/lucro vinham de valores fixos no codigo -- nada disto refletia o bot
// real. Agora le tudo de data/live_state.json (escrito pelo loop/tick.js real) e
// data/history.jsonl (historico persistente real). Se o bot nao estiver a correr,
// diz isso claramente em vez de inventar numeros.

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { DeepSeekAPI } = require('../agent/deepseekClient');
const { readLiveState } = require('../intelligence/liveStateWriter');
const { readRecentHistory } = require('../intelligence/historyLogger');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.DASHBOARD_PORT || 3000;
const REPORTS_FILE = path.join(__dirname, '..', 'data', 'analyst_reports.jsonl');
const PROPOSALS_FILE = path.join(__dirname, '..', 'data', 'proposals.jsonl');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const deepseek = new DeepSeekAPI();
let clients = [];

// ============================================
// DADOS REAIS (sem Math.random em lado nenhum)
// ============================================

function getRealSnapshot() {
    const live = readLiveState(); // null se o bot nao escreveu nada ainda / esta parado

    const historyEvents = readRecentHistory({ sinceHoursAgo: 24, maxEvents: 500 });
    const trades = historyEvents.filter(e => e.type === 'trade_executed');
    const successCount = trades.filter(t => t.success).length;
    const totalProfitAbs = trades.filter(t => t.success).reduce((s, t) => s + (t.profitAbs || 0), 0);

    return {
        running: !!(live && live.running),
        stale: live ? live.staleForMs : null,
        botStats: {
            balance: live?.walletBalances?.SUPRA != null ? `${live.walletBalances.SUPRA} SUPRA` : 'sem dados',
            pairs: live?.pairCount ?? 0,
            totalTrades24h: trades.length,
            successCount, failCount: trades.length - successCount,
            successRate: trades.length ? ((successCount / trades.length) * 100).toFixed(1) + '%' : '—',
            profitAbs24h: totalProfitAbs.toFixed(4) + ' SUPRA',
            opportunities: live?.opportunityCount ?? 0,
            bestOpportunity: live?.bestOpportunity || null,
        },
        marketData: (live?.topPairs || []).map(p => ({
            pair: `${p.tokenA}/${p.tokenB}`, dex: p.dex,
            price: p.priceAinB != null ? Number(p.priceAinB).toFixed(6) : '—',
        })),
        trades: (live?.recentTrades || []).map(t => ({
            time: t.time, dex: t.dex, path: t.path,
            profit: t.profitPct != null ? `+${t.profitPct.toFixed(3)}%` : '',
            success: t.success, error: t.error || null,
        })),
        updatedAt: live?.updatedAt || null,
    };
}

function getRecentAnalystReports() {
    try {
        if (!fs.existsSync(REPORTS_FILE)) return [];
        const lines = fs.readFileSync(REPORTS_FILE, 'utf8').split('\n').filter(Boolean);
        return lines.slice(-10).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
    } catch { return []; }
}

function getPendingProposals() {
    try {
        if (!fs.existsSync(PROPOSALS_FILE)) return [];
        const lines = fs.readFileSync(PROPOSALS_FILE, 'utf8').split('\n').filter(Boolean);
        return lines.map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(p => p && p.status === 'pending').reverse();
    } catch { return []; }
}

// ============================================
// BROADCAST
// ============================================

function broadcast(data) {
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
    });
}

function updateAllData() {
    const snapshot = getRealSnapshot();
    broadcast({
        type: 'update',
        data: {
            ...snapshot,
            analystReports: getRecentAnalystReports().slice(0, 5),
            pendingProposals: getPendingProposals(),
            timestamp: new Date().toISOString(),
        },
    });
}

// ============================================
// API
// ============================================

app.get('/api/status', (req, res) => {
    res.json({ success: true, data: getRealSnapshot() });
});

app.get('/api/dashboard', (req, res) => {
    const snapshot = getRealSnapshot();
    res.json({
        success: true,
        data: {
            ...snapshot,
            analystReports: getRecentAnalystReports().slice(0, 5),
            pendingProposals: getPendingProposals(),
            timestamp: new Date().toISOString(),
        },
    });
});

app.get('/api/proposals', (req, res) => {
    res.json({ success: true, data: getPendingProposals() });
});

// Aprovar/rejeitar uma proposta -- e AQUI que fica o "botao humano" antes de
// qualquer ideia da IA passar a ter efeito real. Nao existe um caminho que
// aplique propostas automaticamente sem passar por aqui.
app.post('/api/proposals/:id/decide', (req, res) => {
    const { id } = req.params;
    const { decision } = req.body; // 'approved' | 'rejected'
    if (!['approved', 'rejected'].includes(decision)) {
        return res.status(400).json({ success: false, error: 'decision tem de ser approved ou rejected' });
    }
    try {
        if (!fs.existsSync(PROPOSALS_FILE)) return res.status(404).json({ success: false, error: 'sem propostas' });
        const lines = fs.readFileSync(PROPOSALS_FILE, 'utf8').split('\n').filter(Boolean);
        const updated = lines.map(l => {
            const p = JSON.parse(l);
            if (p.id === id) p.status = decision;
            return JSON.stringify(p);
        });
        fs.writeFileSync(PROPOSALS_FILE, updated.join('\n') + '\n');
        res.json({ success: true });
        updateAllData();
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/command', async (req, res) => {
    const { command } = req.body;
    if (!command) return res.json({ success: false, error: 'Comando não fornecido' });

    const cmd = command.toLowerCase().trim();
    let response = '';
    const snapshot = getRealSnapshot();

    switch (cmd) {
        case 'status':
            response = snapshot.running
                ? `📊 STATUS: 🟢 ATIVO\n💰 ${snapshot.botStats.balance}\n📈 ${snapshot.botStats.pairs} pares\n🔄 ${snapshot.botStats.totalTrades24h} trades (24h)\n💹 lucro 24h: ${snapshot.botStats.profitAbs24h}`
                : `📊 STATUS: 🔴 O bot não parece estar a correr (sem atualizações recentes).\nCorre "node index.js" no terminal principal primeiro.`;
            break;
        case 'performance':
            response = `📊 PERFORMANCE (24h real):\n🔄 Trades: ${snapshot.botStats.totalTrades24h}\n🎯 Sucesso: ${snapshot.botStats.successRate}\n💹 Lucro: ${snapshot.botStats.profitAbs24h}\n⚡ Oportunidades agora: ${snapshot.botStats.opportunities}`;
            break;
        default:
            try {
                const context = `Estado atual real do bot: ${JSON.stringify(snapshot.botStats)}`;
                const aiResponse = await deepseek.chat([
                    { role: 'system', content: `Es um assistente de trading. Responde de forma util e concisa, em portugues. ${context}` },
                    { role: 'user', content: command },
                ]);
                response = aiResponse;
            } catch (e) {
                response = '❓ Não entendi o comando, ou a DEEPSEEK_API_KEY não está configurada. Tente: status, performance';
            }
    }

    res.json({ success: true, response, command });
});

// ============================================
// WEBSOCKET
// ============================================

wss.on('connection', (ws) => {
    console.log('🟢 Cliente conectado ao dashboard');
    clients.push(ws);
    updateAllData();
    ws.on('close', () => { clients = clients.filter(c => c !== ws); });
    ws.on('error', (err) => console.error('WebSocket error:', err.message));
});

setInterval(updateAllData, 3000);

server.listen(PORT, () => {
    console.log('🚀 Dashboard Web iniciado (dados reais, sem simulação)');
    console.log(`📊 Acesse: http://localhost:${PORT}`);
    console.log('⚠️  Se o loop/tick.js principal não estiver a correr, o dashboard mostra "sem dados" -- isso é esperado, não um bug.');
});
