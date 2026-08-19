// dashboard-web/public/script.js

// ============================================
// CONFIGURAÇÕES
// ============================================
const WS_URL = `ws://${window.location.host}`;
const API_URL = window.location.origin;

let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

// ============================================
// DOM REFS
// ============================================
const elements = {
    connectionStatus: document.getElementById('connectionStatus'),
    botRunning: document.getElementById('botRunning'),
    botBalance: document.getElementById('botBalance'),
    botPairs: document.getElementById('botPairs'),
    botTrades: document.getElementById('botTrades'),
    botProfit: document.getElementById('botProfit'),
    botSuccess: document.getElementById('botSuccess'),
    botCycles: document.getElementById('botCycles'),
    brainLogs: document.getElementById('brainLogs'),
    marketData: document.getElementById('marketData'),
    tradesLog: document.getElementById('tradesLog'),
    consoleOutput: document.getElementById('consoleOutput'),
    commandInput: document.getElementById('commandInput'),
    sendButton: document.getElementById('sendCommand'),
    lastUpdate: document.getElementById('lastUpdate'),
    metricProfit: document.getElementById('metricProfit'),
    metricTrades: document.getElementById('metricTrades'),
    metricSuccess: document.getElementById('metricSuccess'),
    metricOpportunities: document.getElementById('metricOpportunities'),
    metricVolume: document.getElementById('metricVolume'),
    metricCycles: document.getElementById('metricCycles'),
    brainCount: document.getElementById('brainCount'),
    tradesCount: document.getElementById('tradesCount'),
    marketCount: document.getElementById('marketCount')
};

// ============================================
// WEBSOCKET
// ============================================

function connectWebSocket() {
    try {
        ws = new WebSocket(WS_URL);
        
        ws.onopen = () => {
            console.log('🟢 WebSocket conectado!');
            updateConnectionStatus(true);
            reconnectAttempts = 0;
            addConsoleLine('🤖 Sistema: Conectado ao servidor!', 'system');
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'update') {
                    updateDashboard(data.data);
                }
            } catch (e) {
                console.error('Erro ao processar mensagem:', e);
            }
        };
        
        ws.onclose = () => {
            console.log('🔴 WebSocket desconectado!');
            updateConnectionStatus(false);
            addConsoleLine('⚠️ Conexão perdida. Tentando reconectar...', 'error');
            attemptReconnect();
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    } catch (e) {
        console.error('Erro ao conectar WebSocket:', e);
        attemptReconnect();
    }
}

function attemptReconnect() {
    if (reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++;
        setTimeout(() => {
            console.log(`🔄 Tentando reconectar (${reconnectAttempts}/${MAX_RECONNECT})...`);
            connectWebSocket();
        }, 2000 * reconnectAttempts);
    } else {
        addConsoleLine('❌ Falha na conexão. Recarregue a página.', 'error');
    }
}

function updateConnectionStatus(connected) {
    const badge = elements.connectionStatus;
    const dot = badge.querySelector('.dot');
    const text = badge.textContent.trim();
    
    if (connected) {
        dot.className = 'dot connected';
        badge.innerHTML = '<span class="dot connected"></span> Conectado';
    } else {
        dot.className = 'dot disconnected';
        badge.innerHTML = '<span class="dot disconnected"></span> Desconectado';
    }
}

// ============================================
// ATUALIZAR DASHBOARD
// ============================================

