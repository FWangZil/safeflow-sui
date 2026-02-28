import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Agent Key Management
const KEY_FILE = path.join(__dirname, '.agent_key.json');

function getOrGenerateAgentKey(): Ed25519Keypair {
    if (fs.existsSync(KEY_FILE)) {
        const secretKey = JSON.parse(fs.readFileSync(KEY_FILE, 'utf-8')).secretKey;
        console.log('Loaded existing Agent Keypair');
        return Ed25519Keypair.fromSecretKey(Uint8Array.from(secretKey));
    } else {
        const keypair = new Ed25519Keypair();
        fs.writeFileSync(KEY_FILE, JSON.stringify({
            secretKey: Array.from(keypair.getSecretKey()),
            publicKey: keypair.getPublicKey().toBase64(),
            address: keypair.getPublicKey().toSuiAddress()
        }, null, 2));
        console.log(`Generated new Agent Keypair. Address: ${keypair.getPublicKey().toSuiAddress()}`);
        return keypair;
    }
}

// Client Setup
const client = new SuiClient({ url: getFullnodeUrl('testnet') });
const PACKAGE_ID = process.env.PACKAGE_ID || '<YOUR_PACKAGE_ID>';
const SUI_COIN_TYPE = '0x2::sui::SUI';

/**
 * Example OpenClaw Tool / Skill: Execute a Payment using the SessionCap
 */
async function agentExecutePayment(
    walletId: string,
    sessionCapId: string,
    recipient: string,
    amount: number,
    walrusBlobId: string
) {
    const keypair = getOrGenerateAgentKey();
    console.log(`Agent Address executing payment: ${keypair.toSuiAddress()}`);

    const txb = new TransactionBlock();

    // Call the Move function
    txb.moveCall({
        target: `${PACKAGE_ID}::wallet::execute_payment`,
        typeArguments: [SUI_COIN_TYPE],
        arguments: [
            txb.object(walletId),
            txb.object(sessionCapId),
            txb.pure(amount),
            txb.pure(recipient),
            txb.pure(walrusBlobId),
            txb.object('0x6') // The system Clock object
        ]
    });

    console.log('Executing transaction...');

    try {
        const result = await client.signAndExecuteTransactionBlock({
            signer: keypair,
            transactionBlock: txb,
            options: {
                showEffects: true,
                showEvents: true
            }
        });
        console.log('Transaction Successful!');
        console.log(`Digest: ${result.digest}`);
        if (result.events && result.events.length > 0) {
            console.log('Events emitted:', JSON.stringify(result.events, null, 2));
        }
        return result;
    } catch (e: any) {
        console.error('Transaction Failed. This might be due to Rate Limit, Expiration, or Insufficient Balance.');
        console.error(e.message);
        throw e;
    }
}

// Just an entry point for testing/demonstration
async function main() {
    const keypair = getOrGenerateAgentKey();
    console.log(`OpenClaw Agent Local Wallet Address: ${keypair.toSuiAddress()}`);
    console.log(`Please ask the Human to create a SessionCap for this address via the Web UI.`);
    console.log(`Once you have the walletId and sessionCapId, the agent can call 'agentExecutePayment'.`);

    // Uncomment and fill to test:
    // await agentExecutePayment(
    //     'WALLET_OBJECT_ID_HERE',
    //     'SESSION_CAP_OBJECT_ID_HERE',
    //     'RECIPIENT_ADDRESS_HERE',
    //     1000000, // 0.001 SUI
    //     'walrus_blob_reason_123'
    // );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(console.error);
}
