// agent/executorActions.js
const fs = require('fs');
const path = require('path');

class ExecutorActions {
    constructor() {
        this.configPath = path.join(__dirname, '../config/config.js');
        this.poolsPath = path.join(__dirname, '../spikeyPools.json');
        this.paramsPath = path.join(__dirname, '../.optimized_params.json');
        // Nunca escreve diretamente no bot real -- qualquer mudança passa
        // pela fila de propostas e só se torna real com aprovação humana
        // no dashboard. Ver intelligence/proposalQueue.js e proposalApplier.js.
        this.proposalQueue = require('../intelligence/proposalQueue');
        
        // Carregar parâmetros otimizados
        this.loadOptimizedParams();
    }

    loadOptimizedParams() {
        try {
            if (fs.existsSync(this.paramsPath)) {
                this.params = JSON.parse(fs.readFileSync(this.paramsPath, 'utf8'));
            } else {
                this.params = {
                    minProfit: 0.1,
                    maxSlippage: 0.5,
                    tradeSize: 100,
                    maxTradesPerMinute: 5,
                    riskLevel: 'medium',
                    stopLoss: 0.02,
                    takeProfit: 0.05,
                    updatedAt: new Date().toISOString()
                };
                this.saveParams();
            }
        } catch (e) {
            this.params = {};
        }
    }

    saveParams() {
        fs.writeFileSync(this.paramsPath, JSON.stringify(this.params, null, 2));
    }

    // ============================================
    // AÇÕES EXECUTIVAS
    // ============================================

    // 1. AJUSTAR PARÂMETROS DO BOT
    async ajustarParametros(sugestoes) {
        const changes = [];
        
        // Mapear sugestões para ações concretas
        const actions = this.parseSuggestions(sugestoes);
        
        for (const action of actions) {
            try {
                switch(action.type) {
                    case 'minProfit':
                        this.params.minProfit = action.value;
                        changes.push(`✅ minProfit ajustado para ${action.value}%`);
                        break;
                    case 'maxSlippage':
                        this.params.maxSlippage = action.value;
                        changes.push(`✅ maxSlippage ajustado para ${action.value}%`);
                        break;
                    case 'tradeSize':
                        this.params.tradeSize = action.value;
                        changes.push(`✅ tradeSize ajustado para ${action.value} SUPRA`);
                        break;
                    case 'maxTradesPerMinute':
                        this.params.maxTradesPerMinute = action.value;
                        changes.push(`✅ maxTradesPerMinute ajustado para ${action.value}`);
                        break;
                    case 'riskLevel':
                        this.params.riskLevel = action.value;
                        changes.push(`✅ riskLevel ajustado para ${action.value}`);
                        break;
                    case 'stopLoss':
                        this.params.stopLoss = action.value;
                        changes.push(`✅ stopLoss ajustado para ${action.value}%`);
                        break;
                    case 'takeProfit':
                        this.params.takeProfit = action.value;
                        changes.push(`✅ takeProfit ajustado para ${action.value}%`);
                        break;
                }
            } catch (e) {
                changes.push(`❌ Erro ao ajustar ${action.type}: ${e.message}`);
            }
        }
        
        this.params.updatedAt = new Date().toISOString();
        this.saveParams();
        
        // Aplicar ao config real
        await this.applyToConfig();
        
        return changes;
    }

