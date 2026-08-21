// intelligence/historyLogger.js
//
// Ate agora, o log de atividade e oportunidades so existia em memoria (perdia-se
// ao reiniciar o bot, e tinha um limite pequeno). Para o analista DeepSeek poder
// aprender com dados reais, precisa de historico persistente. Isto grava cada
// evento relevante (trade detectada, oportunidade encontrada, trade executada)
// num ficheiro JSONL (uma linha = um evento em JSON), que cresce ao longo do tempo.

const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'history.jsonl');
const MAX_FILE_SIZE_MB = 50; // roda o ficheiro se crescer demasiado

function ensureDataDir() {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function rotateIfNeeded() {
    try {
        const stats = fs.statSync(HISTORY_FILE);
        if (stats.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
            const archivePath = HISTORY_FILE.replace('.jsonl', `_${Date.now()}.jsonl`);
            fs.renameSync(HISTORY_FILE, archivePath);
        }
    } catch (e) {
        // ficheiro ainda nao existe, nada a fazer
    }
}

function logEvent(type, data) {
    try {
        ensureDataDir();
        rotateIfNeeded();
        const line = JSON.stringify({ ts: Date.now(), type, ...data }) + '\n';
        fs.appendFileSync(HISTORY_FILE, line);
    } catch (e) {
        // nunca deixar um erro de logging derrubar o bot
        try { require('../tui/systemLog').pushSystemLog(`{red-fg}⚠ historyLogger: falha ao gravar: ${e.message}{/}`); }
        catch { console.error('[historyLogger] falha ao gravar:', e.message); }
    }
}

// Le os ultimos N eventos (ou todos os das ultimas X horas) para dar ao analista
function readRecentHistory({ maxEvents = 2000, sinceHoursAgo = 24 } = {}) {
    try {
        if (!fs.existsSync(HISTORY_FILE)) return [];
        const content = fs.readFileSync(HISTORY_FILE, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        const cutoff = Date.now() - sinceHoursAgo * 3600 * 1000;

        const events = [];
        for (let i = lines.length - 1; i >= 0 && events.length < maxEvents; i--) {
            try {
                const evt = JSON.parse(lines[i]);
                if (evt.ts < cutoff) break; // ficheiro esta em ordem cronologica, pode parar
                events.push(evt);
            } catch { /* linha corrompida, ignora */ }
        }
        return events.reverse();
    } catch (e) {
        try { require('../tui/systemLog').pushSystemLog(`{red-fg}⚠ historyLogger: falha ao ler: ${e.message}{/}`); }
        catch { console.error('[historyLogger] falha ao ler:', e.message); }
        return [];
    }
}

module.exports = { logEvent, readRecentHistory };
