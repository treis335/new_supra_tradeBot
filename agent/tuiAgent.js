// agent/tuiAgent.js
const blessed = require('blessed');
const AgentCore = require('./agentCore');

class TUIAgent {
    constructor() {
        this.agent = new AgentCore();
        this.setupUI();
    }

    setupUI() {
        // Criar tela
        this.screen = blessed.screen({
            smartCSR: true,
            title: '🤖 Agente DeepSeek + Bot Trading'
        });

        // Layout com duas colunas
        this.box = blessed.box({
            parent: this.screen,
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            style: {
                bg: 'default'
            }
        });

        // Área de conversa (70%)
        this.chatBox = blessed.box({
            parent: this.box,
            top: 0,
            left: 0,
            width: '70%',
            height: '90%',
            border: {
                type: 'line'
            },
            style: {
                border: {
                    fg: 'cyan'
                }
            },
            scrollable: true,
            scrollbar: {
                ch: ' ',
                track: {
                    bg: 'cyan'
                },
                style: {
                    inverse: true
                }
            },
            keys: true,
            vi: true,
            mouse: true
        });

        // Área de status do bot (30%)
        this.statusBox = blessed.box({
            parent: this.box,
            top: 0,
            right: 0,
            width: '30%',
            height: '90%',
            border: {
                type: 'line'
            },
            style: {
                border: {
                    fg: 'green'
                }
            },
            content: '📊 Status do Bot\n\nCarregando...',
            scrollable: true,
            scrollbar: {
                ch: ' ',
                track: {
                    bg: 'green'
                },
                style: {
                    inverse: true
                }
            }
        });

        // Área de input
        this.inputBox = blessed.box({
            parent: this.box,
            bottom: 0,
            left: 0,
            width: '70%',
            height: '10%',
            border: {
                type: 'line'
            },
            style: {
                border: {
                    fg: 'yellow'
                }
            }
        });

        // Input de texto
        this.input = blessed.textbox({
            parent: this.inputBox,
            top: 1,
            left: 2,
            width: '95%',
            height: '70%',
            inputOnFocus: true,
            style: {
                fg: 'white',
                bg: 'default'
            }
        });

        this.input.focus();

        // Atualizar status periodicamente
        setInterval(() => {
            this.updateStatus();
        }, 2000);

        // Processar comandos
        this.input.on('submit', async (text) => {
            this.input.clearValue();
            this.screen.render();

            if (text.trim()) {
                this.chatBox.pushLine(`🤖 Você: ${text}`);
                this.chatBox.scroll(this.chatBox.getScrollHeight());
                this.screen.render();

                const response = await this.agent.processUserCommand(text);
                this.chatBox.pushLine(`🤖 Agente: ${response}`);
                this.chatBox.scroll(this.chatBox.getScrollHeight());
                this.screen.render();
            }

            this.input.focus();
            this.screen.render();
        });

        // Teclas
        this.screen.key(['escape', 'q', 'C-c'], () => {
            process.exit(0);
        });

        this.screen.render();
    }

    updateStatus() {
        try {
            const stats = this.agent.getBotStats();
            this.statusBox.setContent(
                '📊 STATUS DO BOT\n' +
                '═'.repeat(30) + '\n\n' +
                `🟢 Estado: ${global.botPaused ? '⏸️ Pausado' : '▶️ Ativo'}\n` +
                `💼 Carteira: 174419 SUPRA\n` +
                `📈 Pares: 56 ativos\n` +
                `🔄 Trades: ${stats.totalTrades || 0}\n` +
                `💰 Lucro: ${stats.profit || '0%'}\n` +
                `🎯 Taxa Sucesso: ${stats.successRate || '0%'}\n` +
                `⏱️ Uptime: ${Math.floor(process.uptime() / 60)} min\n\n` +
                '═'.repeat(30) + '\n' +
                '💡 Digite "ajuda" para comandos'
            );
            this.screen.render();
        } catch (e) {}
    }
}

module.exports = TUIAgent;

// Iniciar
if (require.main === module) {
    new TUIAgent();
}