    // 2. PARSE DE SUGESTÕES EM AÇÕES
    parseSuggestions(sugestoes) {
        const actions = [];
        const text = sugestoes.toLowerCase();
        
        // Detectar e extrair valores
        const patterns = {
            minProfit: /(?:min(?:imum)?\s*profit|profit\s*min)\s*(?:de|para)?\s*([\d.]+)/i,
            maxSlippage: /(?:max(?:imum)?\s*slippage|slippage\s*max)\s*(?:de|para)?\s*([\d.]+)/i,
            tradeSize: /(?:trade\s*size|tamanho\s*do\s*trade|size)\s*(?:de|para)?\s*([\d.]+)/i,
            maxTradesPerMinute: /(?:max\s*trades|trades\s*por\s*minuto)\s*(?:de|para)?\s*([\d.]+)/i,
            riskLevel: /(?:risk\s*level|n[íi]vel\s*de\s*risco)\s*(?:de|para)?\s*(baixo|m[ée]dio|alto)/i,
            stopLoss: /(?:stop\s*loss|stop-loss)\s*(?:de|para)?\s*([\d.]+)/i,
            takeProfit: /(?:take\s*profit|take-profit)\s*(?:de|para)?\s*([\d.]+)/i
        };
        
        for (const [type, pattern] of Object.entries(patterns)) {
            const match = text.match(pattern);
            if (match) {
                let value = match[1];
                // Converter para número se for número
                if (!isNaN(value) && type !== 'riskLevel') {
                    value = parseFloat(value);
                }
                actions.push({ type, value });
            }
        }
        
        // Se não encontrou ações específicas, usar inteligência para inferir
        if (actions.length === 0) {
            actions.push(...this.inferActionsFromText(text));
        }
        
        return actions;
    }

    // 3. INFERIR AÇÕES DO TEXTO
    inferActionsFromText(text) {
        const actions = [];
        
        // Inferir de palavras-chave
        if (text.includes('aumentar') || text.includes('mais') || text.includes('aumenta')) {
            if (text.includes('profit') || text.includes('lucro')) {
                actions.push({ type: 'minProfit', value: 0.15 });
            }
            if (text.includes('trade') || text.includes('tamanho')) {
                actions.push({ type: 'tradeSize', value: 150 });
            }
        }
        
        if (text.includes('diminuir') || text.includes('menos') || text.includes('reduzir')) {
            if (text.includes('slippage')) {
                actions.push({ type: 'maxSlippage', value: 0.3 });
            }
            if (text.includes('trade') || text.includes('tamanho')) {
                actions.push({ type: 'tradeSize', value: 50 });
            }
        }
        
        if (text.includes('risco') || text.includes('risk')) {
            if (text.includes('baixo') || text.includes('low')) {
                actions.push({ type: 'riskLevel', value: 'baixo' });
            } else if (text.includes('alto') || text.includes('high')) {
                actions.push({ type: 'riskLevel', value: 'alto' });
            } else {
                actions.push({ type: 'riskLevel', value: 'medio' });
            }
        }
        
        return actions;
    }

    // 4. PROPOR AJUSTE AO CONFIG REAL (nunca escreve diretamente -- fica
    // pendente até aprovação humana no dashboard)
    async applyToConfig() {
        try {
            // Mapeia os nomes internos (legado, nao batem certo com o config
            // real) para os nomes REAIS usados em CONFIG.autoExecute. So os
            // que tem equivalente real sao propostos -- os outros (tradeSize,
            // riskLevel, takeProfit) nao existem no bot real e sao ignorados.
            const realNameMap = {
                minProfit: 'minProfitPct',
                stopLoss: null,
                maxTradesPerMinute: null,
            };
            const payload = {};
            for (const [oldKey, realKey] of Object.entries(realNameMap)) {
                if (!realKey) continue;
                if (this.params[oldKey] !== undefined) payload[realKey] = this.params[oldKey];
            }
            if (Object.keys(payload).length === 0) return false;

            this.proposalQueue.addProposal({
                type: 'config_adjust',
                summary: `Ajuste sugerido pelo agente: ${Object.entries(payload).map(([k, v]) => `${k}=${v}`).join(', ')}`,
                payload,
                source: 'executorActions.otimizarEstrategia',
            });
            console.log('📋 Proposta de ajuste registada -- aguarda aprovação no dashboard.');
            return true;
        } catch (e) {
            console.error('Erro ao aplicar configuração:', e);
            return false;
        }
    }

