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
    codegenInput: document.getElementById('codegenInput'),
    sendCodegen: document.getElementById('sendCodegen'),
    restartBotBtn: document.getElementById('restartBotBtn'),
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
        elements.botRunning.textContent = stats.running ? '🟢 ATIVO' : '🔴 NÃO ESTÁ A CORRER';
        elements.botBalance.textContent = stats.balance || 'sem dados';
        elements.botPairs.textContent = stats.pairs ?? '—';
        elements.botTrades.textContent = stats.totalTrades ?? 0;
        elements.botProfit.textContent = stats.profit || '—';
        elements.botSuccess.textContent = stats.successRate || '—';
        elements.botCycles.textContent = stats.opportunities ?? 0;

        elements.metricProfit.textContent = stats.profit || '—';
        elements.metricTrades.textContent = stats.totalTrades ?? 0;
        elements.metricSuccess.textContent = stats.successRate || '—';
        elements.metricOpportunities.textContent = stats.opportunities ?? 0;
        elements.metricCycles.textContent = stats.updatedAt ? new Date(stats.updatedAt).toLocaleTimeString() : '—';
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
                    <span class="pair">${item.pair}</span>
                    <span class="price">lucro: ${item.price}%</span>
                    <span class="change positive">${item.change} opp.</span>
                </div>
            `).join('');
        } else {
            elements.marketData.innerHTML = `<div class="market-item"><span class="pair">Sem dados ainda — liga o bot principal (node index.js)</span></div>`;
        }
        elements.marketCount.textContent = `${data.marketData.length} pontos`;
    }

    // Trades reais
    if (data.trades) {
        if (data.trades.length > 0) {
            elements.tradesLog.innerHTML = data.trades.map(trade => `
                <div class="trade-item ${trade.color}">
                    <span class="trade-time">${trade.time}</span>
                    <span class="trade-icon">${trade.icon}</span>
                    <span class="trade-text">${trade.profit ? trade.profit + ' ' : ''}${trade.text}</span>
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

    elements.proposalsList.innerHTML = proposals.map(p => {
        const blocked = p.type === 'code_change' && p.payload?.safetyScan && !p.payload.safetyScan.safe;
        return `
        <div class="brain-thought proposal-item" data-id="${p.id}">
            <div class="proposal-header">
                <span class="thought-time">${new Date(p.ts).toLocaleString()}</span>
                <span class="proposal-type">${p.type}</span>
            </div>
            <span class="thought-text">${escapeHtml(p.summary || '')}</span>
            ${renderProposalCode(p)}
            <div class="proposal-actions">
                <button class="approve-btn" data-id="${p.id}" ${blocked ? 'disabled title="Bloqueado pelo scan de segurança"' : ''}>✅ Aprovar</button>
                <button class="reject-btn" data-id="${p.id}">❌ Rejeitar</button>
            </div>
        </div>
    `;
    }).join('');

    elements.proposalsList.querySelectorAll('.approve-btn').forEach(btn => {
        btn.addEventListener('click', () => decideProposal(btn.dataset.id, 'approve'));
    });
    elements.proposalsList.querySelectorAll('.reject-btn').forEach(btn => {
        btn.addEventListener('click', () => decideProposal(btn.dataset.id, 'reject'));
    });
}

