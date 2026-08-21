// utils/botSupervisor.js
//
// Gere o processo do bot de trading (index.js) com deteção REAL de crash
// (evento 'exit', não polling de .killed -- esse era um bug real do
// start-all.js anterior: só detetava processos que ele próprio tinha
// matado, nunca um crash de verdade) e rollback automático.
//
// Fluxo de segurança quando uma proposta aprovada pede reinício:
//   1. proposalApplier.js grava em data/last_applied.json o que mudou e
//      como reverter, ANTES de pedir o reinício.
//   2. Este supervisor reinicia o bot.
//   3. Se o bot cair sozinho dentro da janela de segurança (30s) a seguir
//      a esse reinício -- reverte automaticamente a mudança (apaga o
//      ficheiro novo ou restaura a config anterior) e tenta reiniciar mais
//      uma vez com o estado revertido.
//   4. Se cair OUTRA VEZ mesmo depois do rollback, para de tentar sozinho
//      e escreve um estado claro para o dashboard mostrar -- nunca fica
//      preso num loop infinito de crashes com dinheiro real em jogo.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LAST_APPLIED_FILE = path.join(ROOT, 'data', 'last_applied.json');
const RESTART_REQUEST_FILE = path.join(ROOT, 'data', 'restart_request.json');
const SUPERVISOR_STATUS_FILE = path.join(ROOT, 'data', 'supervisor_status.json');

const CRASH_GRACE_MS = 30000;   // janela depois de um restart-por-proposta em que um crash conta como "causado pela mudança"
const RESTART_POLL_MS = 3000;   // frequência a que verificamos se o dashboard pediu um reinício

function writeStatus(status) {
    try {
        const dir = path.dirname(SUPERVISOR_STATUS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SUPERVISOR_STATUS_FILE, JSON.stringify({ ...status, updatedAt: Date.now() }, null, 2));
    } catch (e) {
        console.error('[botSupervisor] falha ao gravar estado:', e.message);
    }
}

function readLastApplied() {
    try {
        if (!fs.existsSync(LAST_APPLIED_FILE)) return null;
        return JSON.parse(fs.readFileSync(LAST_APPLIED_FILE, 'utf8'));
    } catch { return null; }
}

function clearRestartRequest() {
    try { if (fs.existsSync(RESTART_REQUEST_FILE)) fs.unlinkSync(RESTART_REQUEST_FILE); } catch {}
}

function performRollback(lastApplied, log) {
    if (!lastApplied || lastApplied.rolledBack) return false;
    try {
        const { rollbackToPreviousChampion } = require('../intelligence/proposalApplier');
        rollbackToPreviousChampion(lastApplied);
        lastApplied.rolledBack = true;
        lastApplied.rolledBackAt = Date.now();
        fs.writeFileSync(LAST_APPLIED_FILE, JSON.stringify(lastApplied, null, 2));
        log(`⏪ Rollback automático aplicado (proposta ${lastApplied.proposalId} causou crash).`);
        return true;
    } catch (e) {
        log(`❌ Rollback automático FALHOU: ${e.message} -- precisa de atenção humana.`);
        return false;
    }
}

