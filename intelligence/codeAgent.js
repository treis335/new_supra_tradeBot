// intelligence/codeAgent.js
//
// Este é o agente que "programa a sério" -- pedes uma ideia (nova estratégia
// de deteção, um novo indicador, um helper), a DeepSeek escreve o módulo JS
// completo, passa por verificação de sintaxe + intelligence/codeSafetyScanner.js,
// e fica registado como proposta 'code_change'. NUNCA escreve o ficheiro no
// projeto real diretamente -- isso só acontece em proposalApplier.js, e só
// depois de aprovação humana no dashboard, com uma segunda verificação de
// segurança nesse momento (defesa em profundidade).
//
// Só pode criar ficheiros NOVOS dentro de pastas permitidas (ver ALLOWED_DIRS
// em proposalApplier.js) -- nunca pode pedir para sobrescrever config.js,
// executor/*, agent/agentCore.js, etc. Isso é reforçado no applier, não aqui,
// porque nunca confiamos só na palavra do gerador.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { CONFIG } = require('../config/config');
const { readRecentHistory } = require('./historyLogger');
const { addProposal } = require('./proposalQueue');
const { scanCode } = require('./codeSafetyScanner');
const { logError } = require('../utils/logError');

async function callDeepSeek(systemPrompt, userPrompt) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return null;

    const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.4,
        }),
    });

    if (!res.ok) throw new Error(`DeepSeek API respondeu ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    return content ? JSON.parse(content) : null;
}

const SYSTEM_PROMPT = `Es um agente de programação que trabalha DENTRO de um bot de arbitragem cripto real (Node.js, blockchain Supra, DEXs Dexlyn/Spikey), mas o teu código NUNCA corre automaticamente -- fica em revisão humana antes de entrar em produção.

A tua tarefa é escrever um módulo JavaScript novo, completo e autocontido, que:
- Exporta funções puras (recebe dados, devolve resultado) -- NUNCA lê/escreve ficheiros, NUNCA importa o executor de trades ou a wallet diretamente, NUNCA faz chamadas de rede para sítios não pedidos explicitamente.
- Serve para ANÁLISE ou DETEÇÃO (ex: um novo critério de scoring de oportunidades, um detetor de padrões, uma função de cálculo) -- não para executar ações.
- Tem comentários em português explicando o raciocínio.
- É código real, completo, sem "TODO" ou placeholders -- deve poder ser corrido e testado tal como está.

Responde APENAS em JSON com esta estrutura:
{
  "filename": "nome-descritivo.js (sem caminho, só o nome do ficheiro)",
  "targetDir": "strategies" ou "intelligence/generated",
  "explanation": "o que este módulo faz e porquê, em português, para um humano avaliar antes de aprovar",
  "code": "o código JS completo, como string"
}`;

async function generateComponent(userRequest, log = () => {}) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        return { skipped: true, reason: 'DEEPSEEK_API_KEY não configurada' };
    }

    // Dá contexto real de performance ao agente, para o código que escrever
    // ser informado por dados reais, não genérico.
    const events = readRecentHistory({ sinceHoursAgo: 48 });
    const trades = events.filter(e => e.type === 'trade_executed');
    const context = {
        totalTrades: trades.length,
        successRate: trades.length ? trades.filter(t => t.success).length / trades.length : null,
        currentConfig: CONFIG.autoExecute,
        pedidoDoUtilizador: userRequest,
    };

    let result;
    try {
        result = await callDeepSeek(SYSTEM_PROMPT, JSON.stringify(context, null, 2));
    } catch (e) {
        logError('codeAgent.callDeepSeek', e);
        return { error: e.message };
    }
    if (!result || !result.code || !result.filename) {
        return { skipped: true, reason: 'resposta vazia ou incompleta da DeepSeek' };
    }

    // 1. Verificação de sintaxe -- escreve para um ficheiro temporário e
    // corre `node --check`, nunca faz require() do código não confiável.
    const tmpFile = path.join(require('os').tmpdir(), `codeagent_${Date.now()}.js`);
    fs.writeFileSync(tmpFile, result.code);
    let syntaxOk = true, syntaxError = null;
    try {
        execSync(`node --check "${tmpFile}"`, { stdio: 'pipe' });
    } catch (e) {
        syntaxOk = false;
        syntaxError = e.stderr?.toString() || e.message;
    } finally {
        fs.unlinkSync(tmpFile);
    }

    if (!syntaxOk) {
        log(`{red-fg}🤖❌ Código gerado tem erro de sintaxe -- descartado, não chega a virar proposta.{/}`);
        return { rejected: true, reason: 'erro de sintaxe', syntaxError };
    }

    // 2. Scan de segurança -- ver intelligence/codeSafetyScanner.js
    const scan = scanCode(result.code);

    // Restringe a pasta de destino a uma allowlist -- mesmo que o modelo
    // sugira outra coisa, forçamos para dentro do que é seguro.
    const allowedDirs = ['strategies', 'intelligence/generated'];
    const targetDir = allowedDirs.includes(result.targetDir) ? result.targetDir : 'strategies';
    const safeFilename = path.basename(result.filename).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const targetPath = `${targetDir}/${safeFilename}`;

    const proposal = addProposal({
        type: 'code_change',
        summary: `Novo componente: ${targetPath} -- ${result.explanation?.slice(0, 150) || ''}`,
        payload: {
            targetPath,
            code: result.code,
            explanation: result.explanation,
            safetyScan: scan,
        },
        source: 'codeAgent.generateComponent',
    });

    if (!scan.safe) {
        log(`{yellow-fg}🤖⚠️ Componente "${safeFilename}" proposto, mas o scan de segurança encontrou bloqueios: ${scan.blocks.join('; ')}. Vai aparecer no dashboard marcado como inseguro -- não pode ser aprovado até seres tu a rever.{/}`);
    } else {
        log(`{cyan-fg}🤖✨ Novo componente proposto: ${targetPath} -- aguarda revisão no dashboard.{/}`);
    }

    return { proposal, scan };
}

module.exports = { generateComponent };
