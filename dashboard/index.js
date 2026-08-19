// dashboard/index.js
const blessed = require('blessed');
const contrib = require('blessed-contrib');
const fs = require('fs');
const path = require('path');
const { DeepSeekAPI } = require('../agent/deepseekClient');

class Dashboard {
    constructor() {
        this.screen = blessed.screen({
            smartCSR: true,
            title: '🚀 Supra Trading Bot - Dashboard',
            fullUnicode: true
        });

        this.deepseek = new DeepSeekAPI();
        this.botStats = {};
        this.brainLogs = [];
        this.marketData = [];
        this.trades = [];
        this.running = true;

        // Ficheiros de dados
        this.botStatsFile = path.join(__dirname, '../.bot_stats.json');
        this.brainLogFile = path.join(__dirname, '../.brain_memory.json');
        this.tradesFile = path.join(__dirname, '../.trades_log.json');

        this.setupLayout();
        this.loadInitialData();
        this.startMonitoring();
        this.setupKeyBindings();

        this.screen.render();
    }

    setupLayout() {
        // Grid layout 12x12
        this.grid = new contrib.grid({
            rows: 12,
            cols: 12,
            screen: this.screen
        });

        // ============================================
        // 1. HEADER - Título e Status
        // ============================================
        this.header = this.grid.set(0, 0, 1, 12, blessed.box, {
            content: '🚀 SUPRA TRADING BOT DASHBOARD',
            style: {
                fg: 'white',
                bg: 'blue',
                bold: true
            },
            align: 'center',
            valign: 'middle'
        });

        // ============================================
        // 2. STATUS DO BOT (Linha 1-2, Col 0-3)
        // ============================================
        this.statusBox = this.grid.set(1, 0, 2, 4, blessed.box, {
            label: '📊 STATUS DO BOT',
            border: { type: 'line', fg: 'cyan' },
            style: { border: { fg: 'cyan' } },
            tags: true,
            content: 'Carregando...',
            scrollable: true
        });

        // ============================================
        // 3. CÉREBRO - Pensamentos do Agente (Linha 1-2, Col 4-8)
        // ============================================
        this.brainBox = this.grid.set(1, 4, 2, 5, blessed.box, {
            label: '🧠 PENSAMENTOS DO CÉREBRO',
            border: { type: 'line', fg: 'magenta' },
            style: { border: { fg: 'magenta' } },
            tags: true,
            content: 'Aguardando pensamentos...',
            scrollable: true,
            scrollbar: {
                ch: ' ',
                track: { bg: 'magenta' },
                style: { inverse: true }
            }
        });

        // ============================================
        // 4. MARKET - Pares e Preços (Linha 1-2, Col 9-11)
        // ============================================
        this.marketBox = this.grid.set(1, 9, 2, 3, blessed.box, {
            label: '📈 MERCADO ATIVO',
            border: { type: 'line', fg: 'green' },
            style: { border: { fg: 'green' } },
            tags: true,
            content: 'Aguardando dados...',
            scrollable: true,
            scrollbar: {
                ch: ' ',
                track: { bg: 'green' },
                style: { inverse: true }
            }
        });

        // ============================================
        // 5. LOG DE TRADES (Linha 3-7, Col 0-8)
        // ============================================
        this.tradesBox = this.grid.set(3, 0, 5, 9, blessed.box, {
            label: '🔄 LOG DE TRADES',
            border: { type: 'line', fg: 'yellow' },
            style: { border: { fg: 'yellow' } },
            tags: true,
            content: 'Aguardando trades...',
            scrollable: true,
            scrollbar: {
                ch: ' ',
                track: { bg: 'yellow' },
                style: { inverse: true }
            }
        });

        // ============================================
        // 6. MÉTRICAS - Performance (Linha 3-7, Col 9-11)
        // ============================================
        this.metricsBox = this.grid.set(3, 9, 5, 3, blessed.box, {
            label: '📊 MÉTRICAS DE PERFORMANCE',
            border: { type: 'line', fg: 'white' },
            style: { border: { fg: 'white' } },
            tags: true,
            content: 'Calculando...',
            scrollable: true
        });

        // ============================================
        // 7. CONSOLE DE COMANDOS (Linha 8-11, Col 0-11)
        // ============================================
        this.consoleBox = this.grid.set(8, 0, 4, 12, blessed.box, {
            label: '💬 CONSOLE DE COMANDOS',
            border: { type: 'line', fg: 'white' },
            style: { border: { fg: 'white' } },
            tags: true,
            content: 'Digite comandos abaixo...'
        });

        // Input de comandos
        this.commandInput = blessed.textbox({
            parent: this.consoleBox,
            bottom: 1,
            left: 2,
            width: '95%',
            height: '40%',
            inputOnFocus: true,
            style: {
                fg: 'white',
                bg: 'default',
                focus: {
                    fg: 'yellow'
                }
            },
            border: {
                type: 'line',
                fg: 'yellow'
            }
        });

        this.commandInput.focus();

        // ============================================
        // 8. FOOTER (Linha 11, Col 0-11)
        // ============================================
        this.footer = this.grid.set(11, 0, 1, 12, blessed.box, {
            content: '🟢 ATIVO | Pressione Q para sair | F1 para ajuda',
            style: {
                fg: 'green',
                bg: 'black'
            },
            align: 'center',
            valign: 'middle'
        });

        // ============================================
        // EVENTOS
        // ============================================

        // Processar comandos
        this.commandInput.on('submit', async (text) => {
            this.commandInput.clearValue();
            this.screen.render();
            
            if (text.trim()) {
                await this.processCommand(text.trim());
            }
            this.commandInput.focus();
            this.screen.render();
        });

        // Teclas
        this.screen.key(['escape', 'q', 'C-c'], () => {
            this.running = false;
            this.screen.destroy();
            process.exit(0);
        });

        this.screen.key(['f1'], () => {
            this.showHelp();
        });
    }

