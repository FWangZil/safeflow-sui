import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SafeFlowAgent } from '@safeflow/sui-sdk';
import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Values provided by user.
const EXPECTED_AGENT_ADDRESS = '0x864558b5c8e041455dde9670b1f79df5a049987eb58bc289e71f5e0cd0fa88a4';
const WALLET_ID = '0xbad6a696240dff2cf9d249f04f70ff11946488a645bce2f0d492077121a8a1f7';
const SESSION_CAP_ID = '0x51184c8919a19c0dc5afe4dc1b30dc82598fab6d1a318d67ffb6ff2b137176ef';

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

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) {
        return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
        return false;
    }
    return fallback;
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

async function getSuiBalanceMist(client: SuiClient, owner: string): Promise<bigint> {
    const coins = await client.getCoins({ owner, coinType: '0x2::sui::SUI' });
    return coins.data.reduce((acc, coin) => acc + BigInt(coin.balance), BigInt(0));
}

async function topUpAgentIfNeeded(agentAddress: string): Promise<void> {
    const client = new SuiClient({ url: getFullnodeUrl('testnet') });
    const minGasMist = BigInt(100_000_000); // 0.1 SUI
    const before = await getSuiBalanceMist(client, agentAddress);
    if (before >= minGasMist) {
        console.log(`Agent gas balance is sufficient: ${before} MIST`);
        return;
    }

    console.log(`Agent gas balance is low (${before} MIST). Requesting faucet for ${agentAddress}...`);
    const response = await fetch('https://faucet.testnet.sui.io/v1/gas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            FixedAmountRequest: { recipient: agentAddress },
        }),
    });
    if (!response.ok) {
        throw new Error(`Faucet top-up failed: ${response.status} ${response.statusText}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 4000));
    const after = await getSuiBalanceMist(client, agentAddress);
    console.log(`Agent gas top-up done. Balance: ${after} MIST`);
}

async function main() {
    const packageId = process.env.PACKAGE_ID;
    if (!packageId) {
        throw new Error('Missing PACKAGE_ID in environment. Check agent_scripts/.env');
    }

    const mode = getArg('--mode') ?? 'success';
    const recipient = getArg('--recipient') ?? EXPECTED_AGENT_ADDRESS;
    const walrusBlobId = getArg('--blob-id');
    const reasoning = getArg('--reason') ?? `SafeFlow ${mode} payment test`;
    const skipAgentTopUp = hasFlag('--skip-agent-topup');
    const walrusPublisher = getArg('--walrus-publisher') ?? process.env.WALRUS_PUBLISHER_URL;
    const walrusAggregator = getArg('--walrus-aggregator') ?? process.env.WALRUS_AGGREGATOR_URL;
    const walrusEpochsRaw = getArg('--walrus-epochs') ?? process.env.WALRUS_EPOCHS ?? '5';
    const walrusEpochs = Number.parseInt(walrusEpochsRaw, 10);
    if (!Number.isInteger(walrusEpochs) || walrusEpochs <= 0) {
        throw new Error(`Invalid walrus epochs: ${walrusEpochsRaw}`);
    }
    const walrusDegradeRaw = getArg('--walrus-degrade') ?? process.env.WALRUS_DEGRADE_ON_UPLOAD_FAILURE;
    const walrusDegrade = parseBooleanFlag(walrusDegradeRaw, true);

    const amountByMode: Record<string, number> = {
        success: 1_000_000,   // 0.001 SUI
        'fail-rate': 10_000_000, // purposely exceed 1_000_000/s limit
    };
    const amount = amountByMode[mode];
    if (!amount) {
        throw new Error(`Unsupported mode "${mode}". Use --mode success or --mode fail-rate`);
    }

    const agent = new SafeFlowAgent({
        network: 'testnet',
        packageId,
        secretKey: loadAgentSecret(),
    });

    const actualAgentAddress = agent.getAddress();
    if (actualAgentAddress !== EXPECTED_AGENT_ADDRESS) {
        throw new Error(
            `Agent address mismatch.\nExpected: ${EXPECTED_AGENT_ADDRESS}\nActual:   ${actualAgentAddress}\nRe-create SessionCap for the actual address or update EXPECTED_AGENT_ADDRESS.`,
        );
    }

    if (skipAgentTopUp) {
        console.log('Skipping agent top-up step (--skip-agent-topup enabled).');
    } else {
        await topUpAgentIfNeeded(actualAgentAddress);
    }

    // Wait a bit so the first payment has allowance under per-second rate limit.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    console.log(
        JSON.stringify(
            {
                mode,
                packageId,
                walletId: WALLET_ID,
                sessionCapId: SESSION_CAP_ID,
                agentAddress: actualAgentAddress,
                recipient,
                amount,
                walrusBlobId,
                reasoning,
                walrus: {
                    publisher: walrusPublisher ?? null,
                    aggregator: walrusAggregator ?? null,
                    epochs: walrusEpochs,
                    degradeOnUploadFailure: walrusDegrade,
                },
            },
            null,
            2,
        ),
    );

    try {
        if (walrusBlobId && walrusBlobId.length > 0) {
            const result = await agent.executePayment(
                WALLET_ID,
                SESSION_CAP_ID,
                recipient,
                amount,
                walrusBlobId,
            );
            console.log(
                JSON.stringify(
                    {
                        success: true,
                        mode,
                        uploadStatus: 'provided',
                        walrusBlobId,
                        txDigest: result.digest,
                    },
                    null,
                    2,
                ),
            );
            console.log(`SUCCESS: digest=${result.digest}`);
            return;
        }

        const result = await agent.executePaymentWithEvidence({
            walletId: WALLET_ID,
            sessionCapId: SESSION_CAP_ID,
            recipient,
            amount,
            mode,
            reasoning,
            context: {
                script: 'agent_scripts/test.ts',
                skipAgentTopUp,
            },
            walrusConfig: {
                ...(walrusPublisher ? { publisherUrl: walrusPublisher } : {}),
                ...(walrusAggregator ? { aggregatorUrl: walrusAggregator } : {}),
                epochs: walrusEpochs,
            },
            degradeOnUploadFailure: walrusDegrade,
        });

        console.log(
            JSON.stringify(
                {
                    success: true,
                    mode,
                    uploadStatus: result.uploadStatus,
                    walrusBlobId: result.walrusBlobId,
                    aggregatorUrl: result.aggregatorUrl,
                    siteUrl: result.siteUrl,
                    uploadError: result.uploadError ?? null,
                    txDigest: result.digest,
                },
                null,
                2,
            ),
        );
        console.log(`SUCCESS: digest=${result.digest}`);
    } catch (error) {
        console.error('FAILED:', error);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
