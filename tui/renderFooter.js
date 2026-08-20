// renderFooter.js
const { CONFIG } = require('../config/config');
const { getErrorCount } = require('../utils/logError');

let rpcHealthy = true;
function setRpcHealthy(val) { rpcHealthy = val; }

function renderFooter(opps, tickMs, boxes) {
    const { footerBox } = boxes;
    const best = opps[0];
    const bestStr = best
        ? `{bright-green-fg}▲ +${best.result.profitPct.toFixed(2)}% sc:${best.score}{/}`
        : '{grey-fg}sem arb{/}';
    const rpcIcon = rpcHealthy ? '{green-fg}🟢{/}' : '{red-fg}🔴{/}';
    const auto = CONFIG.autoExecute.enabled ? '{green-fg}AUTO{/}' : '{grey-fg}MAN{/}';
    const err = getErrorCount() > 0 ? `{red-fg}⚠${getErrorCount()}{/}` : '';

    footerBox.setContent(
        `{grey-fg}─{/} ${auto} ${bestStr} ${rpcIcon} t:${tickMs}ms ${err}\n` +
        `{grey-fg}tab: mudar painel · e: executar manual · a: auto on/off · c: guardar snapshot · q: sair{/}`
    );
}

module.exports = { renderFooter, setRpcHealthy };