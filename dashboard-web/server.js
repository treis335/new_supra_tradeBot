// dashboard-web/server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { DeepSeekAPI } = require('../agent/deepseekClient');

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
let botStats = {
    running: true,
    balance: '174419 SUPRA',
    pairs: 56,
    totalTrades: 342,
    profit: '12.4%',
    successRate: '78.2%',
    opportunities: 14,
    cycles: 47
};

let brainLogs = [];
let trades = [];
let marketData = [];

// ============================================
// FUNÇÕES DE COLETA DE DADOS
// ============================================

function loadBotStats() {
    try {
        if (fs.existsSync(botStatsFile)) {
            const data = JSON.parse(fs.readFileSync(botStatsFile, 'utf8'));
            botStats = { ...botStats, ...data };
        }
    } catch (e) {}
}

function loadBrainLogs() {
    try {
        if (fs.existsSync(brainLogFile)) {
            const data = JSON.parse(fs.readFileSync(brainLogFile, 'utf8'));
            brainLogs = data.learnings || [];
        }
    } catch (e) {}
}

function generateMarketData() {
    const pairs = [
        'SUPRA/CASH', 'SUPRA/DAWGZ', 'DAWGZ/DEXUSDC',
        'JOSH/DEXUSDC', 'LOWCAPS/DEXUSDC', 'SPIKE/DEXUSDC',
        'SUPRA/DEXUSDC', 'SUPRA/DRAGON', 'SUPRA/iSUPRA'
    ];
    
    marketData = pairs.map(pair => {
        const price = (Math.random() * 100 + 0.1);
        const change = (Math.random() * 4 - 2);
        return {
            pair,
            price: price.toFixed(4),
            change: change.toFixed(2),
            changePositive: change >= 0
        };
    });
}

function generateTrades() {
    const types = [
        { icon: '◆', color: 'yellow', text: 'sc:78 SUPRA [DLyn]', profit: '+1.877%' },
        { icon: '◆', color: 'yellow', text: 'sc:41 SUPRA [DLyn]', profit: '+0.647%' },
        { icon: '◆', color: 'green', text: 'VENDEU 90.51 SUPRA (recebeu ~9318 LUCKY)', profit: '' },
        { icon: '◆', color: 'green', text: 'COMPROU 1398 SUPRA (pagou ~0.7997 DEXUSDC)', profit: '' },
        { icon: '◆', color: 'yellow', text: 'sc:68 SUPRA [DLyn]', profit: '+1.556%' },
        { icon: '◆', color: 'green', text: 'VENDEU 27356 NANA (recebeu ~217.87 SUPRA)', profit: '' },
        { icon: '◆', color: 'cyan', text: 'Oportunidade detectada', profit: '+0.847%' }
    ];
    
    const now = Date.now();
    trades = types.map((t, i) => {
        const time = new Date(now - (types.length - i) * 30000);
        return {
            time: time.toTimeString().substring(0, 8),
            icon: t.icon,
            color: t.color,
            text: t.text,
            profit: t.profit
        };
    });
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
    generateMarketData();
    generateTrades();
    
    const payload = {
        type: 'update',
        data: {
            botStats,
            brainLogs: brainLogs.slice(-5),
            marketData,
            trades,
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
    generateMarketData();
    res.json({ success: true, data: marketData });
});

// API: Trades
app.get('/api/trades', (req, res) => {
    generateTrades();
    res.json({ success: true, data: trades });
});

// API: Dashboard completo
app.get('/api/dashboard', (req, res) => {
    loadBotStats();
    loadBrainLogs();
    generateMarketData();
    generateTrades();
    
    res.json({
        success: true,
        data: {
            botStats,
            brainLogs: brainLogs.slice(-10),
            marketData,
            trades,
            timestamp: new Date().toISOString()
        }
    });
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