async function decideProposal(id, action) {
    try {
        const res = await fetch(`${API_URL}/api/proposals/${id}/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const data = await res.json();
        if (data.success) {
            addConsoleLine(`${action === 'approve' ? '✅ Proposta aprovada e aplicada.' : '❌ Proposta rejeitada.'}`, 'system');
            fetchProposalsAndRender();
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

function renderProposalCode(p) {
    if (p.type !== 'code_change' || !p.payload) return '';
    const { targetPath, code, explanation, safetyScan } = p.payload;
    const blocked = safetyScan && !safetyScan.safe;
    const warnHtml = (safetyScan?.warnings || []).map(w => `<div class="proposal-warning">⚠️ ${escapeHtml(w)}</div>`).join('');
    const blockHtml = blocked
        ? `<div class="proposal-blocked">🚫 BLOQUEADO pelo scan de segurança: ${escapeHtml((safetyScan.blocks || []).join('; '))} -- não pode ser aprovado.</div>`
        : '';
    return `
        <div class="proposal-code-block">
            <div class="proposal-target-path">📄 ${escapeHtml(targetPath || '')}</div>
            ${explanation ? `<div class="proposal-explanation">${escapeHtml(explanation)}</div>` : ''}
            ${blockHtml}${warnHtml}
            <pre class="proposal-code"><code>${escapeHtml(code || '')}</code></pre>
        </div>
    `;
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

async function sendCodegen() {
    const input = elements.codegenInput;
    const request = input.value.trim();
    if (!request) return;
    input.value = '';
    input.disabled = true;
    elements.sendCodegen.disabled = true;
    elements.sendCodegen.textContent = 'A gerar...';

    addConsoleLine(`🛠️ Pedido de componente: ${request}`, 'user');
    try {
        const res = await fetch(`${API_URL}/api/generate-component`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request }),
        });
        const data = await res.json();
        if (data.success) {
            addConsoleLine(`🤖 Componente proposto: ${data.data.payload.targetPath} -- revê e aprova acima.`, 'bot');
            fetch(`${API_URL}/api/dashboard`).then(r => r.json()).then(d => { if (d.success) updateDashboard(d.data); });
        } else {
            addConsoleLine(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        addConsoleLine(`❌ Erro de comunicação: ${e.message}`, 'error');
    } finally {
        input.disabled = false;
        elements.sendCodegen.disabled = false;
        elements.sendCodegen.textContent = 'Gerar';
    }
}
elements.codegenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendCodegen(); }
});
elements.sendCodegen.addEventListener('click', sendCodegen);

async function restartBot() {
    if (!confirm('Reiniciar o bot de trading agora? Isto só tem efeito se estiver a correr via "node start-all.js". Se a mudança recente causar um crash, o sistema tenta reverter sozinho.')) return;
    elements.restartBotBtn.disabled = true;
    elements.restartBotBtn.textContent = 'A reiniciar...';
    addConsoleLine('🔄 Pedido de reinício do bot enviado.', 'system');
    try {
        const res = await fetch(`${API_URL}/api/restart-bot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'pedido manual via dashboard' }),
        });
        const data = await res.json();
        addConsoleLine(data.success ? `✅ ${data.message}` : `❌ ${data.error}`, data.success ? 'system' : 'error');
    } catch (e) {
        addConsoleLine(`❌ Erro de comunicação: ${e.message}`, 'error');
    } finally {
        setTimeout(() => {
            elements.restartBotBtn.disabled = false;
            elements.restartBotBtn.textContent = '🔄 Reiniciar Bot';
        }, 3000);
    }
}
elements.restartBotBtn.addEventListener('click', restartBot);

// ============================================
// LIGAR COMPONENTES AO BOT
// ============================================

async function fetchAvailableComponents() {
    try {
        const res = await fetch(`${API_URL}/api/available-components`);
        const data = await res.json();
        if (!data.success) return;
        const el = document.getElementById('availableComponentsList');
        if (data.data.length === 0) {
            el.innerHTML = '<div class="proposal-empty">Nenhum componente aprovado à espera de ligação.</div>';
            return;
        }
        el.innerHTML = data.data.map(c => `
            <div class="wiring-item">
                <div class="proposal-target-path">📄 ${escapeHtml(c.targetPath)}</div>
                ${c.explanation ? `<div class="proposal-explanation">${escapeHtml(c.explanation)}</div>` : ''}
                <div class="wire-form">
                    <input type="text" placeholder="nome da função exportada (ex: volatilityScore)" class="wire-export-input" data-path="${escapeHtml(c.targetPath)}">
                    <select class="wire-hook-select">
                        <option value="score_modifier">score_modifier (ajusta o score)</option>
                    </select>
                    <button class="approve-btn wire-btn" data-path="${escapeHtml(c.targetPath)}">🔌 Propor Ligação</button>
                </div>
            </div>
        `).join('');
        el.querySelectorAll('.wire-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const item = btn.closest('.wiring-item');
                const exportName = item.querySelector('.wire-export-input').value.trim();
                const hookName = item.querySelector('.wire-hook-select').value;
                if (!exportName) { addConsoleLine('❌ Indica o nome da função exportada.', 'error'); return; }
                const res = await fetch(`${API_URL}/api/wire-component`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetPath: btn.dataset.path, exportName, hookName }),
                });
                const data = await res.json();
                addConsoleLine(data.success ? `📋 Proposta de ligação criada -- aprova acima.` : `❌ ${data.error}`, data.success ? 'system' : 'error');
                if (data.success) { fetchProposalsAndRender(); }
            });
        });
    } catch (e) { console.error('Erro ao buscar componentes disponíveis:', e); }
}

