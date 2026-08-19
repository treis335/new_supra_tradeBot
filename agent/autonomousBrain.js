// agent/autonomousBrain.js
const fs = require('fs');
const path = require('path');
const { DeepSeekAPI } = require('./deepseekClient');
const ExecutorActions = require('./executorActions');

class AutonomousBrain {
    constructor() {
        console.log('🧠 Inicializando Cérebro Autónomo...');
        this.deepseek = new DeepSeekAPI();
        this.running = true;
        this.learningCycle = 0;
        this.memoryFile = path.join(__dirname, '../.brain_memory.json');
        this.decisionsFile = path.join(__dirname, '../.brain_decisions.json');
        this.botStatsFile = path.join(__dirname, '../.bot_stats.json');
        this.marketDataFile = path.join(__dirname, '../.market_data.json');
        
        // NOVO: Inicializar executor de ações
        this.executor = new ExecutorActions();
        
        // Carregar memória
        this.memory = this.loadMemory();
        this.decisions = this.loadDecisions();
        
        // Iniciar ciclos de pensamento
        this.startThinking();
    }

    // ============================================
    // MEMÓRIA PERSISTENTE
    // ============================================

    loadMemory() {
        try {
            if (fs.existsSync(this.memoryFile)) {
                return JSON.parse(fs.readFileSync(this.memoryFile, 'utf8'));
            }
        } catch (e) {}
        return {
            learnings: [],
            patterns: [],
            improvements: [],
            startDate: new Date().toISOString()
        };
    }

    saveMemory() {
        fs.writeFileSync(this.memoryFile, JSON.stringify(this.memory, null, 2));
    }

    loadDecisions() {
        try {
            if (fs.existsSync(this.decisionsFile)) {
                return JSON.parse(fs.readFileSync(this.decisionsFile, 'utf8'));
            }
        } catch (e) {}
        return {
            actions: [],
            successful: [],
            failed: []
        };
    }

    saveDecisions() {
        fs.writeFileSync(this.decisionsFile, JSON.stringify(this.decisions, null, 2));
    }

    // ============================================
    // CICLO DE PENSAMENTO AUTÓNOMO
    // ============================================

    startThinking() {
        console.log('🧠 Iniciando ciclos de pensamento autónomo...');
        
        // Ciclo principal: pensar a cada 2 minutos
        setInterval(async () => {
            await this.think();
        }, 120000); // 2 minutos

        // Análise profunda a cada 10 minutos
        setInterval(async () => {
            await this.deepAnalysis();
        }, 600000); // 10 minutos

        // Aprendizado e adaptação a cada 5 minutos
        setInterval(async () => {
            await this.learnAndAdapt();
        }, 300000); // 5 minutos

        // NOVO: Auto-otimização a cada 15 minutos
        setInterval(async () => {
            await this.autoOptimize();
        }, 900000); // 15 minutos

        // Primeiro ciclo imediato
        setTimeout(() => {
            this.think();
        }, 5000);
    }

    // ============================================
    // PENSAR - Análise Rápida
    // ============================================

    async think() {
        try {
            console.log('\n🧠 [Ciclo de Pensamento] Analisando situação atual...');
            
            // Coletar dados
            const botStats = this.getBotStats();
            const marketData = this.getMarketData();
            
            // Construir prompt
            const prompt = `
            Você é o cérebro autónomo de um bot de arbitragem na blockchain Supra.
            
            DADOS ATUAIS:
            - Carteira: ${botStats.balance || '174419 SUPRA'}
            - Pares monitorados: ${botStats.pairs || 56}
            - Trades executados: ${botStats.totalTrades || 0}
            - Lucro atual: ${botStats.profit || '0%'}
            - Taxa de sucesso: ${botStats.successRate || '0%'}
            - Oportunidades detectadas: ${botStats.opportunities || 0}
            
            MERCADO:
            ${marketData ? JSON.stringify(marketData.slice(0, 5), null, 2) : 'Dados indisponíveis'}
            
            MEMÓRIA:
            - Aprendizados: ${this.memory.learnings.length}
            - Padrões detectados: ${this.memory.patterns.length}
            - Melhorias implementadas: ${this.memory.improvements.length}
            
            PERGUNTAS PARA VOCÊ:
            1. O que você observa de preocupante ou promissor?
            2. Que ajustes imediatos você sugere?
            3. Há algum padrão emergente?
            4. Como podemos melhorar a performance?
            
            Responda de forma concisa e acionável.`;

            const response = await this.deepseek.chat([
                { role: 'system', content: 'Você é um analista autónomo especializado em otimização de bots de trading.' },
                { role: 'user', content: prompt }
            ]);

            // Armazenar reflexão
            this.memory.learnings.push({
                timestamp: new Date().toISOString(),
                cycle: this.learningCycle++,
                analysis: response,
                stats: botStats
            });
            this.saveMemory();

            // Extrair e EXECUTAR ações da resposta
            await this.extractAndExecuteActions(response, botStats);

            console.log(`🧠 Pensamento concluído! (Ciclo ${this.learningCycle})`);
            console.log(`📝 ${response.substring(0, 200)}...`);

        } catch (error) {
            console.error('❌ Erro no ciclo de pensamento:', error.message);
        }
    }

