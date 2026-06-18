import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client';
import { decodeSuiPrivateKey } from '@mysten/sui.js/cryptography';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { fromB64 } from '@mysten/sui.js/utils';
import {
    uploadJsonToWalrus,
    type WalrusClientConfig,
    type WalrusReasoningPayload,
    type WalrusUploadResult,
} from './walrus.js';
import { DEFAULT_COIN_TYPE } from './producer.js';

export interface SafeFlowAgentConfig {
    network?: 'testnet' | 'mainnet' | 'devnet' | 'localnet';
    packageId: string;
    secretKey?: string | Uint8Array | number[];
    coinType?: string;
    grpcBaseUrl?: string;
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
    walletId?: string | null;
    sessionCapId?: string | null;
    recipient: string;
    amount?: number;
    amountAtomic?: number;
    coinType?: string;
    currencySymbol?: string;
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

export interface PreparePaymentEvidenceResult {
    walrusBlobId: string;
    uploadStatus: 'provided' | 'uploaded' | 'fallback';
    aggregatorUrl: string | null;
    siteUrl: string | null;
    uploadError?: string;
    uploadResult?: WalrusUploadResult;
}

export interface SubmitSponsoredTransactionResult {
    digest: string;
}

export interface ExecuteNativeGaslessStablecoinTransferParams {
    recipient: string;
    amountAtomic: number;
    coinType?: string;
}

export interface ExecuteNativeGaslessStablecoinTransferResult {
    digest: string;
}

export class SafeFlowAgent {
    private client: SuiClient;
    private nativeGrpcClient?: any;
    private keypair: Ed25519Keypair;
    private packageId: string;
    private coinType: string;
    private network: 'testnet' | 'mainnet' | 'devnet' | 'localnet';
    private grpcBaseUrl?: string;

