// utils/statsWriter.js
const fs = require('fs');
const path = require('path');
const { readRecentHistory } = require('../intelligence/historyLogger');

const STATS_FILE = path.join(__dirname, '..', '.bot_stats.json');

function writeBotStats({ walletBalances, opps, tickMs, chainPulse }) {
  try {
    const trades = readRecentHistory({ sinceHoursAgo: 24 }).filter(
      (e) => e.type === 'trade_executed'
    );
    const successCount = trades.filter((t) => t.success).length;
    const totalProfitAbs = trades
      .filter((t) => t.success)
      .reduce((s, t) => s + (t.profitAbs || 0), 0);

    const stats = {
      running: true,
      updatedAt: Date.now(),
      balance:
        walletBalances?.SUPRA != null
          ? `${walletBalances.SUPRA.toFixed(2)} SUPRA`
          : 'indisponível',
      pairs: opps ? opps.length : 0,
      totalTrades: trades.length,
      profit: trades.length
        ? `${totalProfitAbs.toFixed(4)} SUPRA (24h)`
        : '0 SUPRA',
      successRate: trades.length
        ? `${((successCount / trades.length) * 100).toFixed(1)}%`
        : 'sem dados',
      opportunities: opps ? opps.length : 0,
      bestProfitPct: opps && opps[0] ? opps[0].result.profitPct : 0,
      tickMs,
      // ═══ Chain Pulse (só memória do bot → dashboard) ═══
      chainPulse: Array.isArray(chainPulse) ? chainPulse.slice(0, 20) : [],
    };
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (e) {
    try {
      require('../tui/systemLog').pushSystemLog(
        `{red-fg}⚠ statsWriter: falha ao gravar: ${e.message}{/}`
      );
    } catch {
      console.error('[statsWriter] falha ao gravar:', e.message);
    }
  }
}

module.exports = { writeBotStats, STATS_FILE };