function updateDashboard(data) {
    if (!data) return;
    
    // Atualizar timestamp
    if (data.timestamp) {
        const date = new Date(data.timestamp);
        elements.lastUpdate.textContent = date.toLocaleTimeString();
    }
    
    // Status do Bot
    if (data.botStats) {
        const stats = data.botStats;
        elements.botRunning.textContent = stats.running ? '🟢 ATIVO' : '🔴 PAUSADO';
        elements.botBalance.textContent = stats.balance || '174419 SUPRA';
        elements.botPairs.textContent = stats.pairs || 56;
        elements.botTrades.textContent = stats.totalTrades || 0;
        elements.botProfit.textContent = stats.profit || '0%';
        elements.botSuccess.textContent = stats.successRate || '0%';
        elements.botCycles.textContent = stats.cycles || 0;
        
        // Métricas
        elements.metricProfit.textContent = stats.profit || '0%';
        elements.metricTrades.textContent = stats.totalTrades || 0;
        elements.metricSuccess.textContent = stats.successRate || '0%';
        elements.metricOpportunities.textContent = stats.opportunities || 0;
        elements.metricCycles.textContent = stats.cycles || 0;
        elements.metricVolume.textContent = stats.volume || '0 SUPRA';
    }
    
    // Pensamentos do Cérebro
    if (data.brainLogs && data.brainLogs.length > 0) {
        const brainHTML = data.brainLogs.map(log => `
            <div class="brain-thought">
                <span class="thought-time">${log.timestamp ? new Date(log.timestamp).toTimeString().substring(0, 8) : '--:--'}</span>
                <span class="thought-text">${log.analysis ? log.analysis.substring(0, 80) + '...' : 'Nenhum pensamento'}</span>
            </div>
        `).join('');
        elements.brainLogs.innerHTML = brainHTML;
        elements.brainCount.textContent = `${data.brainLogs.length} pensamentos`;
    }
    
    // Mercado
    if (data.marketData && data.marketData.length > 0) {
        const marketHTML = data.marketData.map(item => `
            <div class="market-item">
                <span class="pair">${item.pair}</span>
                <span class="price">${item.price}</span>
                <span class="change ${item.changePositive ? 'positive' : 'negative'}">
                    ${item.changePositive ? '+' : ''}${item.change}%
                </span>
            </div>
        `).join('');
        elements.marketData.innerHTML = marketHTML;
        elements.marketCount.textContent = `${data.marketData.length} pares`;
    }
    
    // Trades
    if (data.trades && data.trades.length > 0) {
        const tradesHTML = data.trades.map(trade => `
            <div class="trade-item ${trade.color}">
                <span class="trade-time">${trade.time}</span>
                <span class="trade-icon">${trade.icon}</span>
                <span class="trade-text">${trade.profit ? trade.profit + ' ' : ''}${trade.text}</span>
            </div>
        `).join('');
        elements.tradesLog.innerHTML = tradesHTML;
        elements.tradesCount.textContent = `${data.trades.length} trades`;
    }
}

// ============================================
// CONSOLE DE COMANDOS
// ============================================

function addConsoleLine(text, type = 'user') {
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    line.textContent = text;
    elements.consoleOutput.appendChild(line);
    elements.consoleOutput.scrollTop = elements.consoleOutput.scrollHeight;
}

async function sendCommand() {
    const input = elements.commandInput;
    const command = input.value.trim();
    
    if (!command) return;
    
    // Limpar input
    input.value = '';
    input.focus();
    
    // Adicionar ao console
    addConsoleLine(`💬 Você: ${command}`, 'user');
    
    try {
        const response = await fetch(`${API_URL}/api/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command })
        });
        
        const data = await response.json();
        
        if (data.success) {
            addConsoleLine(`🤖 Bot: ${data.response}`, 'bot');
        } else {
            addConsoleLine(`❌ Erro: ${data.error || 'Comando não processado'}`, 'error');
        }
    } catch (error) {
        addConsoleLine(`❌ Erro na comunicação: ${error.message}`, 'error');
    }
}

// ============================================
// EVENTOS
// ============================================

// Enviar comando com Enter
elements.commandInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendCommand();
    }
});

// Enviar comando com botão
elements.sendButton.addEventListener('click', sendCommand);

// ============================================
// INICIALIZAR
// ============================================

function init() {
    console.log('🚀 Iniciando Dashboard Web...');
    
    // Adicionar mensagem inicial
    addConsoleLine('🚀 Dashboard inicializado!', 'system');
    addConsoleLine('💡 Digite "status", "pausar", "retomar", "performance" ou faça uma pergunta.', 'system');
    
    // Conectar WebSocket
    connectWebSocket();
    
    // Carregar dados iniciais
    fetch(`${API_URL}/api/dashboard`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                updateDashboard(data.data);
            }
        })
        .catch(err => {
            console.error('Erro ao carregar dados iniciais:', err);
        });
}

// Iniciar quando a página carregar
document.addEventListener('DOMContentLoaded', init);