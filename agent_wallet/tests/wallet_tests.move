#[test_only]
module agent_wallet::wallet_tests {
    use sui::test_scenario::{Self};
    use sui::coin::{Self};
    use sui::sui::SUI;
    use sui::clock::{Self};
    use std::string;
    use agent_wallet::wallet::{Self, AgentWallet, SessionCap};

    const HUMAN: address = @0xA;
    const AGENT: address = @0xB;
    const RECIPIENT: address = @0xC;
    const SPONSOR: address = @0xD;
    const EExceedsRateLimit: u64 = 1;
    const EInsufficientBalance: u64 = 2;
    const ESessionExpired: u64 = 3;

    public struct TEST_USDC has drop {}

    #[test]
    fun test_wallet_creation_and_payment() {
        let mut scenario_val = test_scenario::begin(HUMAN);
        let scenario = &mut scenario_val;

        // 1. Human creates wallet
        test_scenario::next_tx(scenario, HUMAN);
        {
            wallet::create_wallet<SUI>(test_scenario::ctx(scenario));
        };

        // 2. Human deposits 10 SUI into wallet and creates a SessionCap for Agent
        test_scenario::next_tx(scenario, HUMAN);
        {
            let mut agent_wallet = test_scenario::take_shared<AgentWallet<SUI>>(scenario);
            let coin = coin::mint_for_testing<SUI>(10_000_000_000, test_scenario::ctx(scenario));
            wallet::deposit(&mut agent_wallet, coin);

            // Create a clock for testing
            let mut clock = clock::create_for_testing(test_scenario::ctx(scenario));
            clock::set_for_testing(&mut clock, 1000); // 1 second

            // Create cap: 1 SUI per second, 5 SUI total, expires in 100 seconds
            wallet::create_session_cap(
                &agent_wallet,
                AGENT,
                1_000_000_000, // 1 SUI per sec
                5_000_000_000, // 5 SUI total
                100_000,       // Expires at 100s
                &clock,
                test_scenario::ctx(scenario)
            );

            test_scenario::return_shared(agent_wallet);
            clock::destroy_for_testing(clock);
        };

        // 3. Agent executes a payment using the cap
        test_scenario::next_tx(scenario, AGENT);
        {
            let mut agent_wallet = test_scenario::take_shared<AgentWallet<SUI>>(scenario);
            let mut cap = test_scenario::take_from_sender<SessionCap>(scenario);

            let mut clock = clock::create_for_testing(test_scenario::ctx(scenario));
            // Fast forward 2 seconds (time is now 3000ms)
            clock::set_for_testing(&mut clock, 3000);

            // Agent pays 1.5 SUI (allowed since 2 seconds passed, max allowed is 2 SUI)
            let blob_id = string::utf8(b"blob_123");
            wallet::execute_payment<SUI>(
                &mut agent_wallet,
                &mut cap,
                1_500_000_000,
                RECIPIENT,
                blob_id,
                &clock,
                test_scenario::ctx(scenario)
            );

            test_scenario::return_shared(agent_wallet);
            test_scenario::return_to_sender(scenario, cap);
            clock::destroy_for_testing(clock);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    fun test_generic_usdc_style_coin_payment() {
        let mut scenario_val = test_scenario::begin(HUMAN);
        let scenario = &mut scenario_val;

        test_scenario::next_tx(scenario, HUMAN);
        {
            wallet::create_wallet<TEST_USDC>(test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, HUMAN);
        {
            let mut agent_wallet = test_scenario::take_shared<AgentWallet<TEST_USDC>>(scenario);
            let coin = coin::mint_for_testing<TEST_USDC>(25_000_000, test_scenario::ctx(scenario));
            wallet::deposit(&mut agent_wallet, coin);

            let mut clock = clock::create_for_testing(test_scenario::ctx(scenario));
            clock::set_for_testing(&mut clock, 1_000);

            wallet::create_session_cap(
                &agent_wallet,
                AGENT,
                5_000_000,
                10_000_000,
                100_000,
                &clock,
                test_scenario::ctx(scenario)
            );

            test_scenario::return_shared(agent_wallet);
            clock::destroy_for_testing(clock);
        };

        test_scenario::next_tx(scenario, AGENT);
        {
            let mut agent_wallet = test_scenario::take_shared<AgentWallet<TEST_USDC>>(scenario);
            let mut cap = test_scenario::take_from_sender<SessionCap>(scenario);
            let mut clock = clock::create_for_testing(test_scenario::ctx(scenario));
            clock::set_for_testing(&mut clock, 3_000);

            wallet::execute_payment<TEST_USDC>(
                &mut agent_wallet,
                &mut cap,
                5_000_000,
                RECIPIENT,
                string::utf8(b"blob_usdc"),
                &clock,
                test_scenario::ctx(scenario)
            );

            test_scenario::return_shared(agent_wallet);
            test_scenario::return_to_sender(scenario, cap);
            clock::destroy_for_testing(clock);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    fun test_usdc_payment_with_sponsor_fee() {
        let mut scenario_val = test_scenario::begin(HUMAN);
        let scenario = &mut scenario_val;
        setup_usdc_wallet_and_cap(scenario, 10_000_000, 10_000_000, 6_000_000, 100_000);

        test_scenario::next_tx(scenario, AGENT);
        {
            let mut agent_wallet = test_scenario::take_shared<AgentWallet<TEST_USDC>>(scenario);
            let mut cap = test_scenario::take_from_sender<SessionCap>(scenario);
            let mut clock = clock::create_for_testing(test_scenario::ctx(scenario));
            clock::set_for_testing(&mut clock, 3_000);

            wallet::execute_payment_with_fee<TEST_USDC>(
                &mut agent_wallet,
                &mut cap,
                4_000_000,
                RECIPIENT,
                1_000_000,
                SPONSOR,
                string::utf8(b"blob_with_fee"),
                &clock,
                test_scenario::ctx(scenario)
            );

            test_scenario::return_shared(agent_wallet);
            test_scenario::return_to_sender(scenario, cap);
            clock::destroy_for_testing(clock);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = EExceedsRateLimit, location = agent_wallet::wallet)]
    fun test_payment_with_fee_aborts_when_total_limit_exceeded() {
        let mut scenario_val = test_scenario::begin(HUMAN);
        let scenario = &mut scenario_val;
        setup_usdc_wallet_and_cap(scenario, 10_000_000, 10_000_000, 4_500_000, 100_000);

        test_scenario::next_tx(scenario, AGENT);
        {
            let mut agent_wallet = test_scenario::take_shared<AgentWallet<TEST_USDC>>(scenario);
            let mut cap = test_scenario::take_from_sender<SessionCap>(scenario);
            let mut clock = clock::create_for_testing(test_scenario::ctx(scenario));
            clock::set_for_testing(&mut clock, 3_000);

            wallet::execute_payment_with_fee<TEST_USDC>(
                &mut agent_wallet,
                &mut cap,
                4_000_000,
                RECIPIENT,
                1_000_000,
                SPONSOR,
                string::utf8(b"too_much_with_fee"),
                &clock,
                test_scenario::ctx(scenario)
            );

            test_scenario::return_shared(agent_wallet);
            test_scenario::return_to_sender(scenario, cap);
            clock::destroy_for_testing(clock);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = EExceedsRateLimit, location = agent_wallet::wallet)]
    fun test_payment_aborts_when_rate_limit_exceeded() {
        let mut scenario_val = test_scenario::begin(HUMAN);
        let scenario = &mut scenario_val;
        setup_usdc_wallet_and_cap(scenario, 10_000_000, 1_000_000, 10_000_000, 100_000);

        test_scenario::next_tx(scenario, AGENT);
        {
            let mut agent_wallet = test_scenario::take_shared<AgentWallet<TEST_USDC>>(scenario);
            let mut cap = test_scenario::take_from_sender<SessionCap>(scenario);
            let mut clock = clock::create_for_testing(test_scenario::ctx(scenario));
            clock::set_for_testing(&mut clock, 1_500);

            wallet::execute_payment<TEST_USDC>(
                &mut agent_wallet,
                &mut cap,
                1_000_000,
                RECIPIENT,
                string::utf8(b"too_fast"),
                &clock,
                test_scenario::ctx(scenario)
            );

            test_scenario::return_shared(agent_wallet);
            test_scenario::return_to_sender(scenario, cap);
            clock::destroy_for_testing(clock);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = EExceedsRateLimit, location = agent_wallet::wallet)]
    fun test_payment_aborts_when_total_limit_exceeded() {
        let mut scenario_val = test_scenario::begin(HUMAN);
        let scenario = &mut scenario_val;
        setup_usdc_wallet_and_cap(scenario, 10_000_000, 10_000_000, 2_000_000, 100_000);

        test_scenario::next_tx(scenario, AGENT);
        {
            let mut agent_wallet = test_scenario::take_shared<AgentWallet<TEST_USDC>>(scenario);
            let mut cap = test_scenario::take_from_sender<SessionCap>(scenario);
            let mut clock = clock::create_for_testing(test_scenario::ctx(scenario));
            clock::set_for_testing(&mut clock, 3_000);

            wallet::execute_payment<TEST_USDC>(
                &mut agent_wallet,
                &mut cap,
                3_000_000,
                RECIPIENT,
                string::utf8(b"too_much_total"),
                &clock,
                test_scenario::ctx(scenario)
            );

            test_scenario::return_shared(agent_wallet);
            test_scenario::return_to_sender(scenario, cap);
            clock::destroy_for_testing(clock);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = ESessionExpired, location = agent_wallet::wallet)]
    fun test_payment_aborts_when_session_expired() {
        let mut scenario_val = test_scenario::begin(HUMAN);
        let scenario = &mut scenario_val;
        setup_usdc_wallet_and_cap(scenario, 10_000_000, 10_000_000, 10_000_000, 2_000);

        test_scenario::next_tx(scenario, AGENT);
        {
            let mut agent_wallet = test_scenario::take_shared<AgentWallet<TEST_USDC>>(scenario);
            let mut cap = test_scenario::take_from_sender<SessionCap>(scenario);
            let mut clock = clock::create_for_testing(test_scenario::ctx(scenario));
            clock::set_for_testing(&mut clock, 3_000);

            wallet::execute_payment<TEST_USDC>(
                &mut agent_wallet,
                &mut cap,
                1_000_000,
                RECIPIENT,
                string::utf8(b"expired"),
                &clock,
                test_scenario::ctx(scenario)
            );

            test_scenario::return_shared(agent_wallet);
            test_scenario::return_to_sender(scenario, cap);
            clock::destroy_for_testing(clock);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    #[expected_failure(abort_code = EInsufficientBalance, location = agent_wallet::wallet)]
    fun test_payment_aborts_when_wallet_balance_insufficient() {
        let mut scenario_val = test_scenario::begin(HUMAN);
        let scenario = &mut scenario_val;
        setup_usdc_wallet_and_cap(scenario, 1_000_000, 10_000_000, 10_000_000, 100_000);

        test_scenario::next_tx(scenario, AGENT);
        {
            let mut agent_wallet = test_scenario::take_shared<AgentWallet<TEST_USDC>>(scenario);
            let mut cap = test_scenario::take_from_sender<SessionCap>(scenario);
            let mut clock = clock::create_for_testing(test_scenario::ctx(scenario));
            clock::set_for_testing(&mut clock, 3_000);

            wallet::execute_payment<TEST_USDC>(
                &mut agent_wallet,
                &mut cap,
                2_000_000,
                RECIPIENT,
                string::utf8(b"insufficient_balance"),
                &clock,
                test_scenario::ctx(scenario)
            );

            test_scenario::return_shared(agent_wallet);
            test_scenario::return_to_sender(scenario, cap);
            clock::destroy_for_testing(clock);
        };

        test_scenario::end(scenario_val);
    }

    fun setup_usdc_wallet_and_cap(
        scenario: &mut test_scenario::Scenario,
        deposit_amount: u64,
        max_spend_per_second: u64,
        max_spend_total: u64,
        expires_at_ms: u64,
    ) {
        test_scenario::next_tx(scenario, HUMAN);
        {
            wallet::create_wallet<TEST_USDC>(test_scenario::ctx(scenario));
        };

        test_scenario::next_tx(scenario, HUMAN);
        {
            let mut agent_wallet = test_scenario::take_shared<AgentWallet<TEST_USDC>>(scenario);
            let coin = coin::mint_for_testing<TEST_USDC>(deposit_amount, test_scenario::ctx(scenario));
            wallet::deposit(&mut agent_wallet, coin);

            let mut clock = clock::create_for_testing(test_scenario::ctx(scenario));
            clock::set_for_testing(&mut clock, 1_000);

            wallet::create_session_cap(
                &agent_wallet,
                AGENT,
                max_spend_per_second,
                max_spend_total,
                expires_at_ms,
                &clock,
                test_scenario::ctx(scenario)
            );

            test_scenario::return_shared(agent_wallet);
            clock::destroy_for_testing(clock);
        };
    }
}