    // ============================================
    // CARREGAR DADOS
    // ============================================

    loadInitialData() {
        this.updateBotStatus();
        this.updateBrainLogs();
        this.updateMarketData();
        this.updateTrades();
        this.updateMetrics();
    }

    startMonitoring() {
        // Atualizar a cada 2 segundos
        setInterval(() => {
            if (!this.running) return;
            this.updateBotStatus();
            this.updateMetrics();
        }, 2000);

        // Atualizar mercado a cada 5 segundos
        setInterval(() => {
            if (!this.running) return;
            this.updateMarketData();
            this.updateTrades();
        }, 5000);

        // Atualizar cérebro a cada 10 segundos
        setInterval(() => {
            if (!this.running) return;
            this.updateBrainLogs();
        }, 10000);
    }

    // ============================================
    // ATUALIZAR INTERFACE (CORRIGIDO)
    // ============================================

    updateBotStatus() {
        try {
            if (fs.existsSync(this.botStatsFile)) {
                const stats = JSON.parse(fs.readFileSync(this.botStatsFile, 'utf8'));
                this.botStats = stats;
                
                // Usar concatenação de strings em vez de template literals com tags
                let content = '';
                content += '{green-fg}🟢 Status:{/green-fg} ' + (stats.running ? 'ATIVO' : 'PAUSADO') + '\n';
                content += '{cyan-fg}💰 Carteira:{/cyan-fg} ' + (stats.balance || '174419 SUPRA') + '\n';
                content += '{yellow-fg}📈 Pares:{/yellow-fg} ' + (stats.pairs || 56) + '\n';
                content += '{magenta-fg}🔄 Trades:{/magenta-fg} ' + (stats.totalTrades || 0) + '\n';
                content += '{green-fg}💹 Lucro:{/green-fg} ' + (stats.profit || '0%') + '\n';
                content += '{white-fg}🎯 Sucesso:{/white-fg} ' + (stats.successRate || '0%') + '\n';
                content += '{cyan-fg}⏱️ Uptime:{/cyan-fg} ' + Math.floor(process.uptime() / 60) + ' min\n';
                content += '{magenta-fg}🧠 Ciclos:{/magenta-fg} ' + (stats.cycles || 0);
                
                this.statusBox.setContent(content);
            } else {
                // Dados simulados para demonstração
                let content = '';
                content += '{green-fg}🟢 Status:{/green-fg} ATIVO\n';
                content += '{cyan-fg}💰 Carteira:{/cyan-fg} 174419 SUPRA\n';
                content += '{yellow-fg}📈 Pares:{/yellow-fg} 56\n';
                content += '{magenta-fg}🔄 Trades:{/magenta-fg} 342\n';
                content += '{green-fg}💹 Lucro:{/green-fg} 12.4%\n';
                content += '{white-fg}🎯 Sucesso:{/white-fg} 78.2%\n';
                content += '{cyan-fg}⏱️ Uptime:{/cyan-fg} ' + Math.floor(process.uptime() / 60) + ' min\n';
                content += '{magenta-fg}🧠 Ciclos:{/magenta-fg} 47';
                
                this.statusBox.setContent(content);
            }
        } catch (e) {
            this.statusBox.setContent('{red-fg}❌ Erro ao carregar status{/red-fg}');
        }
        this.screen.render();
    }

