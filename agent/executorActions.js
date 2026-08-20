// agent/executorActions.js
//
// CORRIGIDO: a versao anterior escrevia parametros como "minProfit", "maxSlippage",
// "tradeSize" que NAO EXISTEM no config.js real (que usa minProfitPct, cooldownMs,
// etc dentro de autoExecute) -- e "aplicava ao config" fazia regex-replace direto
// no ficheiro .js fonte, o que e' fragil e podia corromper codigo. adicionarPool()
// tambem escrevia strings soltas num ficheiro que espera objetos {address,tokenA,tokenB},
// o que corrompia o spikeyPools.json.
//
// Agora: (1) usa os nomes de campo REAIS do config.js, (2) tudo passa a ser uma
// PROPOSTA em vez de aplicar directo -- fica pendente ate um humano aprovar no
// dashboard, (3) valores sao sempre validados/clamped a limites seguros antes
// de sequer chegar a proposta.

const { createProposal } = require('../intelligence/proposalQueue');

// Limites de seguranca -- os mesmos que o intelligence/deepseekAnalyst.js ja usa
// para o ajuste automatico periodico. Aqui reaplicam-se porque isto e um caminho
// diferente (accoes ad-hoc via comando/chat), nao o ciclo periodico.
const SAFE_BOUNDS = {
    minProfitPct: { min: 0.15, max: 1.5 },
    crossDexMinProfitPct: { min: 0.5, max: 3.0 },
    cooldownMs: { min: 800, max: 5000 },
    maxTradesPerTick: { min: 1, max: 6 },
};

function clamp(value, bounds) {
    return Math.max(bounds.min, Math.min(bounds.max, value));
}

class ExecutorActions {
    // Em vez de escrever directo ao config.js, cria uma PROPOSTA pendente.
    // Devolve a proposta criada -- nada foi alterado no bot ainda.
    proporAjusteParametros(sugestoes) {
        const actions = this.parseSuggestions(sugestoes);
        if (actions.length === 0) {
            return { proposed: false, reason: 'nao foi possivel extrair parametros validos do texto' };
        }

        const payload = {};
        const summary = [];
        for (const action of actions) {
            if (!SAFE_BOUNDS[action.type]) continue; // ignora campos que nao existem no config real
            const clamped = clamp(Number(action.value), SAFE_BOUNDS[action.type]);
            payload[action.type] = clamped;
            summary.push(`${action.type}: ${clamped}`);
        }

        if (Object.keys(payload).length === 0) {
            return { proposed: false, reason: 'nenhum dos parametros pedidos existe na config real (autoExecute)' };
        }

        const proposal = createProposal({
            type: 'config_change',
            title: `Ajuste de parâmetros: ${summary.join(', ')}`,
            description: `Sugestão original: "${sugestoes}"`,
            payload,
        });

        return { proposed: true, proposal };
    }

    // Extrai valores tipo "minProfitPct 0.3" ou "cooldownMs para 2000" do texto.
    // So reconhece os NOMES REAIS do config.js -- nao inventa campos.
    parseSuggestions(sugestoes) {
        const actions = [];
        const text = sugestoes;

        const patterns = {
            minProfitPct: /min\s*profit\s*(?:pct)?\s*(?:de|para)?\s*([\d.]+)/i,
            crossDexMinProfitPct: /cross\s*-?\s*dex\s*(?:min)?\s*profit\s*(?:de|para)?\s*([\d.]+)/i,
            cooldownMs: /cooldown\s*(?:ms)?\s*(?:de|para)?\s*([\d.]+)/i,
            maxTradesPerTick: /(?:max\s*trades?\s*per\s*tick|trades?\s*por\s*tick)\s*(?:de|para)?\s*([\d.]+)/i,
        };

        for (const [type, pattern] of Object.entries(patterns)) {
            const match = text.match(pattern);
            if (match) actions.push({ type, value: parseFloat(match[1]) });
        }

        return actions;
    }

    // Propor adicionar um pool novo -- tambem fica pendente de aprovacao, e
    // exige a estrutura correta (address/tokenA/tokenB), nao so um endereco solto.
    proporNovoPool({ address, tokenA, tokenB }) {
        if (!address || !address.startsWith('0x')) {
            return { proposed: false, reason: 'endereco invalido (tem de comecar por 0x)' };
        }
        if (!tokenA || !tokenB) {
            return { proposed: false, reason: 'faltam tokenA/tokenB -- nao adiciono um pool sem saber que tokens sao' };
        }

        const proposal = createProposal({
            type: 'new_pool',
            title: `Novo pool: ${tokenA}/${tokenB}`,
            description: `Endereço: ${address}`,
            payload: { address, tokenA, tokenB },
        });

        return { proposed: true, proposal };
    }

    // ─── Metodos de compatibilidade (nomes antigos usados por autonomousBrain.js
    // e executiveInterface.js) -- todos redirecionam para o fluxo de proposta,
    // NUNCA aplicam directo. Mantidos so para nao ter de reescrever cada chamada. ───

    async ajustarParametros(sugestoes) {
        const res = this.proporAjusteParametros(typeof sugestoes === 'string' ? sugestoes : JSON.stringify(sugestoes));
        return res.proposed
            ? [`📝 Proposta criada (pendente de aprovação no dashboard): ${res.proposal.title}`]
            : [`ℹ️ Nada proposto: ${res.reason}`];
    }

    async adicionarPool(enderecoOuObjeto) {
        const payload = typeof enderecoOuObjeto === 'string'
            ? { address: enderecoOuObjeto, tokenA: null, tokenB: null }
            : enderecoOuObjeto;
        const res = this.proporNovoPool(payload);
        return res.proposed
            ? { success: true, message: `📝 Proposta criada (pendente de aprovação): ${res.proposal.title}` }
            : { success: false, message: `ℹ️ ${res.reason}` };
    }

    async otimizarEstrategia(performanceData) {
        const melhorias = [];
        if (performanceData) {
            const profit = parseFloat(performanceData.profit) || 0;
            const successRate = parseFloat(performanceData.successRate) || 0;
            if (profit < 5 && profit > 0) {
                const res = this.proporAjusteParametros('minProfitPct reduzir ligeiramente, lucro esta baixo');
                if (res.proposed) melhorias.push(`📝 Proposta: reduzir minProfitPct (lucro baixo: ${profit}%)`);
            }
            if (successRate < 50 && successRate > 0) {
                melhorias.push(`⚠️ Taxa de sucesso baixa (${successRate}%) -- considera rever manualmente, nao proponho ajuste automatico de risco sem mais dados`);
            }
        }
        return melhorias;
    }

    getOptimizationReport() {
        const { listProposals } = require('../intelligence/proposalQueue');
        return {
            pendingProposals: listProposals({ statusFilter: 'pending' }),
            timestamp: new Date().toISOString(),
        };
    }

    get params() {
        // campo legado que agent/executiveInterface.js le diretamente -- devolve
        // os valores REAIS atuais do config, nao um ficheiro desligado
        const { CONFIG } = require('../config/config');
        return { ...CONFIG.autoExecute };
    }
}

module.exports = ExecutorActions;
