// start-all.js
const { spawn } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const { startSupervisor } = require('./utils/botSupervisor');

console.log('🚀 INICIANDO ECOSSISTEMA SUPRA TRADING BOT');
console.log('='.repeat(60));

const requiredFiles = ['index.js', 'agent/autonomous.js', 'dashboard-web/server.js'];
const missingFiles = requiredFiles.filter(file => !fs.existsSync(file));
if (missingFiles.length > 0) {
    console.log('❌ Ficheiros em falta:');
    missingFiles.forEach(f => console.log(`  - ${f}`));
    console.log('\n⚠️ Por favor, verifique a estrutura do projeto.');
    process.exit(1);
}

// O bot de trading é gerido pelo supervisor (utils/botSupervisor.js), que
// tem deteção REAL de crash (evento 'exit', não polling de .killed -- esse
// era um bug real aqui: só detetava processos que este script tinha matado,
// nunca um crash de verdade) e sabe reverter automaticamente uma mudança
// aprovada se ela fizer o bot cair logo a seguir a um reinício.
startSupervisor((msg) => console.log(`[SUPERVISOR] ${msg}`));

// Cérebro autónomo e dashboard não mexem em dinheiro diretamente, por isso
// ficam com uma gestão mais simples aqui -- mas com a MESMA correção do bug
// (ouvir 'exit', não fazer polling de .killed).
function spawnManaged(name, command, args) {
    let proc = spawn(command, args, { stdio: 'pipe', shell: true, env: { ...process.env, FORCE_COLOR: 'true' } });
    const wire = (p) => {
        p.stdout.on('data', d => process.stdout.write(`[${name}] ${d}`));
        p.stderr.on('data', d => process.stderr.write(`[${name} ERROR] ${d}`));
        p.on('exit', (code, signal) => {
            if (signal === 'SIGTERM') return; // paragem intencional, não reiniciar sozinho
            console.log(`⚠️ ${name} terminou (código ${code}). A reiniciar em 3s...`);
            setTimeout(() => { const np = spawn(command, args, { stdio: 'pipe', shell: true, env: { ...process.env, FORCE_COLOR: 'true' } }); wire(np); handle.proc = np; }, 3000);
        });
    };
    wire(proc);
    const handle = { get proc() { return proc; }, set proc(p) { proc = p; }, kill: (sig) => handle.proc.kill(sig) };
    return handle;
}

const brainHandle = spawnManaged('🧠 CÉREBRO', 'node', ['agent/autonomous.js']);
const dashboardHandle = spawnManaged('📊 DASHBOARD', 'node', ['dashboard-web/server.js']);

console.log('\n✅ PROCESSOS INICIADOS:');
console.log('  📊 Dashboard: http://localhost:3000');
console.log('  🤖 Bot: gerido pelo supervisor (com rollback automático)');
console.log('  🧠 Cérebro: Ativo');
console.log('\n📝 Comandos disponíveis no terminal:');
console.log('  kill / exit - Encerrar todos os processos');
console.log('='.repeat(60) + '\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '⚡ COMANDO> ' });
rl.prompt();

rl.on('line', (input) => {
    const cmd = input.trim().toLowerCase();
    switch (cmd) {
        case 'kill':
        case 'exit':
            console.log('\n🛑 Encerrando todos os processos...');
            brainHandle.kill('SIGTERM');
            dashboardHandle.kill('SIGTERM');
            process.emit('SIGTERM');
            rl.close();
            process.exit(0);
            break;
        default:
            console.log('❓ Comando desconhecido. Use: kill, exit (o bot em si é gerido pelo supervisor -- reinícios pedem-se pelo dashboard).');
            break;
    }
    rl.prompt();
});

process.on('SIGINT', () => {
    console.log('\n\n🛑 A receber SIGINT... Encerrando todos os processos.');
    brainHandle.kill('SIGTERM');
    dashboardHandle.kill('SIGTERM');
    process.exit(0);
});

console.log('🔄 Monitorização de processos ativa (com deteção real de crash).\n');