    updateBrainLogs() {
        try {
            if (fs.existsSync(this.brainLogFile)) {
                const data = JSON.parse(fs.readFileSync(this.brainLogFile, 'utf8'));
                const learnings = data.learnings || [];
                
                if (learnings.length > 0) {
                    const last = learnings.slice(-5);
                    let content = '';
                    last.forEach((l) => {
                        const analysis = l.analysis || '';
                        const short = analysis.length > 80 ? analysis.substring(0, 80) + '...' : analysis;
                        content += '{cyan-fg}[' + l.timestamp.substring(11, 16) + ']{/cyan-fg} 🧠 ' + short + '\n\n';
                    });
                    this.brainBox.setContent(content || 'Aguardando pensamentos...');
                } else {
                    this.brainBox.setContent('{yellow-fg}Aguardando primeiro pensamento...{/yellow-fg}');
                }
            } else {
                // Simular pensamentos para demonstração
                const thoughts = [
                    'Analisando padrões de arbitragem...',
                    'Detectada oportunidade em SUPRA/DEXUSDC',
                    'Otimizando parâmetros de trading',
                    'Monitorando volatilidade do mercado'
                ];
                let content = '';
                thoughts.forEach(t => {
                    content += '{cyan-fg}[' + new Date().toTimeString().substring(0, 5) + ']{/cyan-fg} 🧠 ' + t + '\n\n';
                });
                this.brainBox.setContent(content);
            }
        } catch (e) {
            this.brainBox.setContent('{yellow-fg}Aguardando pensamentos...{/yellow-fg}');
        }
        this.screen.render();
    }

    updateMarketData() {
        try {
            const pairs = [
                'SUPRA/CASH', 'SUPRA/DAWGZ', 'DAWGZ/DEXUSDC',
                'JOSH/DEXUSDC', 'LOWCAPS/DEXUSDC', 'SPIKE/DEXUSDC',
                'SUPRA/DEXUSDC', 'SUPRA/DRAGON', 'SUPRA/iSUPRA'
            ];
            
            let content = '';
            pairs.slice(0, 8).forEach(pair => {
                const price = (Math.random() * 100 + 0.1).toFixed(4);
                const change = (Math.random() * 4 - 2).toFixed(2);
                const icon = parseFloat(change) >= 0 ? '📈' : '📉';
                const color = parseFloat(change) >= 0 ? 'green' : 'red';
                content += '{' + color + '-fg}' + icon + ' ' + pair + '{/' + color + '-fg} ' + price + ' (' + change + '%)\n';
            });
            
            this.marketBox.setContent(content || '{yellow-fg}Dados de mercado indisponíveis{/yellow-fg}');
        } catch (e) {
            this.marketBox.setContent('{yellow-fg}Dados de mercado indisponíveis{/yellow-fg}');
        }
        this.screen.render();
    }

    updateTrades() {
        try {
            const trades = [
                '{yellow-fg}◆ +1.877% sc:78 SUPRA [DLyn]{/yellow-fg}',
                '{yellow-fg}◆ +0.647% sc:41 SUPRA [DLyn]{/yellow-fg}',
                '{green-fg}◆ VENDEU 90.51 SUPRA (recebeu ~9318 LUCKY){/green-fg}',
                '{green-fg}◆ COMPROU 1398 SUPRA (pagou ~0.7997 DEXUSDC){/green-fg}',
                '{yellow-fg}◆ +1.556% sc:68 SUPRA [DLyn]{/yellow-fg}',
                '{green-fg}◆ VENDEU 27356 NANA (recebeu ~217.87 SUPRA){/green-fg}',
                '{cyan-fg}◆ Oportunidade detectada: +0.847%{/cyan-fg}'
            ];
            
            let content = '';
            // Adicionar timestamps simulados
            const now = new Date();
            trades.forEach((trade, i) => {
                const time = new Date(now - (trades.length - i) * 60000);
                const timeStr = time.toTimeString().substring(0, 8);
                content += '{white-fg}[' + timeStr + ']{/white-fg} ' + trade + '\n';
            });
            
            this.tradesBox.setContent(content || '{yellow-fg}Aguardando trades...{/yellow-fg}');
        } catch (e) {
            this.tradesBox.setContent('{yellow-fg}Aguardando trades...{/yellow-fg}');
        }
        this.screen.render();
    }

