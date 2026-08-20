const { CONFIG } = require('../config/config');

const DEX_LABELS = {
  DEXLYN: 'DLyn',
  DEXLYN_V3: 'DLV3',
  SPIKEY: 'Spky',
};

function getDexLabel(dex) {
  return DEX_LABELS[dex] || (dex ? dex.substring(0, 4) : '???');
}

function scoreBar(score) {
  const filled = Math.round(score / 10);
  const color = score >= 70 ? 'bright-green' : score >= 40 ? 'yellow' : 'red';
  return `{${color}-fg}${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${score}{/}`;
}

function renderArb(opps, boxes) {
  const { arbBox } = boxes;
  const L = [];
  if (!opps.length) {
    L.push('{grey-fg}  Sem oportunidades acima de ' + CONFIG.minProfitPct + '%{/}');
  } else {
    let totalSupraProfit = 0;
    opps.forEach(({ cycle, result, optimalAmount, score, profitScore, liquidityScore, trendScore }, idx) => {
      const { profitPct, profitAbs, steps } = result;
      const symIn = CONFIG.tokens[cycle.path[0]]?.symbol || cycle.path[0];
      if (symIn === 'SUPRA') totalSupraProfit += profitAbs;

      const isHot = score >= 70, isWarm = score >= 40;
      const badge = isHot ? '{green-bg}{black-fg} 🔥 EXEC {/}' : isWarm ? '{yellow-fg} ◈ AVAL  {/}' : '{grey-fg} ○ FRACO {/}';
      const pc = isHot ? 'bright-green' : isWarm ? 'yellow' : 'grey';

      // Rota compacta (sempre mostrada)
      const pathParts = cycle.path.map((token, i) => {
        const sym = CONFIG.tokens[token]?.symbol || token;
        if (i === 0) return sym;
        const dexLabel = getDexLabel(cycle.edges[i - 1].pair.dex);
        return `[${dexLabel}]→${sym}`;
      });

      L.push(
        ` ${badge} {${pc}-fg}+${profitPct.toFixed(3)}%  +${profitAbs.toFixed(3)} ${symIn}{/}` +
        `  {grey-fg}${pathParts.join(' ')}{/}`
      );

      // Detalhe completo (score breakdown + passos) so na #1 -- as restantes
      // ficam so na linha compacta acima, para o painel nao ficar cheio de
      // repeticao quase identica quando ha varias oportunidades parecidas.
      if (idx === 0) {
        L.push(
          `  ${scoreBar(score)} {grey-fg}P:${(profitScore * 100).toFixed(0)}% L:${(liquidityScore * 100).toFixed(0)}% T:${(trendScore * 100).toFixed(0)}%{/}` +
          ` {grey-fg}opt:${optimalAmount.toFixed(0)} ${symIn}{/}`
        );
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          const fA = CONFIG.tokens[s.from]?.symbol || s.from;
          const fB = CONFIG.tokens[s.to]?.symbol || s.to;
          const dexLabel = getDexLabel(s.dex);
          const co = i === steps.length - 1 ? '└' : '├';
          L.push(
            `  {grey-fg}${co} ${fA} → ${fB} {/}[{magenta-fg}${dexLabel}{/}]` +
            `  {grey-fg}in:{/}{${pc}-fg}${s.amtIn.toFixed(6)}{/}` +
            `  {grey-fg}out:{/}{${pc}-fg}${s.amtOut.toFixed(6)}{/}`
          );
        }
        L.push('{grey-fg}  ' + '─'.repeat(38) + '{/}');
      }
    });
    if (totalSupraProfit > 0) {
      L.unshift(`{yellow-fg}{bold}  💰 Total estimado: ${totalSupraProfit.toFixed(3)} SUPRA{/} {grey-fg}(${opps.length} oportunidades, detalhe completo so na #1){/}`, '');
    }
  }
  arbBox.setContent(L.join('\n'));
  if (!boxes.scrollPaused()) arbBox.scrollTo(0);
}

module.exports = renderArb;