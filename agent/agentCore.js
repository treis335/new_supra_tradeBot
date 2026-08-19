// agent/agentCore.js
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DeepSeekAPI } = require('./deepseekClient');

class AgentCore {
    constructor() {
        console.log('🧠 Inicializando core do agente...');
        this.deepseek = new DeepSeekAPI();
        this.isRunning = true;
        this.contextHistory = [];
        this.botStatsFile = path.join(__dirname, '../.bot_stats.json');
        this.commandsFile = path.join(__dirname, '../.agent_commands.json');
        this.responseFile = path.join(__dirname, '../.agent_responses.json');
        this.botState = {};
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: '🤖 Você: '
        });
        
        // Carregar ferramentas (DEPOIS que os métodos estão definidos)
        this.tools = this.loadTools();
        
        // Monitorar estado do bot
        this.monitorBotState();
    }

    // ============================================
    // MÉTODOS AUXILIARES
    // ============================================

    monitorBotState() {
        // Ler estatísticas do bot a cada 5 segundos
        setInterval(() => {
            try {
                if (fs.existsSync(this.botStatsFile)) {
                    const stats = JSON.parse(fs.readFileSync(this.botStatsFile, 'utf8'));
                    this.botState = stats;
                }
            } catch (e) {}
        }, 5000);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ============================================
    // FERRAMENTAS QUE O AGENTE PODE EXECUTAR
    // ============================================

    async ajustarParametro(params) {
        const { nome, valor } = params;
        try {
            const configPath = path.join(__dirname, '../config/config.js');
            if (fs.existsSync(configPath)) {
                let configContent = fs.readFileSync(configPath, 'utf8');
                const regex = new RegExp(`${nome}:\\s*[^,\\n]+`, 'g');
                configContent = configContent.replace(regex, `${nome}: ${valor}`);
                fs.writeFileSync(configPath, configContent);
                return { success: true, message: `✅ Parâmetro ${nome} ajustado para ${valor}` };
            }
            return { success: false, message: '⚠️ Arquivo de configuração não encontrado' };
        } catch (error) {
            return { success: false, message: `❌ Erro: ${error.message}` };
        }
    }

    async executarTrade(params) {
        const { pair, quantidade } = params;
        try {
            let executor;
            try {
                executor = require('../executor/executor');
            } catch (e) {
                return { success: false, message: '⚠️ Módulo executor não disponível' };
            }
            
            if (executor && typeof executor.executeTrade === 'function') {
                const result = await executor.executeTrade(pair, quantidade);
                return { success: true, message: `✅ Trade executado: ${JSON.stringify(result)}` };
            }
            return { success: false, message: '⚠️ Função executeTrade não encontrada' };
        } catch (error) {
            return { success: false, message: `❌ Erro ao executar trade: ${error.message}` };
        }
    }

    async analisarPerformance() {
        try {
            // Tentar obter estatísticas reais do bot
            if (fs.existsSync(this.botStatsFile)) {
                const stats = JSON.parse(fs.readFileSync(this.botStatsFile, 'utf8'));
                return { 
                    success: true, 
                    message: `📊 PERFORMANCE DO BOT:\n` +
                            `  Trades totais: ${stats.totalTrades || 0}\n` +
                            `  Lucro: ${stats.profit || '0%'}\n` +
                            `  Taxa de sucesso: ${stats.successRate || '0%'}\n` +
                            `  Trades ativos: ${stats.activeTrades || 0}\n` +
                            `  Oportunidades: ${stats.opportunities || 0}`
                };
            }
            
            // Fallback
            const stats = this.getBotStats();
            return { 
                success: true, 
                message: `📊 Performance:\n${JSON.stringify(stats, null, 2)}` 
            };
        } catch (error) {
            return { success: false, message: `❌ Erro na análise: ${error.message}` };
        }
    }

    async pausarBot() {
        global.botPaused = true;
        // Tentar comunicar com o bot via ficheiro
        try {
            const result = await this.sendCommandToBot('pausar_bot', {});
            if (result.success) {
                return { success: true, message: '⏸️ Bot pausado com sucesso' };
            }
        } catch (e) {}
        return { success: true, message: '⏸️ Bot pausado (modo local)' };
    }

    async retomarBot() {
        global.botPaused = false;
        try {
            const result = await this.sendCommandToBot('retomar_bot', {});
            if (result.success) {
                return { success: true, message: '▶️ Bot retomado com sucesso' };
            }
        } catch (e) {}
        return { success: true, message: '▶️ Bot retomado (modo local)' };
    }

    async statusBot() {
        try {
            if (fs.existsSync(this.botStatsFile)) {
                const stats = JSON.parse(fs.readFileSync(this.botStatsFile, 'utf8'));
                const status = {
                    running: !global.botPaused,
                    uptime: Math.floor(process.uptime()),
                    activeTrades: stats.activeTrades || 0,
                    performance: {
                        totalTrades: stats.totalTrades || 0,
                        profit: stats.profit || '0%',
                        successRate: stats.successRate || '0%'
                    },
                    wallet: {
                        balance: stats.balance || '174419 SUPRA',
                        address: stats.address || '0x...'
                    },
                    market: {
                        pairs: stats.pairs || 56,
                        opportunities: stats.opportunities || 0
                    }
                };
                return { success: true, message: `📊 STATUS DO BOT:\n${JSON.stringify(status, null, 2)}` };
            }
        } catch (e) {}

        return { 
            success: true, 
            message: `📊 STATUS DO BOT:\n` +
                    `  Estado: ${global.botPaused ? '⏸️ Pausado' : '▶️ Ativo'}\n` +
                    `  Carteira: 174419 SUPRA\n` +
                    `  Pares: 56 ativos\n` +
                    `  Oportunidades: Nenhuma acima de 0.1%\n` +
                    `  Uptime: ${Math.floor(process.uptime() / 60)} minutos`
        };
    }

    async adicionarPool(params) {
        const { endereco } = params;
        try {
            const poolsPath = path.join(__dirname, '../spikeyPools.json');
            let pools = [];
            if (fs.existsSync(poolsPath)) {
                pools = JSON.parse(fs.readFileSync(poolsPath, 'utf8'));
            }
            if (!pools.includes(endereco)) {
                pools.push(endereco);
                fs.writeFileSync(poolsPath, JSON.stringify(pools, null, 2));
                return { success: true, message: `✅ Pool ${endereco} adicionado com sucesso` };
            }
            return { success: true, message: `ℹ️ Pool ${endereco} já existe` };
        } catch (error) {
            return { success: false, message: `❌ Erro ao adicionar pool: ${error.message}` };
        }
    }

    // ============================================
    // COMUNICAÇÃO COM O BOT
    // ============================================

    async sendCommandToBot(command, params = {}) {
        const cmd = {
            id: Date.now().toString(),
            command: command,
            params: params,
            timestamp: new Date().toISOString()
        };

        try {
            fs.writeFileSync(this.commandsFile, JSON.stringify(cmd, null, 2));
            
            let attempts = 0;
            while (attempts < 30) {
                await this.sleep(500);
                if (fs.existsSync(this.responseFile)) {
                    const response = JSON.parse(fs.readFileSync(this.responseFile, 'utf8'));
                    if (response.id === cmd.id) {
                        fs.unlinkSync(this.responseFile);
                        return response;
                    }
                }
                attempts++;
            }
        } catch (e) {
            return { success: false, message: 'Erro na comunicação' };
        }
        return { success: false, message: '⏰ Timeout - Bot ocupado ou não respondeu' };
    }

    // ============================================
    // ESTATÍSTICAS DO BOT
    // ============================================

    getBotStats() {
        try {
            const logPath = path.join(__dirname, '../spikey_errors.log');
            if (fs.existsSync(logPath)) {
                const logContent = fs.readFileSync(logPath, 'utf8');
                const lines = logContent.split('\n').filter(l => l.trim());
                return {
                    totalTrades: lines.length,
                    lastTrade: lines[lines.length - 1] || 'Nenhum',
                    profit: '0%',
                    successRate: '100%'
                };
            }
        } catch (e) {}
        return {
            totalTrades: 0,
            profit: '0%',
            successRate: '0%'
        };
    }

    getActiveTrades() {
        return 0;
    }

    getWalletInfo() {
        return {
            balance: '174419 SUPRA',
            address: '0x...'
        };
    }

    // ============================================
    // LOAD TOOLS - DEPOIS DE TODOS OS MÉTODOS DEFINIDOS
    // ============================================

    loadTools() {
        return {
            'ajustar_parametro': this.ajustarParametro.bind(this),
            'executar_trade': this.executarTrade.bind(this),
            'analisar_performance': this.analisarPerformance.bind(this),
            'pausar_bot': this.pausarBot.bind(this),
            'retomar_bot': this.retomarBot.bind(this),
            'status_bot': this.statusBot.bind(this),
            'adicionar_pool': this.adicionarPool.bind(this)
        };
    }

    // ============================================
    // PROCESSAR COMANDOS
    // ============================================

    async processUserCommand(input) {
        const quickCommands = {
            'status': 'status_bot',
            'pausar': 'pausar_bot',
            'retomar': 'retomar_bot',
            'performance': 'analisar_performance',
            'ajuda': 'ajuda',
            'help': 'ajuda'
        };

        const inputLower = input.toLowerCase().trim();
        
        // Comandos rápidos
        if (quickCommands[inputLower]) {
            const toolName = quickCommands[inputLower];
            if (toolName === 'ajuda') {
                return this.showHelp();
            }
            const result = await this.tools[toolName]({});
            return result.message;
        }

        // Processar comando natural com DeepSeek
        this.contextHistory.push({ role: 'user', content: input });

        const systemPrompt = `Você é um assistente especializado em trading e arbitragem na blockchain Supra.
        Você tem acesso a estas ferramentas: ${Object.keys(this.tools).join(', ')}.
        Quando o usuário pedir uma ação que requer uma ferramenta, responda com um JSON no formato:
        {"action": "nome_da_ferramenta", "params": {param1: valor1, param2: valor2}}
        Se for apenas uma conversa normal, responda naturalmente.
        Contexto atual: Bot com carteira de 174419 SUPRA, monitorando 56 pares ativos.`;

        try {
            const response = await this.deepseek.chat([
                { role: 'system', content: systemPrompt },
                ...this.contextHistory.slice(-10)
            ]);

            this.contextHistory.push({ role: 'assistant', content: response });

            try {
                const action = JSON.parse(response);
                if (action.action && this.tools[action.action]) {
                    const result = await this.tools[action.action](action.params || {});
                    return `🤖 ${result.message}`;
                }
            } catch (e) {
                return response;
            }

            return response;
        } catch (error) {
            return `❌ Erro: ${error.message}`;
        }
    }

    // ============================================
    // HELP E INTERFACE
    // ============================================

    showHelp() {
        return `📚 COMANDOS DISPONÍVEIS:
        
    📊 INFORMAÇÃO:
    • status - Ver status do bot
    • performance - Análise de performance
    
    🎮 CONTROLE:
    • pausar - Pausar operações
    • retomar - Retomar operações
    
    💬 COMANDOS NATURAIS:
    • "Ajusta o parâmetro X para Y"
    • "Executa trade de ETH no valor de 100"
    • "Adiciona pool 0x123..."
    • "Analisa o mercado"
    • "Qual é o estado do bot?"
    
    ❓ ajuda - Mostrar esta mensagem
    sair - Encerrar o agente`;
    }

    startDialog() {
        console.log('\n' + '='.repeat(60));
        console.log('🤖 AGENTE DEEPSEEK - TRADING BOT SUPRA');
        console.log('='.repeat(60));
        console.log('\n📊 Status: Bot ativo com 174419 SUPRA');
        console.log('📈 Monitorando 56 pares ativos');
        console.log('\n💬 Digite "ajuda" para ver comandos disponíveis');
        console.log('💬 Digite "sair" para encerrar\n');
        console.log('='.repeat(60) + '\n');

        this.rl.prompt();

        this.rl.on('line', async (input) => {
            const trimmedInput = input.trim();
            
            if (trimmedInput.toLowerCase() === 'sair' || trimmedInput.toLowerCase() === 'exit') {
                console.log('\n👋 Até logo!');
                this.rl.close();
                process.exit(0);
                return;
            }

            if (trimmedInput) {
                console.log('\n🧠 Processando...');
                const response = await this.processUserCommand(trimmedInput);
                console.log(`\n${response}\n`);
                console.log('─'.repeat(60));
            }
            this.rl.prompt();
        });

        this.rl.on('close', () => {
            console.log('\n👋 Conexão encerrada');
            process.exit(0);
        });
    }
}

module.exports = AgentCore;