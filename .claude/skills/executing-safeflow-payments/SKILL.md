---
name: executing-safeflow-payments
description: Deploys a SafeFlow contract and executes streaming payments on Sui. Use when the user wants to deploy their own SafeFlow contract, set up their own wallet, or make payments via their own deployment.
---

# Executing SafeFlow Payments (Self-Deployed Contract)

This skill deploys your own SafeFlow contract and sets up streaming payments on Sui. Use this if you want full control over the contract. For the official shared contract, use the `safe-flow-sui-skill` skill instead.

## Prerequisites

Install the following tools before running any scripts:

1. **sui CLI** — Sui command-line tool:

   ```bash
   # Follow: https://docs.sui.io/guides/developer/getting-started/sui-install
   sui client envs   # verify installation
   ```

2. **jq** — JSON processor used by the scripts:

   ```bash
   brew install jq          # macOS
   apt-get install jq       # Ubuntu/Debian
   ```

3. **Active Sui address** with gas funds:

   ```bash
   sui client active-address
   sui client new-address ed25519  # create one if needed
   ```

## Step 1: Deploy the Contract

If you haven't deployed the SafeFlow contract yet:

```bash
cd sui/agent_wallet
sui client publish --gas-budget 100000000
```

Note the **Package ID** from the output (looks like `0x1234...abcd`).

## Step 2: One-Time Setup

```bash
cd .claude/skills/executing-safeflow-payments/scripts
chmod +x setup.sh execute_payment.sh
./setup.sh --package-id <YOUR_PACKAGE_ID>
```

The setup will:

1. Use your active `sui` address as the wallet owner
2. Request test SUI from faucet automatically (testnet only)
3. Create a SafeFlow Wallet on-chain
4. Create a dedicated agent address and SessionCap authorizing it to spend
5. Save all configuration to `.safeflow-config.json`

## Step 3: Make Payments

```bash
./execute_payment.sh --recipient <SUI_ADDRESS> --amount <MIST>
```

- `--recipient`: Destination Sui address (required)
- `--amount`: Amount in MIST, e.g. `1000000000` = 1 SUI (required)
- `--blob-id`: Optional Walrus blob ID for audit trail

All other parameters load automatically from `.safeflow-config.json`.

## Full Example

```bash
cd .claude/skills/executing-safeflow-payments/scripts

# Deploy contract (first time only)
# cd sui/agent_wallet && sui client publish --gas-budget 100000000

# One-time setup with your package ID
./setup.sh --package-id 0x1234...abcd

# Deposit SUI to fund the wallet
sui client transfer-sui --to <WALLET_ID> --amount 5000000000 --gas-budget 10000000

# Make payments
./execute_payment.sh --recipient 0x5678...efgh --amount 1000000000
```

## Troubleshooting

**"Package ID required" error:**

- Deploy the contract first: `cd sui/agent_wallet && sui client publish --gas-budget 100000000`

**"Insufficient balance" error:**

- Fund the SafeFlow wallet: `sui client transfer-sui --to <WALLET_ID> --amount 1000000000 --gas-budget 10000000`
- Or re-run setup for testnet faucet: `./setup.sh --package-id <id> --force`

**"Unauthorized" or SessionCap expired:**

- Re-run: `./setup.sh --package-id <id> --force`

**"sui CLI not found":**

- Install from: <https://docs.sui.io/guides/developer/getting-started/sui-install>

**"jq not found":**

- macOS: `brew install jq`
- Linux: `apt-get install jq`