    // 5. ADICIONAR NOVOS POOLS
    async adicionarPool(endereco, tokenA, tokenB) {
        // Nunca escreve diretamente em spikeyPools.json -- o formato real
        // exige {address, tokenA, tokenB}, e uma string solta partia o
        // ficheiro para todo o resto do bot que o lê (spikeyDiscovery,
        // spikeyConfig). Fica como proposta pendente até aprovação.
        if (!tokenA || !tokenB) {
            return { success: false, message: '❌ tokenA e tokenB são obrigatórios (o endereço sozinho não chega -- corromperia o ficheiro).' };
        }
        this.proposalQueue.addProposal({
            type: 'add_pool',
            summary: `Adicionar pool ${endereco} (${tokenA}/${tokenB})`,
            payload: { address: endereco, tokenA, tokenB },
            source: 'executorActions.adicionarPool',
        });
        return { success: true, message: `📋 Proposta registada para o pool ${endereco} -- aguarda aprovação no dashboard.` };
    }

    // 6. OTIMIZAR ESTRATÉGIA AUTOMATICAMENTE
    async otimizarEstrategia(performanceData) {
        const melhorias = [];
        
        // Analisar performance e sugerir melhorias
        if (performanceData) {
            const profit = parseFloat(performanceData.profit) || 0;
            const successRate = parseFloat(performanceData.successRate) || 0;
            const trades = performanceData.totalTrades || 0;
            
            // Se lucro está baixo, ajustar minProfit
            if (profit < 5 && profit > 0) {
                const newMinProfit = Math.max(0.05, this.params.minProfit - 0.02);
                this.params.minProfit = newMinProfit;
                melhorias.push(`📉 Lucro baixo (${profit}%) → minProfit reduzido para ${newMinProfit}%`);
            }
            
            // Se taxa de sucesso está baixa, ajustar stopLoss
            if (successRate < 50 && successRate > 0) {
                const newStopLoss = Math.min(0.05, this.params.stopLoss + 0.01);
                this.params.stopLoss = newStopLoss;
                melhorias.push(`📉 Sucesso baixo (${successRate}%) → stopLoss aumentado para ${newStopLoss}%`);
            }
            
            // Se muitas trades, ajustar frequência
            if (trades > 100) {
                const newMaxTrades = Math.max(3, this.params.maxTradesPerMinute - 1);
                this.params.maxTradesPerMinute = newMaxTrades;
                melhorias.push(`🔄 Muitas trades (${trades}) → maxTrades reduzido para ${newMaxTrades}/min`);
            }
        }
        
        if (melhorias.length > 0) {
            this.params.optimizedAt = new Date().toISOString();
            this.saveParams();
            await this.applyToConfig();
        }
        
        return melhorias;
    }

    // 7. RELATÓRIO DE OTIMIZAÇÃO
    getOptimizationReport() {
        return {
            currentParams: this.params,
            optimizationHistory: this.getHistory(),
            suggestions: this.generateSuggestions(),
            timestamp: new Date().toISOString()
        };
    }

    getHistory() {
        try {
            const historyPath = path.join(__dirname, '../.optimization_history.json');
            if (fs.existsSync(historyPath)) {
                return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
            }
        } catch (e) {}
        return [];
    }

    generateSuggestions() {
        const suggestions = [];
        
        // Sugestões baseadas nos parâmetros atuais
        if (this.params.minProfit > 0.2) {
            suggestions.push('💡 Considere reduzir minProfit para capturar mais oportunidades');
        }
        if (this.params.maxSlippage > 0.5) {
            suggestions.push('💡 Reduza maxSlippage para evitar perdas por slippage');
        }
        if (this.params.tradeSize < 50) {
            suggestions.push('💡 Aumente tradeSize para melhorar rentabilidade');
        }
        
        return suggestions;
    }
}

module.exports = ExecutorActions;