    // ============================================
    // ANÁLISE PROFUNDA
    // ============================================

    async deepAnalysis() {
        try {
            console.log('\n🔬 [Análise Profunda] Examinando dados históricos...');
            
            const stats = this.getBotStats();
            const decisions = this.decisions;
            
            const prompt = `
            ANÁLISE PROFUNDA DE PERFORMANCE
            
            Histórico de Decisões:
            - Total: ${decisions.actions.length}
            - Bem sucedidas: ${decisions.successful.length}
            - Mal sucedidas: ${decisions.failed.length}
            - Taxa de sucesso: ${decisions.actions.length > 0 ? (decisions.successful.length / decisions.actions.length * 100).toFixed(2) : '0'}%
            
            Últimas 10 ações:
            ${JSON.stringify(decisions.actions.slice(-10), null, 2)}
            
            Padrões Detectados:
            ${JSON.stringify(this.memory.patterns, null, 2)}
            
            PERGUNTAS:
            1. Qual é o padrão de performance? Há ciclos?
            2. O que está funcionando bem?
            3. O que precisa ser melhorado drasticamente?
            4. Que nova estratégia você sugere?
            5. Há risco de perda? Como mitigar?
            
            Forneça uma análise detalhada e um plano de ação concreto.`;

            const response = await this.deepseek.chat([
                { role: 'system', content: 'Você é um estrategista sênior de trading com foco em otimização contínua.' },
                { role: 'user', content: prompt }
            ]);

            // Armazenar análise profunda
            this.memory.deepAnalysis = {
                timestamp: new Date().toISOString(),
                analysis: response,
                stats: stats
            };
            this.saveMemory();

            // Extrair e implementar melhorias
            await this.implementImprovements(response);

            console.log('🔬 Análise profunda concluída!');
            console.log(`📊 ${response.substring(0, 300)}...`);

        } catch (error) {
            console.error('❌ Erro na análise profunda:', error.message);
        }
    }

    // ============================================
    // APRENDIZADO E ADAPTAÇÃO
    // ============================================

    async learnAndAdapt() {
        try {
            console.log('\n📚 [Aprendizado] Analisando dados para evoluir...');
            
            const stats = this.getBotStats();
            const memory = this.memory;
            
            const prompt = `
            PROCESSO DE APRENDIZADO E EVOLUÇÃO
            
            Dados de Performance:
            - Trades: ${stats.totalTrades || 0}
            - Lucro: ${stats.profit || '0%'}
            - Sucesso: ${stats.successRate || '0%'}
            
            Conhecimento Adquirido:
            - ${memory.learnings.length} reflexões
            - ${memory.patterns.length} padrões
            - ${memory.improvements.length} melhorias
            
            PERGUNTAS:
            1. Que padrões você está detectando repetidamente?
            2. Como podemos usar esses padrões para prever oportunidades?
            3. Qual é a próxima evolução do bot?
            4. Que parâmetros devem ser ajustados automaticamente?
            
            Forneça insights para evolução do bot.`;

            const response = await this.deepseek.chat([
                { role: 'system', content: 'Você é um especialista em machine learning e evolução de sistemas de trading.' },
                { role: 'user', content: prompt }
            ]);

            // Extrair padrões
            await this.extractPatterns(response);

            console.log('📚 Aprendizado concluído!');
            console.log(`💡 ${response.substring(0, 200)}...`);

        } catch (error) {
            console.error('❌ Erro no aprendizado:', error.message);
        }
    }

