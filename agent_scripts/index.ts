import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SafeFlowAgent, createSafeFlowSkill } from '@safeflow/sui-sdk';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Agent Key Management Example
const KEY_FILE = path.join(__dirname, '.agent_key.json');

type AgentSecret = string | Uint8Array;

function getOrGenerateAgentSecret(): AgentSecret | undefined {
    if (fs.existsSync(KEY_FILE)) {
        const secretKey = JSON.parse(fs.readFileSync(KEY_FILE, 'utf-8')).secretKey as unknown;
        console.log('Loaded existing Agent Keypair from file');

        if (typeof secretKey === 'string') {
            return secretKey;
        }

        if (Array.isArray(secretKey)) {
            if (secretKey.length === 0) {
                return undefined;
            }

            if (typeof secretKey[0] === 'string') {
                return secretKey.join('');
            }

            return Uint8Array.from(secretKey as number[]);
        }
    }

    return undefined;
}

function saveAgentKey(keypair: Ed25519Keypair) {
    if (!fs.existsSync(KEY_FILE)) {
        const secret = keypair.getSecretKey();
        const secretKey = typeof secret === 'string' ? secret : Array.from(secret);

        fs.writeFileSync(KEY_FILE, JSON.stringify({
            secretKey,
            publicKey: keypair.getPublicKey().toBase64(),
            address: keypair.getPublicKey().toSuiAddress()
        }, null, 2));
        console.log(`Generated and saved new Agent Keypair. Address: ${keypair.getPublicKey().toSuiAddress()}`);
    }
}

// Just an entry point for testing/demonstration
async function main() {
    const PACKAGE_ID = process.env.PACKAGE_ID;
    if (!PACKAGE_ID) {
        throw new Error('Missing PACKAGE_ID. Please set PACKAGE_ID to your deployed package id.');
    }

    const secretKey = getOrGenerateAgentSecret();

    // 1. Initialize the SDK Agent
    const config: { network: 'testnet'; packageId: string; secretKey?: AgentSecret } = {
        network: 'testnet',
        packageId: PACKAGE_ID,
    };
    if (secretKey !== undefined) {
        config.secretKey = secretKey;
    }

    const agent = new SafeFlowAgent(config);

    // Save key if it was newly generated
    saveAgentKey(agent.getKeypair());

    console.log(`\n🤖 OpenClaw Agent Local Wallet Address: ${agent.getAddress()}`);
    console.log(`Please ask the Human to create a SessionCap for this address via the Web UI.`);
    console.log(`Once you have the walletId and sessionCapId, the agent can call the skill.\n`);

    // 2. Create the Skill tool definition
    const safeFlowSkill = createSafeFlowSkill(agent);

    console.log('📦 Extracted Agent Skill Ready to be registered:');
    console.log(JSON.stringify({
        name: safeFlowSkill.name,
        description: safeFlowSkill.description,
        parameters: safeFlowSkill.parameters
    }, null, 2));

    // Uncomment and fill to test executing via the skill:
    // console.log('\nExecuting skill directly for test...');
    // const result = await safeFlowSkill.execute({
    //     walletId: 'WALLET_OBJECT_ID_HERE',
    //     sessionCapId: 'SESSION_CAP_OBJECT_ID_HERE',
    //     recipient: 'RECIPIENT_ADDRESS_HERE',
    //     amount: 1000000, // 0.001 SUI
    //     walrusBlobId: 'walrus_blob_reason_123'
    // });
    // console.log(result);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(console.error);
}
