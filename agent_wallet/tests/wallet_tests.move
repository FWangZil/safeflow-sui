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
}
