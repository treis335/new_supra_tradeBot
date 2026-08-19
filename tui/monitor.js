//monitor.js
const blessed = require('blessed');
const fs = require('fs');
const path = require('path');
const { getBestOpportunity, getOpps } = require('../loop/tick');
const { executeArbitrage } = require('../dexes/dexlyn/dexlynExecute');
const { fetchWalletBalance } = require('../utils/walletBalance');
const TxOverlay = require('./txOverlay');

function initScreen() {
  const screen = blessed.screen({
    smartCSR: true, title: 'Dexlyn Arb Bot v2.5.1',
    fullUnicode: true, forceUnicode: true,
  });
  screen.program.hideCursor();

  const headerBox = blessed.box({
    top: 0, left: 0, width: '55%', height: 7,
    tags: true, wrap: false,
  });

  const pricesBox = blessed.box({
    top: 7, left: 0, width: '55%', bottom: 2,
    tags: true, wrap: false,
    scrollable: true, alwaysScroll: true,
    scrollbar: { ch: '│', style: { fg: 'grey' } },
    mouse: true, keys: true,
    border: { type: 'line' },
    label: ' {bold}{grey-fg}MERCADO{/}{/} ',
    style: { border: { fg: 'grey' } },
  });

  const arbBox = blessed.box({
    top: 0, left: '55%', width: '45%', height: '60%',
    tags: true, wrap: false,
    scrollable: true, alwaysScroll: true,
    scrollbar: { ch: '│', style: { fg: 'cyan' } },
    mouse: true, keys: true,
    border: { type: 'line' },
    label: ' {bold}{cyan-fg}ARB DETECTOR{/}{/} ',
    style: { border: { fg: 'cyan' } },
  });

  const logBox = blessed.box({
    top: '60%', left: '55%', width: '45%', bottom: 2,
    tags: true, wrap: false,
    scrollable: true, alwaysScroll: true,
    scrollbar: { ch: '│', style: { fg: 'blue' } },
    mouse: true, keys: true,
    border: { type: 'line' },
    label: ' {bold}{blue-fg}LOG DE ARBS + ATIVIDADE{/}{/} ',
    style: { border: { fg: 'blue' } },
  });

  const footerBox = blessed.box({
    bottom: 0, left: 0, width: '100%', height: 2,
    tags: true, wrap: false,
  });

  screen.append(headerBox);
  screen.append(pricesBox);
  screen.append(arbBox);
  screen.append(logBox);
  screen.append(footerBox);

  const txOverlay = new TxOverlay(screen);
  let txInProgress = false;

  const scrollBoxes = [pricesBox, arbBox, logBox];
  let focusIdx = 1;
  let scrollPaused = false;

  function setFocus(idx) {
    focusIdx = idx;
    pricesBox.style.border.fg = idx === 0 ? 'white' : 'grey';
    arbBox.style.border.fg    = idx === 1 ? 'cyan'  : 'grey';
    logBox.style.border.fg    = idx === 2 ? 'blue'  : 'grey';
    scrollBoxes[idx].focus();
    screen.render();
  }
  setFocus(1);

  screen.key(['tab'], () => setFocus((focusIdx + 1) % 3));
  screen.key(['space'], () => {
    scrollPaused = !scrollPaused;
    const lbl = scrollPaused
      ? ' {bold}{cyan-fg}ARB DETECTOR{/}{/} {yellow-fg}[PAUSADO — SPACE retoma]{/} '
      : ' {bold}{cyan-fg}ARB DETECTOR{/}{/} ';
    arbBox.setLabel(lbl);
    screen.render();
  });

  screen.key(['up'],       () => { if (focusIdx>0) scrollPaused=true; scrollBoxes[focusIdx].scroll(-1);  screen.render(); });
  screen.key(['down'],     () => { if (focusIdx>0) scrollPaused=true; scrollBoxes[focusIdx].scroll(1);   screen.render(); });
  screen.key(['pageup'],   () => { if (focusIdx>0) scrollPaused=true; scrollBoxes[focusIdx].scroll(-10); screen.render(); });
  screen.key(['pagedown'], () => { if (focusIdx>0) scrollPaused=true; scrollBoxes[focusIdx].scroll(10);  screen.render(); });
  screen.key(['home'],     () => { scrollBoxes[focusIdx].scrollTo(0); screen.render(); });
  screen.key(['end'],      () => { scrollBoxes[focusIdx].scrollTo(scrollBoxes[focusIdx].getScrollHeight()); screen.render(); });

  pricesBox.on('wheeldown', () => { pricesBox.scroll(3);  screen.render(); });
  pricesBox.on('wheelup',   () => { pricesBox.scroll(-3); screen.render(); });
  arbBox.on('wheeldown',    () => { scrollPaused = true; arbBox.scroll(3);  screen.render(); });
  arbBox.on('wheelup',      () => { scrollPaused = true; arbBox.scroll(-3); screen.render(); });
  logBox.on('wheeldown',    () => { logBox.scroll(3);  screen.render(); });
  logBox.on('wheelup',      () => { logBox.scroll(-3); screen.render(); });

  pricesBox.on('click', () => setFocus(0));
  arbBox.on('click',    () => setFocus(1));
  logBox.on('click',    () => setFocus(2));

  // ── Snapshot do ARB DETECTOR (tecla 'c') ─────────────
  screen.key(['c'], () => {
    try {
      const raw = arbBox.getContent();
      const clean = blessed.stripTags(raw);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `arb_snapshot_${timestamp}.txt`;
      fs.writeFileSync(path.join(__dirname, '..', filename), clean, 'utf8');

      const currentFooter = footerBox.getContent().split('\n');
      currentFooter[currentFooter.length - 1] = `{green-fg}✅ Snapshot guardado: ${filename}{/}`;
      footerBox.setContent(currentFooter.join('\n'));
      screen.render();
    } catch (e) {
      footerBox.setContent('{red-fg}❌ Erro ao guardar snapshot. Ver permissões.{/}');
      screen.render();
    }
  });

  // ── Executar arbitragem manual (tecla 'e') ──────────
    screen.key(['e'], async () => {
    if (txInProgress) return;

    const opps = getOpps();
    if (!opps || opps.length === 0) {
      txOverlay.show();
      txOverlay.error('Nenhuma oportunidade disponível.');
      return;
    }

    txInProgress = true;
    txOverlay.show();
    txOverlay.log('{yellow-fg}⏳ A analisar oportunidades...{/}');

    let balances = {};
    try {
      balances = await fetchWalletBalance(process.env.SENDER_ADDRESS) || {};
    } catch (e) {
      txOverlay.error('Falha ao obter saldo.');
      txInProgress = false;
      return;
    }

    const gasReserveSUPRA = 0.05;
    const availableSUPRA = Math.max(0, (balances.SUPRA || 0) - gasReserveSUPRA);
    txOverlay.log(`{grey-fg}Saldo disponível: ${availableSUPRA.toFixed(2)} SUPRA{/}`);

    const viableOpps = opps.filter(opp => {
      const tokenIn = opp.cycle.path[0];
      if (tokenIn !== 'SUPRA') return false;
      return opp.optimalAmount <= availableSUPRA;
    });

    if (viableOpps.length === 0) {
      txOverlay.log(`{yellow-fg}Nenhuma oportunidade viável (saldo SUPRA: ${availableSUPRA.toFixed(2)}).{/}`);
      txOverlay.error('Sem fundos suficientes.');
      txInProgress = false;
      return;
    }

    txOverlay.log(`{grey-fg}Encontradas ${viableOpps.length} oportunidades viáveis.{/}`);
    let successCount = 0, failCount = 0;

    for (let i = 0; i < viableOpps.length; i++) {
      const opp = viableOpps[i];
      txOverlay.log('');
      txOverlay.log(`{bold}{cyan-fg}── Oportunidade ${i + 1}/${viableOpps.length} ──{/}`);
      txOverlay.log(`{grey-fg}Rota: ${opp.cycle.path.map(t => require('../config/config').CONFIG.tokens[t]?.symbol || t).join(' → ')}{/}`);
      txOverlay.log(`{grey-fg}Lucro: +${opp.result.profitPct.toFixed(3)}% (${opp.result.profitAbs.toFixed(3)} SUPRA){/}`);
      txOverlay.log(`{grey-fg}Montante: ${opp.optimalAmount.toFixed(2)} SUPRA{/}`);

      try {
        // Escolhe o executor baseado na composição da rota (mesma logica do auto-execute em loop/tick.js)
        const dexesInRoute = new Set(opp.cycle.edges.map(e => e.pair.dex));
        const onlySpikey = [...dexesInRoute].every(d => d === 'SPIKEY');
        const onlyDexlyn = [...dexesInRoute].every(d => d === 'DEXLYN' || d === 'DEXLYN_V3');
        const isCrossDex = [...dexesInRoute].every(d => d === 'DEXLYN' || d === 'SPIKEY') && dexesInRoute.size > 1;

        let res;
        if (onlySpikey) {
          const { executeSpikeySwap } = require('../dexes/spikey/spikeyExecute');
          res = await executeSpikeySwap(opp, (msg) => txOverlay.log(msg));
        } else if (onlyDexlyn) {
          const { executeArbitrage } = require('../dexes/dexlyn/dexlynExecute');
          res = await executeArbitrage(opp, (msg) => txOverlay.log(msg));
        } else if (isCrossDex) {
          txOverlay.log('{yellow-fg}⚠️ Rota cross-DEX: legs separadas, NAO atomico.{/}');
          const { executeCrossDexArbitrage } = require('../executor/crossDexExecute');
          res = await executeCrossDexArbitrage(opp, (msg) => txOverlay.log(msg));
        } else {
          txOverlay.log('{red-fg}❌ Combinação de DEXs não suportada nesta rota.{/}');
          res = null;
        }

        if (res && res.txHash) {
          successCount++;
          txOverlay.log(`{green-fg}✅ Sucesso! Tx: ${res.txHash.slice(0, 10)}...{/}`);
        } else {
          failCount++;
          txOverlay.log(`{red-fg}❌ Falhou.{/}`);
        }
      } catch (e) {
        failCount++;
        txOverlay.log(`{red-fg}❌ Erro: ${e.message}{/}`);
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    txOverlay.log('');
    txOverlay.log(`{bold}Resumo:{/} {green-fg}${successCount} sucessos{/}, {red-fg}${failCount} falhas{/}`);
    txOverlay.success('Execução concluída.');
    txInProgress = false;
  });

  // ── Ligar/Desligar modo automático (tecla 'a') ──────
  screen.key(['a'], () => {
    const cfg = require('../config/config').CONFIG.autoExecute;
    cfg.enabled = !cfg.enabled;
    const status = cfg.enabled ? '{green-fg}LIGADO{/}' : '{red-fg}DESLIGADO{/}';
    footerBox.setContent(`{grey-fg}─ Modo automático: ${status}{/}`);
    screen.render();
  });

  // Fechar overlay manualmente com ESC
  screen.key(['escape'], () => {
    txOverlay.hide();
    txInProgress = false;
  });

  screen.key(['C-c', 'q'], () => { screen.program.showCursor(); screen.destroy(); process.exit(0); });

  return { screen, headerBox, pricesBox, arbBox, logBox, footerBox, scrollPaused: () => scrollPaused, setScrollPaused: (v) => { scrollPaused = v; } };
}

module.exports = { initScreen };