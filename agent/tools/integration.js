// agent/tools/integration.js
const fs = require('fs');
const path = require('path');

class BotIntegration {
    constructor() {
        this.botModules = {
            executor: null,
            detector: null,
            engine: null
        };
        this.loadModules();
    }

    loadModules() {
        try {
            // Carregar módulos existentes do bot
            this.botModules.executor = require('../../executor/executor');
            this.botModules.detector = require('../../detector/detector');
            this.botModules.engine = require('../../engine/engine');
            console.log('✅ Módulos do bot carregados com sucesso');
        } catch (error) {
            console.warn('⚠️ Não foi possível carregar todos os módulos:', error.message);
        }
    }

    async executeTrade(params) {
        // Implementar integração real com executor
        if (this.botModules.executor) {
            return await this.botModules.executor.execute(params);
        }
        throw new Error('Executor não disponível');
    }

    async analyzeMarket() {
        if (this.botModules.detector) {
            return await this.botModules.detector.analyze();
        }
        throw new Error('Detector não disponível');
    }

    async getBotState() {
        // Retornar estado atual do bot
        return {
            paused: global.botPaused || false,
            modules: Object.keys(this.botModules).filter(k => this.botModules[k] !== null),
            config: this.loadConfig()
        };
    }

    loadConfig() {
        try {
            const configPath = path.join(__dirname, '../../config/config.js');
            return require(configPath);
        } catch {
            return {};
        }
    }
}

module.exports = BotIntegration;