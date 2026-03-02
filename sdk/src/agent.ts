import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client';
import { decodeSuiPrivateKey } from '@mysten/sui.js/cryptography';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import {
    uploadJsonToWalrus,
    type WalrusClientConfig,
    type WalrusReasoningPayload,
    type WalrusUploadResult,
} from './walrus.js';

export interface SafeFlowAgentConfig {
    network?: 'testnet' | 'mainnet' | 'devnet' | 'localnet';
    packageId: string;
    secretKey?: string | Uint8Array | number[];
}

export interface SessionCapConfig {
    maxSpendPerSecond: number;
    maxSpendTotal: number;
    expiresAtMs: number;
}

export interface SetupResult {
    walletId: string;
    sessionCapId: string;
    agentAddress: string;
}

export interface ExecutePaymentWithEvidenceParams {
    walletId: string;
    sessionCapId: string;
    recipient: string;
    amount: number;
    walrusBlobId?: string;
    reasoning?: string;
    context?: Record<string, unknown>;
    mode?: string;
    walrusConfig?: Partial<WalrusClientConfig>;
    degradeOnUploadFailure?: boolean;
}

export interface ExecutePaymentWithEvidenceResult {
    digest: string;
    walrusBlobId: string;
    uploadStatus: 'provided' | 'uploaded' | 'fallback';
    aggregatorUrl: string | null;
    siteUrl: string | null;
    uploadError?: string;
    uploadResult?: WalrusUploadResult;
}

export class SafeFlowAgent {
    private client: SuiClient;
    private keypair: Ed25519Keypair;
    private packageId: string;
    private suiCoinType = '0x2::sui::SUI';

    constructor(config: SafeFlowAgentConfig) {
        this.client = new SuiClient({
            url: getFullnodeUrl(config.network || 'testnet')
        });

        this.packageId = config.packageId;

        if (config.secretKey !== undefined) {
            const secretKeyBytes = normalizeSecretKey(config.secretKey);
            this.keypair = Ed25519Keypair.fromSecretKey(secretKeyBytes);
        } else {
            this.keypair = new Ed25519Keypair();
        }
    }

    /**
     * Get the agent's Sui address
     */
    public getAddress(): string {
        return this.keypair.getPublicKey().toSuiAddress();
    }

    /**
     * Get the agent's keypair (useful for saving to storage)
     */
    public getKeypair(): Ed25519Keypair {
        return this.keypair;
    }

    /**
     * Create a new SafeFlow Wallet
     * Returns the wallet object ID
     */
    public async createWallet(): Promise<string> {
        const txb = new TransactionBlock();

        txb.moveCall({
            target: `${this.packageId}::wallet::create_wallet`,
            typeArguments: [this.suiCoinType],
            arguments: []
        });

        try {
            const result = await this.client.signAndExecuteTransactionBlock({
                signer: this.keypair,
                transactionBlock: txb,
                options: {
                    showEffects: true,
                    showEvents: true
                }
            });

            // Extract wallet ID from events
            const walletCreatedEvent = result.events?.find(
                e => e.type.includes('WalletCreated')
            );

            if (walletCreatedEvent) {
                return (walletCreatedEvent.parsedJson as any).wallet_id;
            }

            throw new Error('Wallet created but could not extract wallet ID from events');
        } catch (e: any) {
            throw new Error(`Failed to create wallet: ${e.message}`);
        }
    }

    /**
     * Create a SessionCap for this agent to spend from a wallet
     * Note: This must be called by the wallet owner, not the agent
     */
    public async createSessionCap(
        walletId: string,
        agentAddress: string,
        config: SessionCapConfig
    ): Promise<string> {
        const txb = new TransactionBlock();

        txb.moveCall({
            target: `${this.packageId}::wallet::create_session_cap`,
            typeArguments: [this.suiCoinType],
            arguments: [
                txb.object(walletId),
                txb.pure(agentAddress),
                txb.pure(config.maxSpendPerSecond),
                txb.pure(config.maxSpendTotal),
                txb.pure(config.expiresAtMs),
                txb.object('0x6') // The system Clock object
            ]
        });

        try {
            const result = await this.client.signAndExecuteTransactionBlock({
                signer: this.keypair,
                transactionBlock: txb,
                options: {
                    showEffects: true,
                    showEvents: true
                }
            });

            // Extract session cap ID from events
            const sessionCreatedEvent = result.events?.find(
                e => e.type.includes('SessionCapCreated')
            );

            if (sessionCreatedEvent) {
                return (sessionCreatedEvent.parsedJson as any).cap_id;
            }

            throw new Error('SessionCap created but could not extract ID from events');
        } catch (e: any) {
            throw new Error(`Failed to create session cap: ${e.message}`);
        }
    }