    constructor(config: SafeFlowAgentConfig) {
        const network = config.network || 'testnet';
        this.network = network;
        this.grpcBaseUrl = config.grpcBaseUrl;
        this.client = new SuiClient({
            url: getFullnodeUrl(network)
        });

        this.packageId = config.packageId;
        this.coinType = config.coinType ?? DEFAULT_COIN_TYPE;

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
            typeArguments: [this.coinType],
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
            typeArguments: [this.coinType],
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
        walrusBlobId: string,
        coinType = this.coinType,
    ) {
        const txb = new TransactionBlock();

        txb.moveCall({
            target: `${this.packageId}::wallet::execute_payment`,
            typeArguments: [coinType],
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
        const amountAtomic = resolveAmountAtomic(params);
        const { walletId, sessionCapId } = requireGuardObjects(params);
        if (params.walrusBlobId && params.walrusBlobId.trim().length > 0) {
            const result = await this.executePayment(
                walletId,
                sessionCapId,
                params.recipient,
                amountAtomic,
                params.walrusBlobId,
                params.coinType ?? this.coinType,
            );
            return {
                digest: result.digest,
                walrusBlobId: params.walrusBlobId,
                uploadStatus: 'provided',
                aggregatorUrl: null,
                siteUrl: null,
            };
        }

        const evidence = await this.preparePaymentEvidence(params);
        const txResult = await this.executePayment(
            walletId,
            sessionCapId,
            params.recipient,
            amountAtomic,
            evidence.walrusBlobId,
            params.coinType ?? this.coinType,
        );
        return {
            digest: txResult.digest,
            ...evidence,
        };
    }

    public async preparePaymentEvidence(
        params: ExecutePaymentWithEvidenceParams,
    ): Promise<PreparePaymentEvidenceResult> {
        const degradeOnUploadFailure = params.degradeOnUploadFailure ?? true;
        const amountAtomic = resolveAmountAtomic(params);
        if (params.walrusBlobId && params.walrusBlobId.trim().length > 0) {
            return {
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
            walletId: params.walletId ?? 'native-gasless',
            sessionCapId: params.sessionCapId ?? 'native-gasless',
            recipient: params.recipient,
            amountMist: amountAtomic,
            amountAtomic,
            coinType: params.coinType ?? this.coinType,
            currencySymbol: params.currencySymbol,
            mode: params.mode ?? 'payment',
            reasoning: params.reasoning ?? 'SafeFlow payment execution',
            context: params.context,
        };

        try {
            const uploadResult = await this.uploadReasoningToWalrus(payload, params.walrusConfig);
            return {
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
            return {
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
            coinType: this.coinType
        });

        return coins.data.reduce((acc, coin) => acc + BigInt(coin.balance), BigInt(0));
    }

    public async signAndSubmitSponsoredTransaction(
        transactionBytes: string,
        sponsorSignature: string,
    ): Promise<SubmitSponsoredTransactionResult> {
        const bytes = fromB64(transactionBytes);
        const { signature } = await this.keypair.signTransactionBlock(bytes);
        const result = await this.client.executeTransactionBlock({
            transactionBlock: bytes,
            signature: [signature, sponsorSignature],
            options: {
                showEffects: true,
                showEvents: true,
            },
        });
        return { digest: result.digest };
    }

    public async executeNativeGaslessStablecoinTransfer(
        params: ExecuteNativeGaslessStablecoinTransferParams,
    ): Promise<ExecuteNativeGaslessStablecoinTransferResult> {
        const amountAtomic = params.amountAtomic;
        if (!Number.isInteger(amountAtomic) || amountAtomic <= 0) {
            throw new Error('amountAtomic must be a positive integer.');
        }
        const [{ SuiGrpcClient }, { Ed25519Keypair: NativeEd25519Keypair }, { Transaction: NativeTransaction }] = await Promise.all([
            importRuntime('@mysten/sui/grpc'),
            importRuntime('@mysten/sui/keypairs/ed25519'),
            importRuntime('@mysten/sui/transactions'),
        ]);
        const coinType = params.coinType ?? this.coinType;
        const tx = new NativeTransaction();
        tx.setSender(this.getAddress());
        tx.moveCall({
            target: '0x2::balance::send_funds',
            typeArguments: [coinType],
            arguments: [
                tx.balance({ type: coinType, balance: BigInt(amountAtomic) }),
                tx.pure.address(params.recipient),
            ],
        });

        const nativeGrpcClient = this.nativeGrpcClient ?? new SuiGrpcClient({
            network: this.network,
            baseUrl: this.grpcBaseUrl ?? getDefaultGrpcBaseUrl(this.network),
        });
        const nativeKeypair = NativeEd25519Keypair.fromSecretKey(this.keypair.getSecretKey());
        const result: any = await nativeGrpcClient.signAndExecuteTransaction({
            transaction: tx,
            signer: nativeKeypair,
            include: {
                transaction: true,
                effects: true,
                events: true,
            },
        });

        const digest = result.digest
            ?? result.transaction?.digest
            ?? result.effects?.transactionDigest
            ?? result.effects?.transactionDigest?.digest;
        if (typeof digest !== 'string' || digest.length === 0) {
            throw new Error('Native gasless transfer executed but no digest was returned.');
        }
        return { digest };
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
    sessionConfig?: Partial<SessionCapConfig>,
    coinType = DEFAULT_COIN_TYPE,
): Promise<SetupResult> {
    const secretKeyBytes = userKeypair.getSecretKey();
    const userAgent = new SafeFlowAgent({
        network,
        packageId,
        secretKey: secretKeyBytes,
        coinType,
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

function resolveAmountAtomic(params: ExecutePaymentWithEvidenceParams): number {
    const amount = params.amountAtomic ?? params.amount;
    if (!Number.isInteger(amount) || amount === undefined || amount <= 0) {
        throw new Error('amountAtomic or amount must be a positive integer.');
    }
    return amount;
}

function requireGuardObjects(params: ExecutePaymentWithEvidenceParams): { walletId: string; sessionCapId: string } {
    if (!params.walletId || !params.sessionCapId) {
        throw new Error('walletId and sessionCapId are required for sponsored_guard execution.');
    }
    return {
        walletId: params.walletId,
        sessionCapId: params.sessionCapId,
    };
}

function getDefaultGrpcBaseUrl(network: 'testnet' | 'mainnet' | 'devnet' | 'localnet'): string {
    if (network === 'localnet') {
        return 'http://127.0.0.1:9000';
    }
    return `https://fullnode.${network}.sui.io:443`;
}

const importRuntime = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
