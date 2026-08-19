const { CONFIG } = require('../../config/config');
const { logError } = require('../../utils/logError');
const callView = require('../../utils/callView');
const { SPIKEY_CONFIG } = require('./spikeyConfig');

const SPIKEY = '0x3045d27b5fada1e30897a741fb184e48ef0bff3717aea23918ebc1e5c7153083';

// Fallback para pools antigos sem decimalsA/decimalsB gravados no spikeyPools.json.
// Pools descobertos automaticamente (ver spikeyDiscovery.js) ja trazem as decimais
// corretas lidas diretamente do token on-chain, por isso este mapa deixa de ser
// necessario para eles.
const DECIMALS_FALLBACK = { SUPRA: 1e8, CASH: 1e8, SPIKE: 1e3 };
function getDecimals(sym) { return DECIMALS_FALLBACK[sym] || 1e6; }

const spikeyEngine = {
    async fetchPairState(poolAddress, tokenA, tokenB) {
        try {
            const [reserves, fee] = await Promise.all([
                callView(SPIKEY, 'amm_pair::get_reserves', [], [poolAddress]),
                callView(SPIKEY, 'amm_controller::get_swap_fee', [], []).catch(() => [25]),
            ]);

            if (!reserves || !Array.isArray(reserves) || reserves.length < 2) return null;
            const r0 = Number(reserves[0]), r1 = Number(reserves[1]);
            if (r0 === 0 && r1 === 0) return null;

            const feeBps = Number(Array.isArray(fee) ? fee[0] : fee);
            // Usa decimais gravadas no pool (descoberta automatica) se existirem, senao usa o fallback
            const pool = (SPIKEY_CONFIG.pools || []).find(p => p.address === poolAddress);
            const decA = pool?.decimalsA || getDecimals(tokenA);
            const decB = pool?.decimalsB || getDecimals(tokenB);

            const amountOut = this.getAmountOut(r0, r1, decA, feeBps, 10000);
            const priceAinB = amountOut / decB;

            const state = {
                dex: 'SPIKEY',
                tokenA, tokenB,
                curve: 'constant_product',
                pairAddress: poolAddress,
                reserveA: r0, reserveB: r1,
                fee: feeBps, feeScale: 10000,
                decA, decB,
                priceAinB: isNaN(priceAinB) ? 0 : priceAinB,
            };
            // _simulate usa as decimais corretas do pool (importante para tokens descobertos
            // automaticamente que nao estejam no DECIMALS_FALLBACK)
            state._simulate = (direction, amt) => this.simulateTrade(state, direction, amt);
            return state;
        } catch (e) {
            logError(`fetchSpikeyPair ${poolAddress}`, e);
            return null;
        }
    },

    getAmountOut(reserveIn, reserveOut, amountIn, fee, feeScale) {
        if (reserveIn <= 0 || reserveOut <= 0 || amountIn <= 0) return 0;
        const feeMul = BigInt(feeScale - fee);
        const afterFee = (BigInt(Math.floor(amountIn)) * feeMul) / BigInt(feeScale);
        if (afterFee <= 0n) return 0;
        return Number((afterFee * BigInt(Math.floor(reserveOut))) / (BigInt(Math.floor(reserveIn)) + afterFee));
    },

    simulateTrade(ps, direction, amountIn) {
        const decA = ps.decA || getDecimals(ps.tokenA);
        const decB = ps.decB || getDecimals(ps.tokenB);
        if (direction === 'AB') {
            const raw = this.getAmountOut(ps.reserveA, ps.reserveB, amountIn * decA, ps.fee, ps.feeScale);
            return raw / decB;
        } else {
            const raw = this.getAmountOut(ps.reserveB, ps.reserveA, amountIn * decB, ps.fee, ps.feeScale);
            return raw / decA;
        }
    },
};

module.exports = spikeyEngine;