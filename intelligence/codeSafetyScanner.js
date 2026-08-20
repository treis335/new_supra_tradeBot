// intelligence/codeSafetyScanner.js
//
// Antes de QUALQUER código escrito pela DeepSeek chegar a ser sequer mostrado
// como proposta -- e de novo, com mais rigor, no momento da aprovação -- passa
// por aqui. Isto é análise estática simples (regex sobre o texto do código),
// não é uma sandbox perfeita, mas combinado com "nunca aplica sem aprovação
// humana visível" dá uma rede de segurança real: mesmo que alguém aprove sem
// ler com atenção, padrões obviamente perigosos são bloqueados de qualquer forma.
//
// Duas categorias:
//   - BLOQUEIOS DUROS: nunca deixam aplicar a proposta, mesmo aprovada.
//   - AVISOS: aparecem destacados no dashboard para o humano decidir, mas
//     não impedem a aplicação sozinhos.

const HARD_BLOCK_PATTERNS = [
    { re: /\brequire\s*\(\s*['"]child_process['"]\s*\)/, reason: 'usa child_process (podia executar comandos no sistema)' },
    { re: /\beval\s*\(/, reason: 'usa eval()' },
    { re: /new\s+Function\s*\(/, reason: 'usa new Function() (equivalente a eval)' },
    { re: /require\s*\(\s*['"][^'"]*executor[^'"]*['"]\s*\)/i, reason: 'tenta importar módulo de execução de trades diretamente' },
    { re: /require\s*\(\s*['"][^'"]*wallet[^'"]*['"]\s*\)/i, reason: 'tenta importar módulo da wallet diretamente' },
    { re: /require\s*\(\s*['"][^'"]*supraClient[^'"]*['"]\s*\)/i, reason: 'tenta importar o cliente Supra diretamente (acesso à chain/wallet)' },
    { re: /process\.env\.(PRIVATE_KEY|MNEMONIC|SEED_PHRASE|WALLET_KEY)/i, reason: 'acede a variáveis de ambiente sensíveis (chave privada/seed)' },
    { re: /fs\.(writeFileSync|unlinkSync|rmSync|rmdirSync|appendFileSync)\s*\(/, reason: 'escreve/apaga ficheiros no disco' },
    { re: /\.exec\s*\(|\.execSync\s*\(|\.spawn\s*\(/, reason: 'tenta executar processos do sistema' },
    { re: /require\s*\(\s*['"]fs['"]\s*\)/, reason: 'importa o módulo fs (acesso a ficheiros não deve ser necessário num componente de estratégia)' },
];

const SOFT_WARN_PATTERNS = [
    { re: /require\s*\(\s*['"](axios|node-fetch)['"]\s*\)|fetch\s*\(/, reason: 'faz chamadas de rede -- confirma que o destino é de confiança' },
    { re: /require\s*\(\s*['"][^'"]*config[^'"]*['"]\s*\)/, reason: 'importa o config -- confirma que só LÊ, nunca escreve nele' },
    { re: /setInterval\s*\(|setTimeout\s*\(/, reason: 'agenda execução própria -- confirma que não corre sozinho fora do ciclo normal do bot' },
    { re: /module\.exports/, reason: null }, // informativo, não é aviso real -- ignorado abaixo
];

function scanCode(code) {
    const blocks = [];
    const warnings = [];

    for (const { re, reason } of HARD_BLOCK_PATTERNS) {
        if (re.test(code)) blocks.push(reason);
    }
    for (const { re, reason } of SOFT_WARN_PATTERNS) {
        if (reason && re.test(code)) warnings.push(reason);
    }

    return {
        safe: blocks.length === 0,
        blocks,
        warnings,
    };
}

module.exports = { scanCode };