    // ============================================
    // NOVO: AUTO-OTIMIZAÇÃO
    // ============================================

    async autoOptimize() {
        console.log('\n⚡ [Auto-Otimização] Analisando performance...');
        
        try {
            const stats = this.getBotStats();
            const melhorias = await this.executor.otimizarEstrategia(stats);
            
            if (melhorias.length > 0) {
                console.log('🔧 Melhorias aplicadas:');
                melhorias.forEach(m => console.log(`  ${m}`));
                
                // Registrar no cérebro
                this.memory.improvements.push({
                    timestamp: new Date().toISOString(),
                    type: 'auto_optimization',
                    changes: melhorias,
                    stats: stats
                });
                this.saveMemory();
            } else {
                console.log('✅ Performance está ótima! Nenhum ajuste necessário.');
            }
        } catch (error) {
            console.error('❌ Erro na auto-otimização:', error.message);
        }
    }

    // ============================================
    // EXTRAIR E EXECUTAR AÇÕES (MODIFICADO)
    // ============================================

    async extractAndExecuteActions(response, stats) {
        try {
            // Tentar extrair ações específicas da resposta
            const actions = [];
            
            // Padrões de busca para ações executivas
            const patterns = [
                { regex: /ajustar\s+(minProfit|maxSlippage|tradeSize|maxTradesPerMinute|stopLoss|takeProfit)\s+para\s+([\d.]+)/i, type: 'param' },
                { regex: /reduzir\s+(minProfit|maxSlippage|tradeSize|maxTradesPerMinute|stopLoss|takeProfit)\s+para\s+([\d.]+)/i, type: 'param' },
                { regex: /aumentar\s+(minProfit|maxSlippage|tradeSize|maxTradesPerMinute|stopLoss|takeProfit)\s+para\s+([\d.]+)/i, type: 'param' },
                { regex: /adicionar\s+pool\s+([0-9a-fx]+)/i, type: 'pool' },
                { regex: /risco\s+para\s+(baixo|m[ée]dio|alto)/i, type: 'risk' }
            ];

            for (const pattern of patterns) {
                const match = response.match(pattern.regex);
                if (match) {
                    if (pattern.type === 'param') {
                        actions.push({
                            type: 'adjust',
                            parameter: match[1],
                            value: parseFloat(match[2]),
                            confidence: 0.8
                        });
                    } else if (pattern.type === 'pool') {
                        actions.push({
                            type: 'add_pool',
                            address: match[1],
                            confidence: 0.7
                        });
                    } else if (pattern.type === 'risk') {
                        actions.push({
                            type: 'adjust_risk',
                            level: match[1],
                            confidence: 0.7
                        });
                    }
                }
            }

            if (actions.length > 0) {
                console.log('🎯 Ações executivas detectadas:', actions);
                
                for (const action of actions) {
                    await this.executeExecutiveAction(action);
                }
                
                this.decisions.actions.push(...actions);
                this.saveDecisions();
            }
        } catch (error) {
            console.error('Erro ao extrair ações:', error.message);
        }
    }

    // ============================================
    // NOVO: EXECUTAR AÇÃO EXECUTIVA
    // ============================================

    async executeExecutiveAction(action) {
        console.log(`⚡ Executando ação: ${JSON.stringify(action)}`);
        
        try {
            let result;
            switch(action.type) {
                case 'adjust':
                    // Usar executor para ajustar parâmetros
                    const params = {};
                    params[action.parameter] = action.value;
                    result = await this.executor.ajustarParametros(JSON.stringify(params));
                    console.log(`✅ Parâmetro ${action.parameter} ajustado para ${action.value}`);
                    break;
                    
                case 'add_pool':
                    result = await this.executor.adicionarPool(action.address);
                    console.log(`✅ Pool ${action.address} adicionado`);
                    break;
                    
                case 'adjust_risk':
                    // Ajustar nível de risco
                    const riskParams = { riskLevel: action.level };
                    result = await this.executor.ajustarParametros(JSON.stringify(riskParams));
                    console.log(`✅ Nível de risco ajustado para ${action.level}`);
                    break;
                    
                default:
                    console.log(`⚠️ Ação desconhecida: ${action.type}`);
                    return;
            }
            
            this.decisions.successful.push({
                ...action,
                executedAt: new Date().toISOString(),
                result: result
            });
            this.saveDecisions();
            
        } catch (error) {
            console.error(`❌ Erro ao executar ação: ${error.message}`);
            this.decisions.failed.push({
                ...action,
                error: error.message,
                timestamp: new Date().toISOString()
            });
            this.saveDecisions();
        }
    }