    /**
     * Execute a payment using a SessionCap
     * This is the core skill that agents will use to execute payments
     */
    public async executePayment(
        walletId: string,
        sessionCapId: string,
        recipient: string,
        amount: number,
        walrusBlobId: string
    ) {
        const txb = new TransactionBlock();

        txb.moveCall({
            target: `${this.packageId}::wallet::execute_payment`,
            typeArguments: [this.suiCoinType],
            arguments: [
                txb.object(walletId),
                txb.object(sessionCapId),
                txb.pure(amount),
                txb.pure(recipient),
                txb.pure(walrusBlobId),
                txb.object('0x6') // The system Clock object
            ]
        });

        try {
            const result = await this.client.signAndExecuteTransactionBlock({
                signer: this.keypair,
                transactionBlock: txb,
                options: {
                    showEffects: true,
                    showEvents: true
                }
            });
            return result;
        } catch (e: any) {
            throw new Error(`SafeFlow execution failed: ${e.message}`);
        }
    }

    /**
     * Upload reasoning payload to Walrus testnet and return the resolved blob metadata.
     */
    public async uploadReasoningToWalrus(
        payload: WalrusReasoningPayload,
        config?: Partial<WalrusClientConfig>,
    ): Promise<WalrusUploadResult> {
        try {
            return await uploadJsonToWalrus(payload, config);
        } catch (error: any) {
            throw new Error(`Walrus upload failed: ${error?.message ?? String(error)}`);
        }
    }

    /**
     * Execute payment with real Walrus evidence upload.
     * If upload fails and degradeOnUploadFailure is true, it falls back to a deterministic hash-based marker.
     */
    public async executePaymentWithEvidence(
        params: ExecutePaymentWithEvidenceParams,
    ): Promise<ExecutePaymentWithEvidenceResult> {
        const degradeOnUploadFailure = params.degradeOnUploadFailure ?? true;
        if (params.walrusBlobId && params.walrusBlobId.trim().length > 0) {
            const result = await this.executePayment(
                params.walletId,
                params.sessionCapId,
                params.recipient,
                params.amount,
                params.walrusBlobId,
            );
            return {
                digest: result.digest,
                walrusBlobId: params.walrusBlobId,
                uploadStatus: 'provided',
                aggregatorUrl: null,
                siteUrl: null,
            };
        }

        const payload: WalrusReasoningPayload = {
            version: '1.0.0',
            timestampMs: Date.now(),
            agentAddress: this.getAddress(),
            walletId: params.walletId,
            sessionCapId: params.sessionCapId,
            recipient: params.recipient,
            amountMist: params.amount,
            mode: params.mode ?? 'payment',
            reasoning: params.reasoning ?? 'SafeFlow payment execution',
            context: params.context,
        };

        try {
            const uploadResult = await this.uploadReasoningToWalrus(payload, params.walrusConfig);
            const txResult = await this.executePayment(
                params.walletId,
                params.sessionCapId,
                params.recipient,
                params.amount,
                uploadResult.blobId,
            );
            return {
                digest: txResult.digest,
                walrusBlobId: uploadResult.blobId,
                uploadStatus: 'uploaded',
                aggregatorUrl: uploadResult.aggregatorUrl,
                siteUrl: uploadResult.siteUrl,
                uploadResult,
            };
        } catch (error: any) {
            if (!degradeOnUploadFailure) {
                throw new Error(`SafeFlow execution failed: ${error?.message ?? String(error)}`);
            }
            const fallbackBlobId = await buildFallbackWalrusBlobId(payload);
            const txResult = await this.executePayment(
                params.walletId,
                params.sessionCapId,
                params.recipient,
                params.amount,
                fallbackBlobId,
            );
            return {
                digest: txResult.digest,
                walrusBlobId: fallbackBlobId,
                uploadStatus: 'fallback',
                aggregatorUrl: null,
                siteUrl: null,
                uploadError: error?.message ?? String(error),
            };
        }
    }

