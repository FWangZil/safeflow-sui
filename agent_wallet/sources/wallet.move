module agent_wallet::wallet {
    use std::string::String;
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::event;

    // === Errors ===
    const ENotOwner: u64 = 0;
    const EExceedsRateLimit: u64 = 1;
    const EInsufficientBalance: u64 = 2;
    const ESessionExpired: u64 = 3;

    // === Structs ===

    /// The AgentWallet owned by the human, holding the funds.
    public struct AgentWallet<phantom T> has key {
        id: UID,
        balance: Balance<T>,
        owner: address,
    }

    /// The capability given to the Agent to spend from a specific wallet.
    public struct SessionCap has key, store {
        id: UID,
        wallet_id: ID,
        max_spend_per_second: u64,
        max_spend_total: u64,
        total_spent: u64,
        last_spend_time_ms: u64,
        expires_at_ms: u64,
    }

    // === Events ===

    public struct WalletCreated has copy, drop {
        wallet_id: ID,
        owner: address,
    }

    public struct SessionCapCreated has copy, drop {
        cap_id: ID,
        wallet_id: ID,
        agent: address,
    }

    public struct PaymentExecuted has copy, drop {
        wallet_id: ID,
        amount: u64,
        recipient: address,
        walrus_blob_id: String, // Audit trail
    }

    public struct SponsorFeePaid has copy, drop {
        wallet_id: ID,
        amount: u64,
        recipient: address,
        walrus_blob_id: String,
    }

    // === Public Functions ===

    /// Creates a new Agent Wallet and shares it.
    public fun create_wallet<T>(ctx: &mut TxContext) {
        let wallet = AgentWallet<T> {
            id: object::new(ctx),
            balance: balance::zero(),
            owner: ctx.sender(),
        };

        event::emit(WalletCreated {
            wallet_id: object::id(&wallet),
            owner: ctx.sender(),
        });

        transfer::share_object(wallet);
    }

    /// Deposit coins into the wallet.
    public fun deposit<T>(wallet: &mut AgentWallet<T>, coin: Coin<T>) {
        coin::put(&mut wallet.balance, coin);
    }

    /// Human owner creates a SessionCap for an agent.
    public fun create_session_cap<T>(
        wallet: &AgentWallet<T>,
        agent_address: address,
        max_spend_per_second: u64,
        max_spend_total: u64,
        expires_at_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(wallet.owner == ctx.sender(), ENotOwner);

        let cap = SessionCap {
            id: object::new(ctx),
            wallet_id: object::id(wallet),
            max_spend_per_second,
            max_spend_total,
            total_spent: 0,
            last_spend_time_ms: clock::timestamp_ms(clock),
            expires_at_ms,
        };

        event::emit(SessionCapCreated {
            cap_id: object::id(&cap),
            wallet_id: object::id(wallet),
            agent: agent_address,
        });

        transfer::public_transfer(cap, agent_address);
    }

    /// Agent uses its SessionCap to execute a payment.
    /// Requires a Walrus Blob ID as an audit trail (proof of intent/reasoning).
    public fun execute_payment<T>(
        wallet: &mut AgentWallet<T>,
        cap: &mut SessionCap,
        amount: u64,
        recipient: address,
        walrus_blob_id: String,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        authorize_spend(wallet, cap, amount, clock);

        // Extract funds
        let payment_coin = coin::take(&mut wallet.balance, amount, ctx);
        transfer::public_transfer(payment_coin, recipient);

        event::emit(PaymentExecuted {
            wallet_id: object::id(wallet),
            amount,
            recipient,
            walrus_blob_id,
        });
    }

    /// Agent pays a merchant and reimburses the sponsor in the same stablecoin.
    /// The merchant amount and sponsor fee are checked together against SessionCap limits.
    public fun execute_payment_with_fee<T>(
        wallet: &mut AgentWallet<T>,
        cap: &mut SessionCap,
        amount: u64,
        recipient: address,
        sponsor_fee_amount: u64,
        sponsor_fee_recipient: address,
        walrus_blob_id: String,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let total_amount = amount + sponsor_fee_amount;
        authorize_spend(wallet, cap, total_amount, clock);

        let payment_coin = coin::take(&mut wallet.balance, amount, ctx);
        transfer::public_transfer(payment_coin, recipient);

        if (sponsor_fee_amount > 0) {
            let fee_coin = coin::take(&mut wallet.balance, sponsor_fee_amount, ctx);
            transfer::public_transfer(fee_coin, sponsor_fee_recipient);

            event::emit(SponsorFeePaid {
                wallet_id: object::id(wallet),
                amount: sponsor_fee_amount,
                recipient: sponsor_fee_recipient,
                walrus_blob_id,
            });
        };

        event::emit(PaymentExecuted {
            wallet_id: object::id(wallet),
            amount,
            recipient,
            walrus_blob_id,
        });
    }

    fun authorize_spend<T>(
        wallet: &AgentWallet<T>,
        cap: &mut SessionCap,
        amount: u64,
        clock: &Clock,
    ) {
        let current_time = clock::timestamp_ms(clock);

        // 1. Check expiration
        assert!(current_time <= cap.expires_at_ms, ESessionExpired);

        // 2. Check wallet match
        assert!(cap.wallet_id == object::id(wallet), ENotOwner);

        // 3. Check total spend limit
        assert!(cap.total_spent + amount <= cap.max_spend_total, EExceedsRateLimit);

        // 4. Check rate limit (spend per second)
        let time_elapsed_sec = (current_time - cap.last_spend_time_ms) / 1000;
        let allowed_spend = time_elapsed_sec * cap.max_spend_per_second;
        assert!(amount <= allowed_spend, EExceedsRateLimit);

        // 5. Check wallet balance
        assert!(balance::value(&wallet.balance) >= amount, EInsufficientBalance);

        // Update state
        cap.total_spent = cap.total_spent + amount;
        cap.last_spend_time_ms = current_time;
    }
}
