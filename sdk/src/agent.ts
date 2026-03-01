import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';

export interface TickpayAgentConfig {
    network?: 'testnet' | 'mainnet' | 'devnet' | 'localnet';
    packageId: string;
    secretKey?: string;
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

export class TickpayAgent {
    private client: SuiClient;
    private keypair: Ed25519Keypair;
    private packageId: string;
    private suiCoinType = '0x2::sui::SUI';

    constructor(config: TickpayAgentConfig) {
        this.client = new SuiClient({
            url: getFullnodeUrl(config.network || 'testnet')
        });

        this.packageId = config.packageId;

        if (config.secretKey) {
            // Convert hex string to Uint8Array
            const secretKeyBytes = new Uint8Array(
                config.secretKey.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
            );
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
     * Create a new Tickpay Wallet
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
            throw new Error(`Tickpay execution failed: ${e.message}`);
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
 * Auto-setup Tickpay for a user
 * This handles the complete flow: create wallet -> create session cap for agent
 * Note: This requires the user to have SUI for gas fees
 */
export async function autoSetupTickpay(
    userKeypair: Ed25519Keypair,
    agentAddress: string,
    packageId: string,
    network: 'testnet' | 'mainnet' | 'devnet' | 'localnet' = 'testnet',
    sessionConfig?: Partial<SessionCapConfig>
): Promise<SetupResult> {
    // getSecretKey() returns a base64 string, convert to hex
    const secretKeyBytes = userKeypair.getSecretKey();
    const userAgent = new TickpayAgent({
        network,
        packageId,
        secretKey: secretKeyBytes
    });

    // Create wallet
    console.log('[Setup] Creating Tickpay Wallet...');
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
