// start-all.js
//
// CORRIGIDO: este script partilhava o mesmo terminal entre o bot (que usa
// blessed, uma interface visual em modo terminal) e os outros processos
// (dashboard, agente), escrevendo tudo com prefixos ("[BOT] ", "[CÉREBRO] ")
// na mesma janela. Isto corrompe SEMPRE o ecrã do blessed -- qualquer texto
// escrito por outro processo no mesmo terminal onde o blessed tem controlo
// exclusivo do ecrã intervala-se com os bytes de desenho dele, resultando
// em caixas sobrepostas e texto ilegivel (exatamente o que foi reportado).
//
// Havia ainda um segundo problema: o prompt interativo (readline) deste
// script escuta o stdin do terminal -- mas o bot (blessed) TAMBEM precisa
// de escutar o stdin diretamente para as teclas (tab/e/a/q). Os dois a
// competir pelo mesmo stdin ao mesmo tempo e um conflito garantido.
//
// SOLUÇÃO: o bot (index.js) fica com acesso EXCLUSIVO ao terminal (stdio
// 'inherit', dado pelo botSupervisor.js). Os outros processos (dashboard,
// cérebro) escrevem os logs deles para FICHEIROS em vez do terminal --
// consulta-os com `tail -f data/dashboard.log` ou `tail -f data/brain.log`
// numa aba/janela separada, se quiseres ver o que estao a fazer.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startSupervisor } = require('./utils/botSupervisor');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const requiredFiles = ['index.js', 'agent/autonomous.js', 'dashboard-web/server.js'];
const missingFiles = requiredFiles.filter(file => !fs.existsSync(file));
if (missingFiles.length > 0) {
    console.log('❌ Ficheiros em falta:');
    missingFiles.forEach(f => console.log(`  - ${f}`));
    console.log('\n⚠️ Por favor, verifique a estrutura do projeto.');
    process.exit(1);
}

console.log('🚀 A iniciar ecossistema Supra Trading Bot...');
console.log('  📊 Dashboard: http://localhost:3000  (logs em data/dashboard.log)');
console.log('  🧠 Cérebro autónomo: a correr em segundo plano (logs em data/brain.log)');
console.log('  🤖 Bot: vai tomar conta deste terminal a seguir (interface visual)');
console.log('\nPara parar tudo: Ctrl+C neste terminal.');
console.log('='.repeat(60) + '\n');

// Cérebro e dashboard escrevem para ficheiro, NUNCA para este terminal --
// partilhar o terminal com o bot (blessed) corrompe sempre o ecrã dele.
function spawnManagedToFile(name, logFileName, command, args) {
    const logPath = path.join(DATA_DIR, logFileName);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    let proc = null;

    const wire = (p) => {
        p.stdout.pipe(logStream, { end: false });
        p.stderr.pipe(logStream, { end: false });
        p.on('exit', (code, signal) => {
            if (signal === 'SIGTERM') return; // paragem intencional
            logStream.write(`\n[${name}] terminou (código ${code}). A reiniciar em 3s...\n`);
            setTimeout(() => { proc = spawn(command, args, { stdio: 'pipe', shell: true, env: { ...process.env, FORCE_COLOR: 'false' } }); wire(proc); handle.proc = proc; }, 3000);
        });
    };

    proc = spawn(command, args, { stdio: 'pipe', shell: true, env: { ...process.env, FORCE_COLOR: 'false' } });
    wire(proc);
    const handle = { get proc() { return proc; }, set proc(p) { proc = p; }, kill: (sig) => handle.proc.kill(sig) };
    return handle;
}

const brainHandle = spawnManagedToFile('CÉREBRO', 'brain.log', 'node', ['agent/autonomous.js']);
const dashboardHandle = spawnManagedToFile('DASHBOARD', 'dashboard.log', 'node', ['dashboard-web/server.js']);

// O bot (index.js) é gerido pelo supervisor, com acesso EXCLUSIVO e DIRETO
// ao terminal (stdio 'inherit') -- é o único que pode desenhar o ecrã.
// Sem prompt interativo aqui: o stdin agora pertence ao bot (blessed),
// para as teclas (tab/e/a/q) funcionarem. Para parar tudo, usa Ctrl+C.
startSupervisor((msg) => {
    fs.appendFileSync(path.join(DATA_DIR, 'supervisor.log'), `${new Date().toISOString()} ${msg}\n`);
});

function shutdownAll() {
    brainHandle.kill('SIGTERM');
    dashboardHandle.kill('SIGTERM');
    process.exit(0);
}
process.on('SIGINT', shutdownAll);
process.on('SIGTERM', shutdownAll);
