// agent/commands.js
const commands = {
    'ajuda': 'Lista todos os comandos disponíveis',
    'status': 'Mostra o status atual do bot',
    'pausar': 'Pausa todas as operações do bot',
    'retomar': 'Retoma as operações do bot',
    'performance': 'Mostra análise de performance',
    'analisar': 'Solicita análise DeepSeek da situação atual'
};

const commandHandlers = {
    async ajuda() {
        return 'Comandos disponíveis:\n' + Object.entries(commands)
            .map(([cmd, desc]) => `  - ${cmd}: ${desc}`)
            .join('\n');
    },
    
    async status(agent) {
        const status = agent.getBotStats();
        return `📊 Status do Bot:\n` +
               `  Estado: ${global.botPaused ? '⏸️ Pausado' : '▶️ Ativo'}\n` +
               `  Trades: ${status.totalTrades || 0}\n` +
               `  Lucro: ${status.profit || 0}%\n` +
               `  Uptime: ${Math.floor(process.uptime() / 60)} minutos`;
    },
    
    async pausar(agent) {
        return agent.pausarBot();
    },
    
    async retomar(agent) {
        return agent.retomarBot();
    },
    
    async performance(agent) {
        return agent.analisarPerformance();
    },
    
    async analisar(agent) {
        const stats = agent.getBotStats();
        const prompt = `Analise esta performance de trading: ${JSON.stringify(stats)} e sugira melhorias específicas.`;
        return agent.deepseek.analyzeData(stats, prompt);
    }
};

module.exports = { commands, commandHandlers };