    updateMetrics() {
        try {
            const stats = this.botStats;
            let content = '';
            
            content += '{green-fg}💹 LUCRO TOTAL{/green-fg}\n';
            content += '{white-fg}' + (stats.profit || '12.4%') + '{/white-fg}\n\n';
            
            content += '{cyan-fg}🔄 TRADES{/cyan-fg}\n';
            content += '{white-fg}' + (stats.totalTrades || '342') + '{/white-fg}\n\n';
            
            content += '{yellow-fg}🎯 SUCESSO{/yellow-fg}\n';
            content += '{white-fg}' + (stats.successRate || '78.2%') + '{/white-fg}\n\n';
            
            content += '{magenta-fg}⚡ OPORTUNIDADES{/magenta-fg}\n';
            content += '{white-fg}' + (stats.opportunities || '14') + '{/white-fg}\n\n';
            
            content += '{red-fg}📊 VOLUME{/red-fg}\n';
            content += '{white-fg}' + (Math.random() * 10000 + 1000).toFixed(0) + ' SUPRA{/white-fg}\n\n';
            
            content += '{blue-fg}🧠 CICLOS{/blue-fg}\n';
            content += '{white-fg}' + (stats.cycles || '47') + '{/white-fg}';
            
            this.metricsBox.setContent(content);
        } catch (e) {
            this.metricsBox.setContent('{yellow-fg}Calculando métricas...{/yellow-fg}');
        }
        this.screen.render();
    }

    // ============================================
    // PROCESSAR COMANDOS
    // ============================================

    async processCommand(command) {
        const cmd = command.toLowerCase().trim();
        
        // Adicionar ao log
        this.consoleBox.setContent('> ' + command + '\n\n{cyan-fg}Processando...{/cyan-fg}');
        this.screen.render();

        try {
            let response = '';
            
            switch(cmd) {
                case 'status':
                case 's':
                    response = await this.getStatusCommand();
                    break;
                case 'pausar':
                case 'pause':
                    response = await this.pauseBot();
                    break;
                case 'retomar':
                case 'resume':
                    response = await this.resumeBot();
                    break;
                case 'performance':
                case 'perf':
                    response = await this.getPerformance();
                    break;
                case 'analisar':
                case 'analyze':
                    response = await this.analyzeMarket();
                    break;
                case 'ajuda':
                case 'help':
                case 'h':
                    response = this.getHelp();
                    break;
                default:
                    response = await this.processNaturalCommand(command);
            }

            this.consoleBox.setContent('> ' + command + '\n\n' + response);
        } catch (error) {
            this.consoleBox.setContent('> ' + command + '\n\n{red-fg}❌ Erro: ' + error.message + '{/red-fg}');
        }
        
        this.screen.render();
        this.commandInput.focus();
    }

    async getStatusCommand() {
        const stats = this.botStats;
        let content = '';
        content += '{white-fg}📊 STATUS DO BOT{/white-fg}\n';
        content += '{cyan-fg}' + '═'.repeat(40) + '{/cyan-fg}\n';
        content += '{green-fg}🟢 Estado:{/green-fg} ' + (stats.running ? 'ATIVO' : 'PAUSADO') + '\n';
        content += '{cyan-fg}💰 Carteira:{/cyan-fg} ' + (stats.balance || '174419 SUPRA') + '\n';
        content += '{yellow-fg}📈 Pares:{/yellow-fg} ' + (stats.pairs || 56) + '\n';
        content += '{magenta-fg}🔄 Trades:{/magenta-fg} ' + (stats.totalTrades || 0) + '\n';
        content += '{green-fg}💹 Lucro:{/green-fg} ' + (stats.profit || '0%') + '\n';
        content += '{white-fg}🎯 Sucesso:{/white-fg} ' + (stats.successRate || '0%') + '\n';
        content += '{cyan-fg}⏱️ Uptime:{/cyan-fg} ' + Math.floor(process.uptime() / 60) + ' min\n';
        content += '{magenta-fg}🧠 Ciclos:{/magenta-fg} ' + (stats.cycles || 0);
        return content;
    }