async function fetchActiveComponents() {
    try {
        const res = await fetch(`${API_URL}/api/active-components`);
        const data = await res.json();
        if (!data.success) return;
        const el = document.getElementById('activeComponentsList');
        if (data.data.length === 0) {
            el.innerHTML = '<div class="proposal-empty">Nenhum componente ligado ainda.</div>';
            return;
        }
        el.innerHTML = data.data.map(c => `
            <div class="wiring-item">
                <div class="proposal-target-path">🟢 ${escapeHtml(c.targetPath)} <span class="proposal-type">${escapeHtml(c.hookName)}</span></div>
                <button class="reject-btn unwire-btn" data-path="${escapeHtml(c.targetPath)}" data-hook="${escapeHtml(c.hookName)}">🔌 Propor Desligar</button>
            </div>
        `).join('');
        el.querySelectorAll('.unwire-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const res = await fetch(`${API_URL}/api/unwire-component`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetPath: btn.dataset.path, hookName: btn.dataset.hook }),
                });
                const data = await res.json();
                addConsoleLine(data.success ? `📋 Proposta de desligar criada -- aprova acima.` : `❌ ${data.error}`, data.success ? 'system' : 'error');
                if (data.success) { fetchProposalsAndRender(); }
            });
        });
    } catch (e) { console.error('Erro ao buscar componentes ativos:', e); }
}

function fetchProposalsAndRender() {
    fetch(`${API_URL}/api/dashboard`).then(r => r.json()).then(d => { if (d.success) updateDashboard(d.data); });
    fetchAvailableComponents();
    fetchActiveComponents();
}

// Carregar ao iniciar, e sempre que uma proposta for decidida.
fetchAvailableComponents();
fetchActiveComponents();

// ============================================
// EQUIPA DE AGENTES -- briefing do Estratega
// ============================================

function renderBrief(brief) {
    const el = document.getElementById('strategicBrief');
    if (!brief) {
        el.innerHTML = '<div class="proposal-empty">O Estratega ainda não gerou um briefing (corre automaticamente a cada ~12h, ou clica em "Atualizar Prioridades").</div>';
        return;
    }
    const idade = brief.generatedAt ? new Date(brief.generatedAt).toLocaleString() : '';
    const prioridadesHtml = (brief.prioridades || []).map(p => `
        <div class="brief-priority">
            <span class="proposal-type">${escapeHtml(p.paraQuem)}</span>
            <strong>${escapeHtml(p.foco)}</strong>
            <div class="proposal-explanation">${escapeHtml(p.porque)}</div>
        </div>
    `).join('');
    el.innerHTML = `
        <div class="brief-summary">${escapeHtml(brief.resumo || '')}</div>
        <div class="thought-time">Gerado em ${idade}</div>
        ${prioridadesHtml}
    `;
}

async function fetchTeamBrief() {
    try {
        const res = await fetch(`${API_URL}/api/team-brief`);
        const data = await res.json();
        if (data.success) renderBrief(data.data);
    } catch (e) { console.error('Erro ao buscar briefing:', e); }
}

document.getElementById('refreshBriefBtn')?.addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'A pensar...';
    addConsoleLine('🧭 A pedir ao Estratega para atualizar as prioridades...', 'user');
    try {
        const res = await fetch(`${API_URL}/api/generate-brief`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            renderBrief(data.data);
            fetchProposalsAndRender();
            addConsoleLine('✅ Prioridades atualizadas.', 'system');
        } else {
            addConsoleLine(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        addConsoleLine(`❌ Erro de comunicação: ${e.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '🧭 Atualizar Prioridades';
    }
});

fetchTeamBrief();

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
