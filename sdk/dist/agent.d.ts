import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { type WalrusClientConfig, type WalrusReasoningPayload, type WalrusUploadResult } from './walrus.js';
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
export declare class SafeFlowAgent {
    private client;
    private keypair;
    private packageId;
    private suiCoinType;
    constructor(config: SafeFlowAgentConfig);
    /**
     * Get the agent's Sui address
     */
    getAddress(): string;
    /**
     * Get the agent's keypair (useful for saving to storage)
     */
    getKeypair(): Ed25519Keypair;
    /**
     * Create a new SafeFlow Wallet
     * Returns the wallet object ID
     */
    createWallet(): Promise<string>;
    /**
     * Create a SessionCap for this agent to spend from a wallet
     * Note: This must be called by the wallet owner, not the agent
     */
    createSessionCap(walletId: string, agentAddress: string, config: SessionCapConfig): Promise<string>;
    /**
     * Execute a payment using a SessionCap
     * This is the core skill that agents will use to execute payments
     */
    executePayment(walletId: string, sessionCapId: string, recipient: string, amount: number, walrusBlobId: string): Promise<import("@mysten/sui.js/client").SuiTransactionBlockResponse>;
    /**
     * Upload reasoning payload to Walrus testnet and return the resolved blob metadata.
     */
    uploadReasoningToWalrus(payload: WalrusReasoningPayload, config?: Partial<WalrusClientConfig>): Promise<WalrusUploadResult>;
    /**
     * Execute payment with real Walrus evidence upload.
     * If upload fails and degradeOnUploadFailure is true, it falls back to a deterministic hash-based marker.
     */
    executePaymentWithEvidence(params: ExecutePaymentWithEvidenceParams): Promise<ExecutePaymentWithEvidenceResult>;
    /**
     * Request SUI from the testnet faucet
     */
    requestFaucet(): Promise<void>;
    /**
     * Get SUI balance for this agent
     */
    getBalance(): Promise<bigint>;
}
/**
 * Auto-setup SafeFlow for a user
 * This handles the complete flow: create wallet -> create session cap for agent
 * Note: This requires the user to have SUI for gas fees
 */
export declare function autoSetupSafeFlow(userKeypair: Ed25519Keypair, agentAddress: string, packageId: string, network?: 'testnet' | 'mainnet' | 'devnet' | 'localnet', sessionConfig?: Partial<SessionCapConfig>): Promise<SetupResult>;