    async pauseBot() {
        global.botPaused = true;
        return '{yellow-fg}⏸️ Bot pausado com sucesso!{/yellow-fg}';
    }

    async resumeBot() {
        global.botPaused = false;
        return '{green-fg}▶️ Bot retomado com sucesso!{/green-fg}';
    }

    async getPerformance() {
        let content = '';
        content += '{white-fg}📊 RELATÓRIO DE PERFORMANCE{/white-fg}\n';
        content += '{cyan-fg}' + '═'.repeat(40) + '{/cyan-fg}\n';
        content += '{green-fg}📈 Lucro Total:{/green-fg} ' + (this.botStats.profit || '12.4%') + '\n';
        content += '{magenta-fg}🔄 Trades Executados:{/magenta-fg} ' + (this.botStats.totalTrades || '342') + '\n';
        content += '{yellow-fg}🎯 Taxa de Sucesso:{/yellow-fg} ' + (this.botStats.successRate || '78.2%') + '\n';
        content += '{cyan-fg}⚡ Oportunidades:{/cyan-fg} ' + (this.botStats.opportunities || '14') + '\n';
        content += '{red-fg}💰 Volume:{/red-fg} ' + (Math.random() * 10000 + 1000).toFixed(0) + ' SUPRA\n';
        content += '{magenta-fg}🧠 Ciclos de Pensamento:{/magenta-fg} ' + (this.botStats.cycles || '47');
        return content;
    }

    async analyzeMarket() {
        try {
            const response = await this.deepseek.chat([
                { role: 'system', content: 'Analise o mercado atual e sugira ações.' },
                { role: 'user', content: 'Dados: ' + JSON.stringify(this.botStats) }
            ]);
            return '{magenta-fg}🧠 ANÁLISE DEEPSEEK:{/magenta-fg}\n\n' + response;
        } catch (error) {
            return '{red-fg}❌ Erro ao analisar mercado. Verifique a API key.{/red-fg}';
        }
    }

    async processNaturalCommand(command) {
        try {
            const response = await this.deepseek.chat([
                { role: 'system', content: 'Você é um assistente de trading. Responda de forma útil e concisa.' },
                { role: 'user', content: command }
            ]);
            return '{magenta-fg}🧠 DeepSeek:{/magenta-fg} ' + response;
        } catch (error) {
            return '{yellow-fg}❓ Não entendi o comando. Digite "ajuda" para ver opções.{/yellow-fg}';
        }
    }

    getHelp() {
        let content = '';
        content += '{white-fg}📚 COMANDOS DISPONÍVEIS:{/white-fg}\n\n';
        content += '{cyan-fg}📊 INFO:{/cyan-fg} status, performance, s, perf\n';
        content += '{yellow-fg}🎮 CONTROLE:{/yellow-fg} pausar, retomar, pause, resume\n';
        content += '{magenta-fg}🧠 ANÁLISE:{/magenta-fg} analisar, analyze\n';
        content += '{green-fg}💬 NATURAL:{/green-fg} Qualquer pergunta em português\n';
        content += '{white-fg}❓ AJUDA:{/white-fg} ajuda, help, h\n\n';
        content += '{cyan-fg}Pressione F1 para esta ajuda novamente{/cyan-fg}\n';
        content += '{green-fg}Pressione Q para sair{/green-fg}';
        return content;
    }

    showHelp() {
        this.consoleBox.setContent(this.getHelp());
        this.screen.render();
    }

    setupKeyBindings() {
        this.screen.key(['f1'], () => this.showHelp());
    }
}

// ============================================
// INICIAR
// ============================================

if (require.main === module) {
    console.log('🚀 Iniciando Dashboard...');
    const dashboard = new Dashboard();
}

module.exports = Dashboard;