    // ============================================
    // NOVO: PROCESSAR COMANDOS EXECUTIVOS
    // ============================================

    async processCommand(command) {
        const cmd = command.toLowerCase().trim();
        
        // Verificar se é um comando executivo
        const executiveCommands = {
            'ajustar': this.executor.ajustarParametros.bind(this.executor),
            'otimizar': this.executor.otimizarEstrategia.bind(this.executor),
            'adicionar_pool': this.executor.adicionarPool.bind(this.executor),
            'melhorar': this.executor.ajustarParametros.bind(this.executor),
            'otimiza': this.executor.otimizarEstrategia.bind(this.executor),
            'status': this.executor.getOptimizationReport.bind(this.executor)
        };
        
        for (const [key, action] of Object.entries(executiveCommands)) {
            if (cmd.includes(key)) {
                console.log(`⚡ Executando comando: ${key}`);
                const result = await action(cmd);
                return {
                    success: true,
                    message: `✅ Comando executado: ${JSON.stringify(result)}`,
                    action: key,
                    result: result
                };
            }
        }
        
        // Se não for comando executivo, usar DeepSeek
        return null;
    }

    // ============================================
    // EXTRAIR PADRÕES
    // ============================================

    async extractPatterns(response) {
        try {
            const patterns = [];
            
            if (response.includes('tendência') || response.includes('padrão')) {
                patterns.push({
                    type: 'trend',
                    description: response.substring(0, 200),
                    timestamp: new Date().toISOString()
                });
            }

            if (patterns.length > 0) {
                this.memory.patterns.push(...patterns);
                this.saveMemory();
                console.log(`📊 Padrões detectados: ${patterns.length}`);
            }
        } catch (error) {
            console.error('Erro ao extrair padrões:', error.message);
        }
    }

    // ============================================
    // IMPLEMENTAR MELHORIAS
    // ============================================

    async implementImprovements(response) {
        try {
            if (response.includes('melhorar') || response.includes('otimizar') || response.includes('ajustar')) {
                const improvement = {
                    suggested: response.substring(0, 500),
                    timestamp: new Date().toISOString(),
                    implemented: false
                };
                
                this.memory.improvements.push(improvement);
                this.saveMemory();
                
                console.log('🔧 Melhoria sugerida registrada');
            }
        } catch (error) {
            console.error('Erro ao implementar melhorias:', error.message);
        }
    }

    // ============================================
    // COLETA DE DADOS
    // ============================================

    getBotStats() {
        try {
            if (fs.existsSync(this.botStatsFile)) {
                return JSON.parse(fs.readFileSync(this.botStatsFile, 'utf8'));
            }
        } catch (e) {}
        return {
            balance: '174419 SUPRA',
            pairs: 56,
            totalTrades: 0,
            profit: '0%',
            successRate: '0%',
            opportunities: 0
        };
    }

    getMarketData() {
        try {
            if (fs.existsSync(this.marketDataFile)) {
                return JSON.parse(fs.readFileSync(this.marketDataFile, 'utf8'));
            }
        } catch (e) {}
        return null;
    }

    // ============================================
    // RELATÓRIOS
    // ============================================

    getStatusReport() {
        return {
            cycles: this.learningCycle,
            memory: {
                learnings: this.memory.learnings.length,
                patterns: this.memory.patterns.length,
                improvements: this.memory.improvements.length
            },
            decisions: {
                total: this.decisions.actions.length,
                successful: this.decisions.successful.length,
                failed: this.decisions.failed.length
            },
            lastThinking: this.memory.learnings[this.memory.learnings.length - 1]?.timestamp || 'Nunca',
            currentParams: this.executor.params
        };
    }
}

module.exports = AutonomousBrain;