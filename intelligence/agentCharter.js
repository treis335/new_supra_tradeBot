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
    const brief = loadStrategicBriefSection();
    const parts = [charter, brief, systemPrompt].filter(Boolean);
    return parts.join('\n\n---\n\n');
}

// O briefing do Estratega (intelligence/strategist.js) é dinâmico -- muda a
// cada ciclo, ao contrário do charter fixo. Só é incluído se existir e não
// for demasiado antigo (>48h -- prioridades muito velhas podem já não fazer
// sentido, melhor omitir do que confundir com dados desatualizados).
const BRIEF_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function loadStrategicBriefSection() {
    try {
        const briefPath = path.join(__dirname, '..', 'data', 'strategic_brief.json');
        if (!fs.existsSync(briefPath)) return '';
        const brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
        if (!brief.generatedAt || (Date.now() - brief.generatedAt) > BRIEF_MAX_AGE_MS) return '';

        const prioridades = (brief.prioridades || [])
            .map(p => `- ${p.foco} (para: ${p.paraQuem}) -- ${p.porque}`)
            .join('\n');
        if (!prioridades) return '';

        return `## Prioridades atuais definidas pelo Estratega da equipa\n\n${brief.resumo}\n\n${prioridades}\n\nUsa isto para focar o teu raciocínio, mas não ignores dados novos que contradigam uma prioridade desatualizada.`;
    } catch {
        return '';
    }
}

module.exports = { withCharter, loadCharter };
