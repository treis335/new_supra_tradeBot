// intelligence/agentCharter.js
//
// Carrega AGENT_CHARTER.md (na raiz do projeto) e prefixa-o a qualquer
// prompt de sistema de um agente de IA. Assim, mudar o charter muda o
// comportamento de todos os agentes de uma vez, sem editar cada ficheiro.

const fs = require('fs');
const path = require('path');

const CHARTER_PATH = path.join(__dirname, '..', 'AGENT_CHARTER.md');

let cached = null;
function loadCharter() {
    // Cache simples -- o charter não muda em runtime, só quando alguém
    // edita o ficheiro manualmente (e nesse caso reinicia o bot de qualquer forma).
    if (cached !== null) return cached;
    try {
        cached = fs.readFileSync(CHARTER_PATH, 'utf8');
    } catch (e) {
        console.error('[agentCharter] não consegui ler AGENT_CHARTER.md, a continuar sem ele:', e.message);
        cached = '';
    }
    return cached;
}

function withCharter(systemPrompt) {
    const charter = loadCharter();
    if (!charter) return systemPrompt;
    return `${charter}\n\n---\n\n${systemPrompt}`;
}

module.exports = { withCharter, loadCharter };