function startSupervisor(log = console.log) {
    let botProcess = null;
    let lastRestartRequestedAt = null;
    let rollbackAttemptedThisCycle = false;

    function spawnBot() {
        // IMPORTANTE: stdio 'inherit' (nao 'pipe') para este processo especifico.
        // O index.js usa blessed (interface visual em modo terminal), que precisa
        // de acesso DIRETO a um terminal real (TTY) para desenhar corretamente --
        // caixas, cores, posicionamento do cursor, etc. Com 'pipe' (usado antes),
        // o stdout do processo filho deixa de ser um TTY (isTTY fica undefined),
        // e os bytes de controlo do blessed ainda por cima ficavam com um prefixo
        // "[BOT] " inserido a meio -- e' isto que causava o ecra corrompido/
        // caixas sobrepostas. 'inherit' liga o filho diretamente ao terminal real
        // que esta a correr o start-all.js, sem passar por um pipe intermedio.
        //
        // Contrapartida: perdemos o prefixo "[BOT] " e a captura de stdout/stderr
        // deste processo especifico (porque 'inherit' e 'pipe' sao mutuamente
        // exclusivos -- nao ha 'data' events com inherit). Os outros processos
        // (dashboard, agente autonomo) continuam com 'pipe', pois nao tem TUI e
        // beneficiam do prefixo para se distinguirem nos logs.
        botProcess = spawn('node', ['index.js'], {
            stdio: 'inherit',
            shell: true,
            env: { ...process.env, FORCE_COLOR: 'true' },
        });
        const startedAt = Date.now();

        botProcess.on('exit', (code, signal) => {
            const uptimeMs = Date.now() - startedAt;
            const wasRecentRestart = lastRestartRequestedAt && (Date.now() - lastRestartRequestedAt) < CRASH_GRACE_MS + 5000;
            log(`⚠️ Processo do bot terminou (código ${code}, sinal ${signal}) depois de ${(uptimeMs / 1000).toFixed(1)}s.`);

            if (signal === 'SIGTERM') {
                // Paragem intencional (nós próprios matámos para reiniciar) -- não é crash.
                writeStatus({ running: false, reason: 'paragem intencional para reinício' });
                return;
            }

            writeStatus({ running: false, reason: `crash (código ${code})`, uptimeMs });

            if (wasRecentRestart && uptimeMs < CRASH_GRACE_MS && !rollbackAttemptedThisCycle) {
                rollbackAttemptedThisCycle = true;
                log('🔴 Crash logo a seguir a uma mudança aprovada -- a tentar rollback automático.');
                const lastApplied = readLastApplied();
                const rolledBack = performRollback(lastApplied, log);
                writeStatus({ running: false, reason: rolledBack ? 'revertido automaticamente após crash' : 'crash + rollback falhou -- precisa de atenção humana', uptimeMs });
                if (rolledBack) {
                    setTimeout(() => { spawnBot(); }, 2000);
                    return;
                }
                // Rollback falhou -- não tentamos mais sozinhos, para não ficar em loop.
                return;
            }

            if (uptimeMs < CRASH_GRACE_MS) {
                // Crash sem mudança recente conhecida -- ainda assim tentamos
                // recuperar uma vez (falha transitória de rede, RPC, etc.),
                // mas sem rollback (não há nada para reverter).
                log('🔄 A tentar reiniciar automaticamente (crash sem mudança recente associada).');
                setTimeout(() => { spawnBot(); }, 3000);
            }
        });

        writeStatus({ running: true, pid: botProcess.pid });
    }

    spawnBot();

    // Verifica periodicamente se o dashboard pediu um reinício (ex: depois
    // de aprovar uma proposta que precisa disto para entrar em vigor).
    setInterval(() => {
        try {
            if (!fs.existsSync(RESTART_REQUEST_FILE)) return;
            const req = JSON.parse(fs.readFileSync(RESTART_REQUEST_FILE, 'utf8'));
            clearRestartRequest();
            rollbackAttemptedThisCycle = false;
            lastRestartRequestedAt = Date.now();
            log(`🔄 Reinício pedido (${req.reason || 'sem motivo indicado'}). A aplicar...`);
            if (botProcess && !botProcess.killed) botProcess.kill('SIGTERM');
            setTimeout(() => { spawnBot(); }, 1500);
        } catch (e) {
            console.error('[botSupervisor] erro a processar pedido de reinício:', e.message);
        }
    }, RESTART_POLL_MS);

    process.on('SIGINT', () => { if (botProcess) botProcess.kill('SIGTERM'); process.exit(0); });
    process.on('SIGTERM', () => { if (botProcess) botProcess.kill('SIGTERM'); process.exit(0); });
}

module.exports = { startSupervisor };
