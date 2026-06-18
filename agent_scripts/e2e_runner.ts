import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    ProducerApiClient,
    SafeFlowAgent,
    type PaymentIntent,
} from '@safeflow/sui-sdk';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getArg(name: string): string | undefined {
    const idx = process.argv.indexOf(name);
    if (idx === -1 || idx + 1 >= process.argv.length) {
        return undefined;
    }
    return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
    return process.argv.includes(name);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadAgentSecret(): string | Uint8Array {
    const keyFile = path.join(__dirname, '.agent_key.json');
    const raw = JSON.parse(fs.readFileSync(keyFile, 'utf-8')) as { secretKey?: unknown };
    const secret = raw.secretKey;

    if (typeof secret === 'string') {
        return secret;
    }
    if (Array.isArray(secret)) {
        if (secret.length === 0) {
            throw new Error('.agent_key.json has empty secretKey array.');
        }
        if (typeof secret[0] === 'string') {
            return secret.join('');
        }
        return Uint8Array.from(secret as number[]);
    }
    throw new Error('Unsupported secretKey format in .agent_key.json');
}

function getAllowedRecipients(): Set<string> | null {
    const raw = process.env.SAFEFLOW_ALLOWED_RECIPIENTS;
    if (!raw) {
        return null;
    }
    const items = raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    return new Set(items);
}

function classifyErrorCode(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('EExceedsRateLimit') || message.includes('MoveAbort') || message.includes('rate limit')) {
        return 'rate_limit';
    }
    if (message.includes('InsufficientBalance') || message.includes('ENotOwner') || message.includes('EInsufficientBalance')) {
        return 'insufficient_balance';
    }
    if (message.includes('expired') || message.includes('ESessionExpired')) {
        return 'expired';
    }
    if (message.includes('signature')) {
        return 'signature_invalid';
    }
    return 'execution_failed';
}

function isIntentExpired(intent: PaymentIntent): boolean {
    return Date.now() > intent.expiresAtMs;
}

