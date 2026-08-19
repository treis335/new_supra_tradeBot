// agent/autonomous.js
const AutonomousBrain = require('./autonomousBrain');
const readline = require('readline');

console.log('🚀 Inicializando Cérebro Autónomo da Supra...');
console.log('🧠 O bot está a pensar e evoluir sozinho!');
console.log('⚡ AGORA ELE TAMBÉM AGE!');

// Iniciar cérebro autónomo
const brain = new AutonomousBrain();

console.log('='.repeat(60));
console.log('🤖 BOT AUTÓNOMO ATIVO!');
console.log('📊 O bot está a analisar dados e evoluir continuamente');
console.log('⚡ O bot EXECUTA as melhorias AUTOMATICAMENTE');
console.log('='.repeat(60));
console.log('\n🔍 Comandos disponíveis:\n');
console.log('  "status" - Ver estado do bot e do cérebro');
console.log('  "relatorio" - Ver relatório de aprendizado');
console.log('  "pensamentos" - Ver últimas análises');
console.log('  "parametros" - Ver parâmetros atuais do bot');
console.log('  "ajustar X para Y" - Ajusta parâmetro (ex: ajustar minProfit para 0.15)');
console.log('  "otimizar" - Otimiza estratégia automaticamente');
console.log('  "adicionar pool 0x..." - Adiciona novo pool');
console.log('  "ajuda" - Ver comandos disponíveis');
console.log('  "sair" - Encerrar\n');

// Interface de diálogo
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '🤖 Você: '
});

rl.prompt();

rl.on('line', async (input) => {
    const trimmed = input.trim();
    
    if (trimmed.toLowerCase() === 'sair' || trimmed.toLowerCase() === 'exit') {
        console.log('\n👋 Até logo! O bot continua a evoluir sem você...');
        rl.close();
        process.exit(0);
        return;
    }

    if (trimmed) {
        // Primeiro, tentar processar como comando executivo
        const executiveResult = await brain.processCommand(trimmed);
        
        if (executiveResult && executiveResult.success) {
            console.log(`\n${executiveResult.message}\n`);
            rl.prompt();
            return;
        }

        // Se não for executivo, processar como comando normal
        switch(trimmed.toLowerCase()) {
            case 'status':
                const report = brain.getStatusReport();
                console.log('\n📊 RELATÓRIO DO CÉREBRO AUTÓNOMO:');
                console.log('═'.repeat(40));
                console.log(`🔄 Ciclos de pensamento: ${report.cycles}`);
                console.log(`🧠 Reflexões: ${report.memory.learnings}`);
                console.log(`📊 Padrões: ${report.memory.patterns}`);
                console.log(`🔧 Melhorias: ${report.memory.improvements}`);
                console.log(`🎯 Decisões: ${report.decisions.total} (${report.decisions.successful} bem sucedidas)`);
                console.log(`⏰ Último pensamento: ${report.lastThinking}`);
                console.log('═'.repeat(40) + '\n');
                break;
                
            case 'relatorio':
                console.log('\n📊 RELATÓRIO COMPLETO:');
                console.log('═'.repeat(40));
                console.log(JSON.stringify(brain.memory, null, 2));
                console.log('═'.repeat(40) + '\n');
                break;
                
            case 'pensamentos':
                const lastLearnings = brain.memory.learnings.slice(-3);
                console.log('\n🧠 ÚLTIMOS PENSAMENTOS:');
                console.log('═'.repeat(40));
                lastLearnings.forEach((l, i) => {
                    console.log(`[${i+1}] ${l.timestamp}`);
                    console.log(`${l.analysis.substring(0, 300)}...\n`);
                });
                console.log('═'.repeat(40) + '\n');
                break;
                
            case 'parametros':
                console.log('\n📊 PARÂMETROS ATUAIS DO BOT:');
                console.log('═'.repeat(40));
                console.log(JSON.stringify(brain.executor.params, null, 2));
                console.log('═'.repeat(40) + '\n');
                break;
                
            case 'ajuda':
            case 'help':
                console.log('\n📚 COMANDOS DISPONÍVEIS:');
                console.log('═'.repeat(40));
                console.log('  status      - Ver estado do bot e cérebro');
                console.log('  relatorio   - Relatório completo de aprendizado');
                console.log('  pensamentos - Ver últimas análises');
                console.log('  parametros  - Ver parâmetros atuais do bot');
                console.log('  ajustar X para Y - Ajusta parâmetro');
                console.log('  otimizar    - Otimiza estratégia automaticamente');
                console.log('  adicionar pool 0x... - Adiciona novo pool');
                console.log('  ajuda       - Este menu');
                console.log('  sair        - Encerrar');
                console.log('\n💡 EXEMPLOS:');
                console.log('  > ajustar minProfit para 0.15');
                console.log('  > ajustar tradeSize para 200');
                console.log('  > adicionar pool 0x1234567890abcdef');
                console.log('  > otimizar');
                console.log('═'.repeat(40) + '\n');
                break;
                
            default:
                // Tentar interpretar com DeepSeek
                console.log('\n🧠 Processando pergunta...');
                try {
                    const response = await brain.deepseek.chat([
                        { role: 'system', content: 'Você é um assistente de trading. Responda de forma útil e concisa.' },
                        { role: 'user', content: trimmed }
                    ]);
                    console.log(`\n🤖 ${response}\n`);
                } catch (error) {
                    console.log(`\n❌ Erro: ${error.message}\n`);
                }
                break;
        }
    }
    rl.prompt();
});

rl.on('close', () => {
    console.log('\n👋 Conexão encerrada');
    process.exit(0);
});

// Manter processo vivo
process.on('SIGINT', () => {
    console.log('\n\n👋 Encerrando... O cérebro continuará a evoluir quando reiniciar');
    process.exit(0);
});

module.exports = brain;