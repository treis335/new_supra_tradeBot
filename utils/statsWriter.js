// utils/statsWriter.js
//
// O dashboard-web corre num processo separado do bot (ver start-all.js) --
// não consegue chamar getOpps()/getBestOpportunity() diretamente. A única
// forma honesta de o dashboard mostrar dados reais é o bot escrever o seu
// estado real para um ficheiro, periodicamente, e o dashboard ler ESSE
// ficheiro (com verificação de "há quanto tempo foi escrito" para saber se
// o bot ainda está mesmo vivo). Antes disto, nada escrevia este ficheiro --
// o dashboard mostrava números inventados por Math.random().

const fs = require('fs');
const path = require('path');
const { readRecentHistory } = require('../intelligence/historyLogger');

const STATS_FILE = path.join(__dirname, '..', '.bot_stats.json');

function writeBotStats({ walletBalances, opps, tickMs }) {
    try {
        const trades = readRecentHistory({ sinceHoursAgo: 24 }).filter(e => e.type === 'trade_executed');
        const successCount = trades.filter(t => t.success).length;
        const totalProfitAbs = trades.filter(t => t.success).reduce((s, t) => s + (t.profitAbs || 0), 0);

        const stats = {
            running: true,
            updatedAt: Date.now(),
            balance: walletBalances?.SUPRA != null ? `${walletBalances.SUPRA.toFixed(2)} SUPRA` : 'indisponível',
            pairs: opps ? opps.length : 0,
            totalTrades: trades.length,
            profit: trades.length ? `${totalProfitAbs.toFixed(4)} SUPRA (24h)` : '0 SUPRA',
            successRate: trades.length ? `${((successCount / trades.length) * 100).toFixed(1)}%` : 'sem dados',
            opportunities: opps ? opps.length : 0,
            bestProfitPct: opps && opps[0] ? opps[0].result.profitPct : 0,
            tickMs,
        };
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    } catch (e) {
        // Nunca deixar a escrita de stats derrubar o tick principal.
        try { require('../tui/systemLog').pushSystemLog(`{red-fg}⚠ statsWriter: falha ao gravar: ${e.message}{/}`); }
        catch { console.error('[statsWriter] falha ao gravar:', e.message); }
    }
}

module.exports = { writeBotStats, STATS_FILE };
