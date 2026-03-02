import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client';
import { decodeSuiPrivateKey } from '@mysten/sui.js/cryptography';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';
export class SafeFlowAgent {
    client;
    keypair;
    packageId;
    suiCoinType = '0x2::sui::SUI';
    constructor(config) {
        this.client = new SuiClient({
            url: getFullnodeUrl(config.network || 'testnet')
        });
        this.packageId = config.packageId;
        if (config.secretKey !== undefined) {
            const secretKeyBytes = normalizeSecretKey(config.secretKey);
            this.keypair = Ed25519Keypair.fromSecretKey(secretKeyBytes);
        }
        else {
            this.keypair = new Ed25519Keypair();
        }
    }
    /**
     * Get the agent's Sui address
     */
    getAddress() {
        return this.keypair.getPublicKey().toSuiAddress();
    }
    /**
     * Get the agent's keypair (useful for saving to storage)
     */
    getKeypair() {
        return this.keypair;
    }
    /**
     * Create a new SafeFlow Wallet
     * Returns the wallet object ID
     */
    async createWallet() {
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
            const walletCreatedEvent = result.events?.find(e => e.type.includes('WalletCreated'));
            if (walletCreatedEvent) {
                return walletCreatedEvent.parsedJson.wallet_id;
            }
            throw new Error('Wallet created but could not extract wallet ID from events');
        }
        catch (e) {
            throw new Error(`Failed to create wallet: ${e.message}`);
        }
    }
    /**
     * Create a SessionCap for this agent to spend from a wallet
     * Note: This must be called by the wallet owner, not the agent
     */
    async createSessionCap(walletId, agentAddress, config) {
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
            const sessionCreatedEvent = result.events?.find(e => e.type.includes('SessionCapCreated'));
            if (sessionCreatedEvent) {
                return sessionCreatedEvent.parsedJson.cap_id;
            }
            throw new Error('SessionCap created but could not extract ID from events');
        }
        catch (e) {
            throw new Error(`Failed to create session cap: ${e.message}`);
        }
    }
    /**
     * Execute a payment using a SessionCap
     * This is the core skill that agents will use to execute payments
     */
    async executePayment(walletId, sessionCapId, recipient, amount, walrusBlobId) {
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
        }
        catch (e) {
            throw new Error(`SafeFlow execution failed: ${e.message}`);
        }
    }
    /**
     * Request SUI from the testnet faucet
     */
    async requestFaucet() {
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
    async getBalance() {
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
export async function autoSetupSafeFlow(userKeypair, agentAddress, packageId, network = 'testnet', sessionConfig) {
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
    const defaultConfig = {
        maxSpendPerSecond: sessionConfig?.maxSpendPerSecond || 1_000_000_000_000, // 1000 SUI/sec
        maxSpendTotal: sessionConfig?.maxSpendTotal || 10_000_000_000_000, // 10000 SUI total
        expiresAtMs: sessionConfig?.expiresAtMs || Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
    };
    // Create session cap for the agent
    console.log('[Setup] Creating SessionCap for agent...');
    const sessionCapId = await userAgent.createSessionCap(walletId, agentAddress, defaultConfig);
    console.log(`[Setup] SessionCap created: ${sessionCapId}`);
    return {
        walletId,
        sessionCapId,
        agentAddress
    };
}
function normalizeSecretKey(secretKey) {
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
        return Uint8Array.from(withNoPrefix.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    }
    // Fallback to base64 for keypair.getSecretKey() style strings.
    try {
        const decoded = atob(raw);
        return Uint8Array.from(decoded, (ch) => ch.charCodeAt(0));
    }
    catch {
        throw new Error('Unsupported secretKey format. Use Uint8Array, number[], hex string, or base64 string.');
    }
}
