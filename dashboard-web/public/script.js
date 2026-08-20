// dashboard-web/public/script.js
//
// CORRIGIDO: os nomes de campo aqui nao batiam com o que o server.js real envia
// (ex: stats.totalTrades vs totalTrades24h, stats.cycles vs opportunityCount).
// Agora alinhado com a forma real dos dados, e com o painel de propostas
// (aprovar/rejeitar) que antes nao existia.

const WS_URL = `ws://${window.location.host}`;
const API_URL = window.location.origin;

let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

const elements = {
    connectionStatus: document.getElementById('connectionStatus'),
    botRunning: document.getElementById('botRunning'),
    botBalance: document.getElementById('botBalance'),
    botPairs: document.getElementById('botPairs'),
    botTrades: document.getElementById('botTrades'),
    botProfit: document.getElementById('botProfit'),
    botSuccess: document.getElementById('botSuccess'),
    botCycles: document.getElementById('botCycles'),
    proposalsList: document.getElementById('proposalsList'),
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
    marketCount: document.getElementById('marketCount'),
};

// ============================================
// WEBSOCKET
// ============================================

function connectWebSocket() {
    try {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            updateConnectionStatus(true);
            reconnectAttempts = 0;
            addConsoleLine('🤖 Sistema: Conectado ao servidor!', 'system');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'update') updateDashboard(data.data);
            } catch (e) {
                console.error('Erro ao processar mensagem:', e);
            }
        };

        ws.onclose = () => {
            updateConnectionStatus(false);
            addConsoleLine('⚠️ Conexão perdida. Tentando reconectar...', 'error');
            attemptReconnect();
        };

        ws.onerror = (error) => console.error('WebSocket error:', error);
    } catch (e) {
        console.error('Erro ao conectar WebSocket:', e);
        attemptReconnect();
    }
}

function attemptReconnect() {
    if (reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++;
        setTimeout(connectWebSocket, 2000 * reconnectAttempts);
    } else {
        addConsoleLine('❌ Falha na conexão. Recarregue a página.', 'error');
    }
}

function updateConnectionStatus(connected) {
    const badge = elements.connectionStatus;
    if (connected) {
        badge.innerHTML = '<span class="dot connected"></span> Conectado';
    } else {
        badge.innerHTML = '<span class="dot disconnected"></span> Desconectado';
    }
}

// ============================================
// ATUALIZAR DASHBOARD (dados reais, sem inventar nada)
// ============================================

function updateDashboard(data) {
    if (!data) return;

    if (data.timestamp) {
        elements.lastUpdate.textContent = new Date(data.timestamp).toLocaleTimeString();
    }

    if (data.botStats) {
        const stats = data.botStats;
        elements.botRunning.textContent = data.running ? '🟢 ATIVO' : '🔴 NÃO ESTÁ A CORRER';
        elements.botBalance.textContent = stats.balance || 'sem dados';
        elements.botPairs.textContent = stats.pairs ?? '—';
        elements.botTrades.textContent = stats.totalTrades24h ?? 0;
        elements.botProfit.textContent = stats.profitAbs24h || '—';
        elements.botSuccess.textContent = stats.successRate || '—';
        elements.botCycles.textContent = stats.opportunities ?? 0;

        elements.metricProfit.textContent = stats.profitAbs24h || '—';
        elements.metricTrades.textContent = stats.totalTrades24h ?? 0;
        elements.metricSuccess.textContent = stats.successRate || '—';
        elements.metricOpportunities.textContent = stats.opportunities ?? 0;
        elements.metricCycles.textContent = data.stale != null ? `${Math.round(data.stale / 1000)}s atrás` : '—';
        elements.metricVolume.textContent = stats.pairs ?? '—';
    }

    // Propostas pendentes -- cada uma com botao de aprovar/rejeitar real
    if (data.pendingProposals) {
        renderProposals(data.pendingProposals);
    }

    // Mercado
    if (data.marketData) {
        if (data.marketData.length > 0) {
            elements.marketData.innerHTML = data.marketData.map(item => `
                <div class="market-item">
                    <span class="pair">[${item.dex}] ${item.pair}</span>
                    <span class="price">${item.price}</span>
                </div>
            `).join('');
        } else {
            elements.marketData.innerHTML = `<div class="market-item"><span class="pair">Sem dados ainda — liga o bot principal (node index.js)</span></div>`;
        }
        elements.marketCount.textContent = `${data.marketData.length} pares`;
    }

    // Trades reais
    if (data.trades) {
        if (data.trades.length > 0) {
            elements.tradesLog.innerHTML = data.trades.map(trade => `
                <div class="trade-item ${trade.success ? 'green' : 'red'}">
                    <span class="trade-time">${trade.time}</span>
                    <span class="trade-icon">${trade.success ? '✅' : '❌'}</span>
                    <span class="trade-text">[${trade.dex}] ${trade.path}${trade.profit ? ' ' + trade.profit : ''}${trade.error ? ' — ' + trade.error : ''}</span>
                </div>
            `).join('');
        } else {
            elements.tradesLog.innerHTML = `<div class="trade-item"><span class="trade-text">Sem trades ainda.</span></div>`;
        }
        elements.tradesCount.textContent = `${data.trades.length} trades`;
    }
}

