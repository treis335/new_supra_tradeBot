// agent/standalone.js
const AgentCore = require('./agentCore');

console.log('🚀 Inicializando Agente DeepSeek (Standalone)...');

// Configurar estado global do bot
global.botPaused = false;

// Iniciar agente
const agent = new AgentCore();
agent.startDialog();

// Manter processo vivo
process.on('SIGINT', () => {
    console.log('\n👋 Encerrando agente...');
    process.exit(0);
});

module.exports = agent;