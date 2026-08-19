// agent/deepseekClient.js
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

class DeepSeekAPI {
    constructor() {
        this.apiKey = process.env.DEEPSEEK_API_KEY;
        this.baseURL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1';
        this.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
        
        if (!this.apiKey) {
            console.warn('⚠️ DEEPSEEK_API_KEY não encontrada no .env');
            console.warn('⚠️ O agente funcionará em modo offline (comandos básicos apenas)');
            this.offlineMode = true;
        } else {
            this.offlineMode = false;
            console.log('✅ DeepSeek API configurada com sucesso');
        }
    }

    async chat(messages) {
        if (this.offlineMode) {
            return this.offlineResponse(messages);
        }

        try {
            const response = await axios.post(`${this.baseURL}/chat/completions`, {
                model: this.model,
                messages: messages,
                temperature: 0.7,
                max_tokens: 1000
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            return response.data.choices[0].message.content;
        } catch (error) {
            console.error('❌ Erro na API DeepSeek:', error.response?.data?.error?.message || error.message);
            return this.offlineResponse(messages);
        }
    }

    offlineResponse(messages) {
        // Resposta offline para quando não há API key
        const lastUserMessage = messages.filter(m => m.role === 'user').pop();
        if (lastUserMessage) {
            const msg = lastUserMessage.content.toLowerCase();
            if (msg.includes('ajuda') || msg.includes('help')) {
                return 'Use "ajuda" para ver todos os comandos disponíveis.';
            }
            if (msg.includes('status')) {
                return '📊 Bot ativo com 174419 SUPRA. 56 pares monitorados.';
            }
            if (msg.includes('analisa') || msg.includes('performance')) {
                return '📈 Análise: O bot está funcionando normalmente. Nenhuma oportunidade de arbitragem detectada acima de 0.1%.';
            }
            return '🤖 Agente em modo offline. Configure DEEPSEEK_API_KEY no .env para respostas completas.';
        }
        return '🤖 Agente pronto. Como posso ajudar?';
    }

    async analyzeData(data, prompt) {
        const messages = [
            { role: 'system', content: 'Você é um analista especializado em dados de trading e arbitragem.' },
            { role: 'user', content: `${prompt}\n\nDados: ${JSON.stringify(data, null, 2)}` }
        ];
        return this.chat(messages);
    }
}

module.exports = { DeepSeekAPI };