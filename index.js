// index.js — CORRIGIDO
// CORREÇÃO: getSupraClient() estava comentado → SDK nunca inicializava
// → walletBalance falhava silenciosamente
// SOLUÇÃO: inicializa com timeout; se falhar, continua sem SDK (graceful degradation)

require('dotenv').config();
const { initScreen }     = require('./tui/monitor');
const { tick }           = require('./loop/tick');
const { CONFIG }         = require('./config/config');
const { logError }       = require('./utils/logError');
const { getSupraClient } = require('./utils/supraClient');

(async () => {
  process.on('uncaughtException',  (err)    => logError('uncaughtException', err));
  process.on('unhandledRejection', (reason) => logError('unhandledRejection', reason));

  // Inicialização do SDK com timeout de 10s — não bloqueia o bot se falhar
  try {
    const initPromise = getSupraClient();
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('SDK init timeout')), 10000)
    );
    await Promise.race([initPromise, timeout]);
    console.log('✅ Cliente Supra pronto.');
  } catch (e) {
    logError('SupraClient init', e);
    console.warn('⚠️  Cliente Supra indisponível — walletBalance usará REST como fallback.');
  }

  const boxes = initScreen();

  function shutdown() {
    try { boxes.screen.program.showCursor(); boxes.screen.destroy(); } catch {}
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  try {
    boxes.pricesBox.setContent('{grey-fg}  ◈ Dexlyn Arb Bot v2.5.1 — a inicializar...{/}');
    boxes.screen.render();
    await tick(boxes);
  } catch (e) {
    logError('tick inicial', e);
  }

  // Tick recursivo — evita sobreposição de ciclos
  let running = false;
  async function scheduleTick() {
    if (running) return;
    running = true;
    try   { await tick(boxes); }
    catch (e) { logError('tick interval', e); }
    running = false;
    setTimeout(scheduleTick, CONFIG.pollingMs);
  }
  setTimeout(scheduleTick, CONFIG.pollingMs);
})();