function renderProposals(proposals) {
    elements.brainCount.textContent = `${proposals.length} pendentes`;

    if (proposals.length === 0) {
        elements.proposalsList.innerHTML = `<div class="brain-thought"><span class="thought-text">Sem propostas pendentes. O analista sugere aqui ideias e ajustes — nada é aplicado sem aprovares.</span></div>`;
        return;
    }

    elements.proposalsList.innerHTML = proposals.map(p => `
        <div class="brain-thought proposal-item" data-id="${p.id}">
            <div class="proposal-header">
                <span class="thought-time">${new Date(p.ts).toLocaleString()}</span>
                <span class="proposal-type">${p.type}</span>
            </div>
            <span class="thought-text"><strong>${escapeHtml(p.title)}</strong></span>
            <span class="thought-text proposal-desc">${escapeHtml(p.description || '')}</span>
            <div class="proposal-actions">
                <button class="approve-btn" data-id="${p.id}">✅ Aprovar</button>
                <button class="reject-btn" data-id="${p.id}">❌ Rejeitar</button>
            </div>
        </div>
    `).join('');

    elements.proposalsList.querySelectorAll('.approve-btn').forEach(btn => {
        btn.addEventListener('click', () => decideProposal(btn.dataset.id, 'approved'));
    });
    elements.proposalsList.querySelectorAll('.reject-btn').forEach(btn => {
        btn.addEventListener('click', () => decideProposal(btn.dataset.id, 'rejected'));
    });
}

async function decideProposal(id, decision) {
    try {
        const res = await fetch(`${API_URL}/api/proposals/${id}/decide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision }),
        });
        const data = await res.json();
        if (data.success) {
            addConsoleLine(`${decision === 'approved' ? '✅' : '❌'} Proposta ${decision === 'approved' ? 'aprovada' : 'rejeitada'}.`, 'system');
        } else {
            addConsoleLine(`❌ Erro: ${data.error}`, 'error');
        }
    } catch (e) {
        addConsoleLine(`❌ Erro na comunicação: ${e.message}`, 'error');
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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

    input.value = '';
    input.focus();
    addConsoleLine(`💬 Você: ${command}`, 'user');

    try {
        const response = await fetch(`${API_URL}/api/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command }),
        });
        const data = await response.json();
        addConsoleLine(data.success ? `🤖 Bot: ${data.response}` : `❌ Erro: ${data.error || 'Comando não processado'}`, data.success ? 'bot' : 'error');
    } catch (error) {
        addConsoleLine(`❌ Erro na comunicação: ${error.message}`, 'error');
    }
}

elements.commandInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendCommand(); }
});
elements.sendButton.addEventListener('click', sendCommand);

// ============================================
// INICIALIZAR
// ============================================

function init() {
    addConsoleLine('🚀 Dashboard inicializado!', 'system');
    addConsoleLine('💡 Digite "status", "performance" ou faça uma pergunta em português.', 'system');

    connectWebSocket();

    fetch(`${API_URL}/api/dashboard`)
        .then(res => res.json())
        .then(data => { if (data.success) updateDashboard(data.data); })
        .catch(err => console.error('Erro ao carregar dados iniciais:', err));
}

document.addEventListener('DOMContentLoaded', init);
