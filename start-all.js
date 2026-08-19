// start-all.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

console.log('🚀 INICIANDO ECOSSISTEMA SUPRA TRADING BOT');
console.log('='.repeat(60));

// Verificar se os ficheiros necessários existem
const requiredFiles = [
    'index.js',
    'agent/autonomous.js',
    'dashboard-web/server.js'
];

let missingFiles = requiredFiles.filter(file => !fs.existsSync(file));
if (missingFiles.length > 0) {
    console.log('❌ Ficheiros em falta:');
    missingFiles.forEach(f => console.log(`  - ${f}`));
    console.log('\n⚠️ Por favor, verifique a estrutura do projeto.');
    process.exit(1);
}

// Configuração dos processos
const processes = [];

// 1. Bot de arbitragem
const botProcess = spawn('node', ['index.js'], {
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, FORCE_COLOR: 'true' }
});

// 2. Cérebro autónomo
const brainProcess = spawn('node', ['agent/autonomous.js'], {
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, FORCE_COLOR: 'true' }
});

// 3. Dashboard Web
const dashboardProcess = spawn('node', ['dashboard-web/server.js'], {
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, FORCE_COLOR: 'true' }
});

processes.push(botProcess, brainProcess, dashboardProcess);

// Função para prefixar logs
function prefixLog(process, data) {
    const prefix = {
        [botProcess.pid]: '[BOT]',
        [brainProcess.pid]: '[🧠 CÉREBRO]',
        [dashboardProcess.pid]: '[📊 DASHBOARD]'
    }[process.pid] || '[?]';
    
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
        console.log(`${prefix} ${line}`);
    });
}

// Redirecionar saídas
botProcess.stdout.on('data', (data) => prefixLog(botProcess, data));
brainProcess.stdout.on('data', (data) => prefixLog(brainProcess, data));
dashboardProcess.stdout.on('data', (data) => prefixLog(dashboardProcess, data));

// Redirecionar erros
botProcess.stderr.on('data', (data) => {
    console.error(`[BOT ERROR] ${data}`);
});
brainProcess.stderr.on('data', (data) => {
    console.error(`[🧠 ERROR] ${data}`);
});
dashboardProcess.stderr.on('data', (data) => {
    console.error(`[📊 ERROR] ${data}`);
});

// Mostrar informações de inicialização
console.log('\n✅ PROCESSOS INICIADOS:');
console.log(`  📊 Dashboard: http://localhost:3000`);
console.log(`  🤖 Bot: Ativo`);
console.log(`  🧠 Cérebro: Ativo`);
console.log('\n📝 Comandos disponíveis no terminal:');
console.log('  status  - Ver status de todos os processos');
console.log('  restart - Reiniciar todos os processos');
console.log('  kill    - Encerrar todos os processos');
console.log('  exit    - Sair (também encerra tudo)');
console.log('='.repeat(60) + '\n');

// Interface para comandos
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '⚡ COMANDO> '
});

rl.prompt();

rl.on('line', (input) => {
    const cmd = input.trim().toLowerCase();
    
    switch(cmd) {
        case 'status':
            console.log('\n📊 STATUS DOS PROCESSOS:');
            processes.forEach(p => {
                const name = {
                    [botProcess.pid]: 'BOT',
                    [brainProcess.pid]: 'CÉREBRO',
                    [dashboardProcess.pid]: 'DASHBOARD'
                }[p.pid] || '?';
                console.log(`  ${name}: PID ${p.pid} - ${p.killed ? '❌ MORTO' : '✅ ATIVO'}`);
            });
            console.log(`\n  Dashboard: http://localhost:3000\n`);
            break;
            
        case 'restart':
            console.log('🔄 Reiniciando todos os processos...');
            processes.forEach(p => {
                if (!p.killed) {
                    p.kill('SIGTERM');
                }
            });
            // Esperar e reiniciar
            setTimeout(() => {
                const newBot = spawn('node', ['index.js'], { stdio: 'pipe', shell: true });
                const newBrain = spawn('node', ['agent/autonomous.js'], { stdio: 'pipe', shell: true });
                const newDashboard = spawn('node', ['dashboard-web/server.js'], { stdio: 'pipe', shell: true });
                processes.splice(0, processes.length, newBot, newBrain, newDashboard);
                console.log('✅ Processos reiniciados!\n');
            }, 2000);
            break;
            
        case 'kill':
        case 'exit':
            console.log('\n🛑 Encerrando todos os processos...');
            processes.forEach(p => {
                if (!p.killed) {
                    p.kill('SIGTERM');
                }
            });
            console.log('✅ Todos os processos encerrados.');
            rl.close();
            process.exit(0);
            break;
            
        default:
            console.log('❓ Comando desconhecido. Use: status, restart, kill, exit');
            break;
    }
    rl.prompt();
});

// Lidar com fecho inesperado
process.on('SIGINT', () => {
    console.log('\n\n🛑 A receber SIGINT... Encerrando todos os processos.');
    processes.forEach(p => {
        if (!p.killed) {
            p.kill('SIGTERM');
        }
    });
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n🛑 A receber SIGTERM... Encerrando todos os processos.');
    processes.forEach(p => {
        if (!p.killed) {
            p.kill('SIGTERM');
        }
    });
    process.exit(0);
});

// Verificar se algum processo morreu
setInterval(() => {
    processes.forEach((p, index) => {
        if (p.killed) {
            const name = {
                [botProcess.pid]: 'BOT',
                [brainProcess.pid]: 'CÉREBRO',
                [dashboardProcess.pid]: 'DASHBOARD'
            }[p.pid] || '?';
            console.log(`⚠️ ${name} morreu! Reiniciando...`);
            
            // Reiniciar o processo
            const command = {
                'BOT': 'node index.js',
                'CÉREBRO': 'node agent/autonomous.js',
                'DASHBOARD': 'node dashboard-web/server.js'
            }[name];
            
            if (command) {
                const newProcess = spawn('node', command.split(' '), { 
                    stdio: 'pipe', 
                    shell: true,
                    env: { ...process.env, FORCE_COLOR: 'true' }
                });
                processes[index] = newProcess;
                console.log(`✅ ${name} reiniciado!`);
            }
        }
    });
}, 5000);

console.log('🔄 Monitorização de processos ativa.\n');