// agent/executiveInterface.js
const readline = require('readline');
const ExecutorActions = require('./executorActions');

class ExecutiveInterface {
    constructor() {
        this.executor = new ExecutorActions();
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: '⚡ Executor> '
        });
        
        this.showMenu();
        this.start();
    }

    showMenu() {
        console.log('\n' + '='.repeat(60));
        console.log('⚡ EXECUTOR AUTÓNOMO - O BOT AGE SOZINHO');
        console.log('='.repeat(60));
        console.log('\n📋 COMANDOS EXECUTIVOS:');
        console.log('  1. "ajustar minProfit para 0.15"');
        console.log('  2. "ajustar tradeSize para 200"');
        console.log('  3. "adicionar pool 0x123..."');
        console.log('  4. "otimizar estrategia"');
        console.log('  5. "status" - Ver parâmetros atuais');
        console.log('  6. "relatorio" - Relatório de otimização');
        console.log('  7. "sair" - Encerrar');
        console.log('\n💡 O bot VAI EXECUTAR as mudanças AUTOMATICAMENTE');
        console.log('='.repeat(60) + '\n');
    }

    start() {
        this.rl.prompt();
        
        this.rl.on('line', async (input) => {
            const cmd = input.trim();
            
            if (cmd === 'sair') {
                console.log('👋 Até logo!');
                this.rl.close();
                process.exit(0);
                return;
            }
            
            await this.processCommand(cmd);
            this.rl.prompt();
        });
    }

    async processCommand(cmd) {
        try {
            if (cmd === 'status') {
                console.log('\n📊 PARÂMETROS ATUAIS:');
                console.log(JSON.stringify(this.executor.params, null, 2));
                return;
            }
            
            if (cmd === 'relatorio') {
                const report = this.executor.getOptimizationReport();
                console.log('\n📊 RELATÓRIO DE OTIMIZAÇÃO:');
                console.log(JSON.stringify(report, null, 2));
                return;
            }
            
            // Executar ações
            if (cmd.includes('ajustar') || cmd.includes('melhorar')) {
                console.log('⚡ Ajustando parâmetros...');
                const result = await this.executor.ajustarParametros(cmd);
                console.log('\n📋 RESULTADO:');
                result.forEach(r => console.log(`  ${r}`));
                console.log('\n✅ Parâmetros atualizados!');
                return;
            }
            
            if (cmd.includes('adicionar pool')) {
                const match = cmd.match(/0x[a-fA-F0-9]+/);
                if (match) {
                    const result = await this.executor.adicionarPool(match[0]);
                    console.log(`\n${result.message}`);
                } else {
                    console.log('\n❌ Endereço de pool inválido');
                }
                return;
            }
            
            if (cmd.includes('otimizar')) {
                console.log('⚡ Otimizando estratégia...');
                const stats = { profit: '12.4%', successRate: '78.2%', totalTrades: 342 };
                const melhorias = await this.executor.otimizarEstrategia(stats);
                if (melhorias.length > 0) {
                    console.log('\n🔧 MELHORIAS APLICADAS:');
                    melhorias.forEach(m => console.log(`  ${m}`));
                } else {
                    console.log('\n✅ Estratégia já está otimizada!');
                }
                return;
            }
            
            console.log('\n❓ Comando não reconhecido. Digite "status" ou "relatorio"');
        } catch (error) {
            console.error(`\n❌ Erro: ${error.message}`);
        }
    }
}

// Iniciar
if (require.main === module) {
    new ExecutiveInterface();
}

module.exports = ExecutiveInterface;