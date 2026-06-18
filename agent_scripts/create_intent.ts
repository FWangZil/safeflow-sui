import 'dotenv/config';
import { ProducerApiClient } from '@safeflow/sui-sdk';

function getArg(name: string): string | undefined {
    const idx = process.argv.indexOf(name);
    if (idx === -1 || idx + 1 >= process.argv.length) {
        return undefined;
    }
    return process.argv[idx + 1];
}

async function main() {
    const producerBaseUrl = process.env.PRODUCER_API_BASE_URL ?? 'http://localhost:8787';
    const producerApiKey = process.env.PRODUCER_API_KEY;
    const agentAddress = getArg('--agent-address');
    const walletId = getArg('--wallet-id');
    const sessionCapId = getArg('--session-cap-id');
    const recipient = getArg('--recipient');
    const amountRaw = getArg('--amount-atomic') ?? getArg('--amount-mist') ?? '1000000';
    const coinType = getArg('--coin-type') ?? process.env.DEFAULT_COIN_TYPE;
    const executionRail = getArg('--execution-rail') ?? 'auto';
    const currencySymbol = getArg('--currency-symbol') ?? process.env.DEFAULT_CURRENCY_SYMBOL ?? 'USDC';
    const reason = getArg('--reason') ?? 'SafeFlow API payment intent';
    const merchantOrderId = getArg('--order-id') ?? `order_${Date.now()}`;
    const ttlSecRaw = getArg('--ttl-sec') ?? '600';

    if (executionRail !== 'auto' && executionRail !== 'sponsored_guard' && executionRail !== 'native_gasless') {
        throw new Error('--execution-rail must be auto, sponsored_guard, or native_gasless');
    }
    if (!agentAddress || !recipient) {
        throw new Error('Missing required args: --agent-address --recipient');
    }
    if (executionRail === 'sponsored_guard' && (!walletId || !sessionCapId)) {
        throw new Error('Missing required args for sponsored_guard: --wallet-id --session-cap-id');
    }

    const amountMist = Number.parseInt(amountRaw, 10);
    const ttlSec = Number.parseInt(ttlSecRaw, 10);
    if (!Number.isInteger(amountMist) || amountMist <= 0) {
        throw new Error(`Invalid --amount-mist: ${amountRaw}`);
    }
    if (!Number.isInteger(ttlSec) || ttlSec <= 0) {
        throw new Error(`Invalid --ttl-sec: ${ttlSecRaw}`);
    }

    const producer = new ProducerApiClient({
        baseUrl: producerBaseUrl,
        ...(producerApiKey ? { apiKey: producerApiKey } : {}),
        ...(process.env.PRODUCER_SIGNING_SECRET ? { signingSecret: process.env.PRODUCER_SIGNING_SECRET } : {}),
    });

    const intent = await producer.createIntent({
        merchantOrderId,
        agentAddress,
        ...(walletId ? { walletId } : {}),
        ...(sessionCapId ? { sessionCapId } : {}),
        recipient,
        amountAtomic: amountMist,
        amountMist,
        ...(coinType ? { coinType } : {}),
        executionRail,
        currency: currencySymbol,
        currencySymbol,
        reason,
        expiresAtMs: Date.now() + ttlSec * 1000,
        metadata: {
            source: 'agent_scripts/create_intent.ts',
        },
    });

    console.log(JSON.stringify({ intent }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
