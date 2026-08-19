// executor/crossDexExecute.js
//
// Executa ciclos de arbitragem que atravessam MAIS QUE UMA DEX (ex: compra na Dexlyn,
// vende na Spikey). Ao contrario do executeArbitrage (Dexlyn puro), isto NAO e atomico:
// cada leg e uma transacao separada, submetida uma a seguir a outra.
//
// RISCO REAL: entre a confirmacao da leg 1 e o envio da leg 2, o preco pode mover-se
// (outra trade acontecer entretanto). Se isso consumir todo o lucro esperado, a leg 2
// ainda assim executa (porque respeita o minOut calculado no momento da deteccao,
// nao no momento da execucao) -- na pratica podes acabar com menos lucro do que o
// detectado, ou no pior caso um pequeno prejuizo depois de gas.
//
// Nao ha ainda um contrato Move atomico multi-DEX. Construir um seria a forma
// verdadeiramente segura de fazer isto, mas exige escrever, testar e publicar
// Move code novo -- um projeto a parte.

const { SupraClient, HexString, SupraAccount, BCS, TxnBuilderTypes } = require('supra-l1-sdk');
const { CONFIG } = require('../config/config');
const { logError } = require('../utils/logError');
const { SPIKEY_CONFIG } = require('../dexes/spikey/spikeyConfig');

async function executeDexlynLeg(client, account, sender, sequenceNumber, step) {
    const dex = CONFIG.dexes.DEXLYN;
    const tokenIn = CONFIG.tokens[step.from];
    const tokenOut = CONFIG.tokens[step.to];
    const curveType = dex.curveTypes[step.pair.curve];

    const typeArgs = [tokenIn.type, tokenOut.type, `${dex.moduleAddress}::${curveType}`];
    const amountIn = BigInt(Math.floor(step.amtIn * tokenIn.decimals));
    const minOut = BigInt(Math.floor(step.amtOut * tokenOut.decimals * 0.995));

    const rawTx = await client.createRawTxObject(
        new HexString(sender), sequenceNumber,
        dex.moduleAddress, 'scripts', 'swap',
        typeArgs.map(ta => new TxnBuilderTypes.TypeTagParser(ta).parseTypeTag()),
        [BCS.bcsSerializeUint64(amountIn), BCS.bcsSerializeUint64(minOut)],
        { maxGasAmount: BigInt(5000), gasUnitPrice: BigInt(100000), expirationTime: Math.floor(Date.now() / 1000) + 300 }
    );

    const serializer = new BCS.Serializer();
    rawTx.serialize(serializer);
    return client.sendTxUsingSerializedRawTransaction(account, serializer.getBytes(), {
        enableWaitForTransaction: true, enableTransactionSimulation: true,
    });
}

async function executeSpikeyLeg(client, account, sender, sequenceNumber, step) {
    const tokenIn = CONFIG.tokens[step.from];
    const tokenOut = CONFIG.tokens[step.to];
    const poolAddress = step.pair.pairAddress || step.pair.address;

    const amountIn = BigInt(Math.floor(step.amtIn * tokenIn.decimals));
    const minOut = BigInt(Math.floor(step.amtOut * tokenOut.decimals * 0.995));

    const functionArgs = [
        BCS.bcsSerializeUint64(amountIn),
        BCS.bcsSerializeUint64(minOut),
        [poolAddress.startsWith('0x') ? poolAddress.slice(2) : poolAddress],
        sender,
        Math.floor(Date.now() / 1000) + 300,
    ];
    const functionTypeArgs = [
        new TxnBuilderTypes.TypeTagParser(tokenIn.type).parseTypeTag(),
        new TxnBuilderTypes.TypeTagParser(tokenOut.type).parseTypeTag(),
    ];

    const rawTx = await client.createRawTxObject(
        new HexString(sender), sequenceNumber,
        SPIKEY_CONFIG.routerAddress, SPIKEY_CONFIG.moduleName, 'swap_exact_coins_for_coins_beta',
        functionTypeArgs, functionArgs,
        { maxGasAmount: BigInt(5000), gasUnitPrice: BigInt(100000), expirationTime: Math.floor(Date.now() / 1000) + 300 }
    );

    const serializer = new BCS.Serializer();
    rawTx.serialize(serializer);
    return client.sendTxUsingSerializedRawTransaction(account, serializer.getBytes(), {
        enableWaitForTransaction: true, enableTransactionSimulation: true,
    });
}

async function executeCrossDexArbitrage(opportunity, onLog = () => {}) {
    const originalLog = console.log;
    try {
        console.log = () => {};

        const client = await SupraClient.init(CONFIG.rpc);
        const privateKeyHex = process.env.PRIVATE_KEY.startsWith('0x') ? process.env.PRIVATE_KEY : '0x' + process.env.PRIVATE_KEY;
        const account = new SupraAccount(HexString.ensure(privateKeyHex).toUint8Array());
        const sender = process.env.SENDER_ADDRESS.startsWith('0x') ? process.env.SENDER_ADDRESS : '0x' + process.env.SENDER_ADDRESS;

        const { steps } = opportunity.result;
        let lastTxHash = null;

        for (const [i, step] of steps.entries()) {
            onLog(`{grey-fg}Leg ${i + 1}/${steps.length} [${step.dex}]: a obter sequence number...{/}`);
            const accountInfo = await client.getAccountInfo(new HexString(sender));
            const sequenceNumber = BigInt(accountInfo.sequence_number);

            onLog(`{yellow-fg}Leg ${i + 1}/${steps.length} [${step.dex}]: a submeter...{/}`);

            let txResult;
            if (step.dex === 'DEXLYN') {
                txResult = await executeDexlynLeg(client, account, sender, sequenceNumber, step);
            } else if (step.dex === 'SPIKEY') {
                txResult = await executeSpikeyLeg(client, account, sender, sequenceNumber, step);
            } else {
                onLog(`{red-fg}❌ DEX '${step.dex}' nao suportado no executor cross-dex (so DEXLYN e SPIKEY).{/}`);
                return null;
            }

            lastTxHash = txResult.txHash;
            onLog(`{green-fg}✅ Leg ${i + 1}/${steps.length} confirmada: ${txResult.txHash.slice(0, 10)}...{/}`);
        }

        onLog('{green-fg}✅ Ciclo cross-DEX completo!{/}');
        return { txHash: lastTxHash, success: true };
    } catch (err) {
        logError('executeCrossDexArbitrage', err);
        onLog(`{red-fg}❌ Erro cross-DEX: ${err.message}{/}`);
        return null;
    } finally {
        console.log = originalLog;
    }
}

module.exports = { executeCrossDexArbitrage };