    /**
     * Request SUI from the testnet faucet
     */
    public async requestFaucet(): Promise<void> {
        const address = this.getAddress();
        const response = await fetch(`https://faucet.testnet.sui.io/v1/gas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                FixedAmountRequest: {
                    recipient: address
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Faucet request failed: ${response.statusText}`);
        }
    }

    /**
     * Get SUI balance for this agent
     */
    public async getBalance(): Promise<bigint> {
        const coins = await this.client.getCoins({
            owner: this.getAddress(),
            coinType: this.suiCoinType
        });

        return coins.data.reduce((acc, coin) => acc + BigInt(coin.balance), BigInt(0));
    }
}

/**
 * Auto-setup SafeFlow for a user
 * This handles the complete flow: create wallet -> create session cap for agent
 * Note: This requires the user to have SUI for gas fees
 */
export async function autoSetupSafeFlow(
    userKeypair: Ed25519Keypair,
    agentAddress: string,
    packageId: string,
    network: 'testnet' | 'mainnet' | 'devnet' | 'localnet' = 'testnet',
    sessionConfig?: Partial<SessionCapConfig>
): Promise<SetupResult> {
    const secretKeyBytes = userKeypair.getSecretKey();
    const userAgent = new SafeFlowAgent({
        network,
        packageId,
        secretKey: secretKeyBytes
    });

    // Create wallet
    console.log('[Setup] Creating SafeFlow Wallet...');
    const walletId = await userAgent.createWallet();
    console.log(`[Setup] Wallet created: ${walletId}`);

    // Default session config: 1000 SUI per second, 10000 total, 30 days expiry
    const defaultConfig: SessionCapConfig = {
        maxSpendPerSecond: sessionConfig?.maxSpendPerSecond || 1_000_000_000_000, // 1000 SUI/sec
        maxSpendTotal: sessionConfig?.maxSpendTotal || 10_000_000_000_000, // 10000 SUI total
        expiresAtMs: sessionConfig?.expiresAtMs || Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
    };

    // Create session cap for the agent
    console.log('[Setup] Creating SessionCap for agent...');
    const sessionCapId = await userAgent.createSessionCap(
        walletId,
        agentAddress,
        defaultConfig
    );
    console.log(`[Setup] SessionCap created: ${sessionCapId}`);

    return {
        walletId,
        sessionCapId,
        agentAddress
    };
}

function normalizeSecretKey(secretKey: string | Uint8Array | number[]): Uint8Array {
    if (secretKey instanceof Uint8Array) {
        return secretKey;
    }

    if (Array.isArray(secretKey)) {
        return Uint8Array.from(secretKey);
    }

    const raw = secretKey.trim();
    if (raw.startsWith('suiprivkey')) {
        return decodeSuiPrivateKey(raw).secretKey;
    }

    const withNoPrefix = raw.startsWith('0x') ? raw.slice(2) : raw;

    // Accept hex-encoded secrets for compatibility with scripts and env vars.
    if (withNoPrefix.length > 0 && withNoPrefix.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(withNoPrefix)) {
        return Uint8Array.from(withNoPrefix.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
    }

    // Fallback to base64 for keypair.getSecretKey() style strings.
    try {
        const decoded = atob(raw);
        return Uint8Array.from(decoded, (ch) => ch.charCodeAt(0));
    } catch {
        throw new Error('Unsupported secretKey format. Use Uint8Array, number[], hex string, or base64 string.');
    }
}

async function buildFallbackWalrusBlobId(payload: WalrusReasoningPayload): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    return `fallback:${hash}`;
}