async function main() {
    const packageId = process.env.PACKAGE_ID;
    if (!packageId) {
        throw new Error('Missing PACKAGE_ID in environment.');
    }

    const producerBaseUrl = process.env.PRODUCER_API_BASE_URL ?? 'http://localhost:8787';
    const producerApiKey = process.env.PRODUCER_API_KEY;
    const signingSecret = process.env.PRODUCER_SIGNING_SECRET;
    if (!signingSecret) {
        throw new Error('Missing PRODUCER_SIGNING_SECRET in environment.');
    }

    const pollMs = Number.parseInt(getArg('--poll-ms') ?? process.env.SAFEFLOW_POLL_MS ?? '5000', 10);
    const once = hasFlag('--once');
    const maxLoops = Number.parseInt(getArg('--max-loops') ?? process.env.SAFEFLOW_MAX_LOOPS ?? '0', 10);
    const maxAmountMist = Number.parseInt(process.env.SAFEFLOW_MAX_AMOUNT_MIST ?? '0', 10);
    const maxAmountAtomic = Number.parseInt(process.env.SAFEFLOW_MAX_AMOUNT_ATOMIC ?? `${maxAmountMist}`, 10);
    const allowedRecipients = getAllowedRecipients();

    const agent = new SafeFlowAgent({
        network: 'testnet',
        packageId,
        secretKey: loadAgentSecret(),
        ...(process.env.DEFAULT_COIN_TYPE ? { coinType: process.env.DEFAULT_COIN_TYPE } : {}),
    });

    const producer = new ProducerApiClient({
        baseUrl: producerBaseUrl,
        ...(producerApiKey ? { apiKey: producerApiKey } : {}),
        signingSecret,
    });

    const agentAddress = agent.getAddress();
    console.log(
        JSON.stringify(
            {
                agentAddress,
                producerBaseUrl,
                pollMs,
                once,
                maxLoops,
            },
            null,
            2,
        ),
    );

    let loops = 0;
    while (true) {
        loops += 1;
        if (maxLoops > 0 && loops > maxLoops) {
            console.log(`Reached max loops (${maxLoops}), exiting.`);
            return;
        }

        const intent = await producer.fetchNextIntent(agentAddress);
        if (!intent) {
            if (once) {
                console.log('No pending intent found, exiting (--once).');
                return;
            }
            await sleep(pollMs);
            continue;
        }

        console.log(`[runner] fetched intent ${intent.intentId} (${intent.merchantOrderId})`);

        try {
            const signatureOk = await producer.verifyIntentSignature(intent);
            if (!signatureOk) {
                throw new Error('Intent signature verification failed.');
            }

            if (isIntentExpired(intent)) {
                await producer.reportIntentResult(intent.intentId, {
                    agentAddress,
                    success: false,
                    errorCode: 'expired',
                    errorMessage: 'Intent is expired before execution.',
                });
                console.log(`[runner] intent expired before ack: ${intent.intentId}`);
                if (once) {
                    return;
                }
                await sleep(pollMs);
                continue;
            }

            if (allowedRecipients && !allowedRecipients.has(intent.recipient)) {
                throw new Error(`Recipient ${intent.recipient} is not in SAFEFLOW_ALLOWED_RECIPIENTS`);
            }
            const amountAtomic = intent.amountAtomic ?? intent.amountMist;
            if (maxAmountAtomic > 0 && amountAtomic > maxAmountAtomic) {
                throw new Error(`Amount ${amountAtomic} exceeds SAFEFLOW_MAX_AMOUNT_ATOMIC=${maxAmountAtomic}`);
            }

            await producer.ackIntent(intent.intentId, agentAddress, randomUUID());

            const evidence = await agent.preparePaymentEvidence({
                walletId: intent.walletId,
                sessionCapId: intent.sessionCapId,
                recipient: intent.recipient,
                amountAtomic,
                coinType: intent.coinType,
                currencySymbol: intent.currencySymbol,
                mode: 'intent-runner',
                reasoning: intent.reason,
                context: {
                    intentId: intent.intentId,
                    merchantOrderId: intent.merchantOrderId,
                    metadata: intent.metadata ?? null,
                },
                walrusConfig: {
                    ...(process.env.WALRUS_PUBLISHER_URL ? { publisherUrl: process.env.WALRUS_PUBLISHER_URL } : {}),
                    ...(process.env.WALRUS_AGGREGATOR_URL ? { aggregatorUrl: process.env.WALRUS_AGGREGATOR_URL } : {}),
                    epochs: Number.parseInt(process.env.WALRUS_EPOCHS ?? '5', 10),
                },
                degradeOnUploadFailure: (process.env.WALRUS_DEGRADE_ON_UPLOAD_FAILURE ?? 'true').toLowerCase() !== 'false',
            });

            const result: {
                digest: string;
                sponsorFeeAtomic?: number;
                sponsorFeeRecipient?: string | null;
            } = intent.executionRail === 'native_gasless'
                ? await executeNativeGaslessPayment(agent, intent, amountAtomic)
                : await executeSponsoredGuardPayment(producer, agent, intent.intentId, agentAddress, evidence.walrusBlobId);

            await producer.reportIntentResult(intent.intentId, {
                agentAddress,
                success: true,
                txDigest: result.digest,
                walrusBlobId: evidence.walrusBlobId,
            });

            console.log(
                JSON.stringify(
                    {
                        intentId: intent.intentId,
                        status: 'executed',
                        executionRail: intent.executionRail,
                        txDigest: result.digest,
                        sponsorFeeAtomic: result.sponsorFeeAtomic,
                        sponsorFeeRecipient: result.sponsorFeeRecipient,
                        walrusBlobId: evidence.walrusBlobId,
                        uploadStatus: evidence.uploadStatus,
                    },
                    null,
                    2,
                ),
            );
        } catch (error) {
            const errorCode = classifyErrorCode(error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            await producer.reportIntentResult(intent.intentId, {
                agentAddress,
                success: false,
                errorCode,
                errorMessage,
            });
            console.error(`[runner] intent failed: ${intent.intentId} ${errorCode} ${errorMessage}`);
        }

        if (once) {
            return;
        }

        await sleep(pollMs);
    }
}

async function executeNativeGaslessPayment(
    agent: SafeFlowAgent,
    intent: PaymentIntent,
    amountAtomic: number,
): Promise<{ digest: string }> {
    const result = await agent.executeNativeGaslessStablecoinTransfer({
        recipient: intent.recipient,
        amountAtomic,
        coinType: intent.coinType,
    });
    return { digest: result.digest };
}

async function executeSponsoredGuardPayment(
    producer: ProducerApiClient,
    agent: SafeFlowAgent,
    intentId: string,
    agentAddress: string,
    walrusBlobId: string,
): Promise<{ digest: string; sponsorFeeAtomic?: number; sponsorFeeRecipient?: string | null }> {
    const sponsor = await producer.requestSponsor(intentId, {
        agentAddress,
        walrusBlobId,
    });
    const result = await agent.signAndSubmitSponsoredTransaction(
        sponsor.transactionBytes,
        sponsor.sponsorSignature,
    );
    return {
        digest: result.digest,
        sponsorFeeAtomic: sponsor.sponsorFeeAtomic,
        sponsorFeeRecipient: sponsor.sponsorFeeRecipient,
    };
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
