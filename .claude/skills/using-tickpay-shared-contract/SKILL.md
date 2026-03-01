---
name: using-tickpay-shared-contract
description: Integrates Tickpay streaming payments on Sui using the officially deployed shared contract. Use when the user wants to send payments on Sui, setup Tickpay, or pay a Sui address without deploying their own contract.
---

# Using Tickpay Shared Contract

Connect to the officially deployed Tickpay contract on Sui. No contract deployment needed — run one script to set up and start making streaming payments.

## Prerequisites

Install the following tools before running any scripts:

1. **sui CLI** — Sui command-line tool:

   ```bash
   # Follow the official guide:
   # https://docs.sui.io/guides/developer/getting-started/sui-install
   sui client envs   # verify installation
   ```

2. **jq** — JSON processor used by the scripts:

   ```bash
   brew install jq          # macOS
   apt-get install jq       # Ubuntu/Debian
   ```

3. **Active Sui address** — must be configured in the sui keystore:

   ```bash
   sui client active-address   # check current address
   sui client new-address ed25519  # create one if needed
   ```

## Quick Start

Run setup once to create all required on-chain resources:

```bash
cd .claude/skills/using-tickpay-shared-contract/scripts
chmod +x setup.sh execute_payment.sh
./setup.sh
```

No arguments needed. The official Tickpay Package ID is already embedded in the script.

The setup will:

1. Use your active `sui` address as the wallet owner
2. Request test SUI from faucet automatically (testnet only)
3. Create a Tickpay Wallet on-chain
4. Create a new agent address and a SessionCap authorizing it to spend
5. Save all configuration to `.tickpay-config.json`

## Making Payments

After setup, pay any Sui address with:

```bash
./execute_payment.sh --recipient <SUI_ADDRESS> --amount <MIST>
```

- `--recipient`: Destination Sui address (required)
- `--amount`: Amount in MIST, e.g. `1000000000` = 1 SUI (required)
- `--blob-id`: Optional Walrus blob ID for audit trail

All other parameters (wallet, session cap, package ID) load automatically from `.tickpay-config.json`.

## Full Example

```bash
cd .claude/skills/using-tickpay-shared-contract/scripts

# One-time setup — no arguments required
./setup.sh

# Deposit SUI into the Tickpay wallet to fund payments
# (replace WALLET_ID with the value printed by setup.sh)
sui client transfer-sui --to <WALLET_ID> --amount 5000000000 --gas-budget 10000000

# Pay any address
./execute_payment.sh --recipient 0xabc...123 --amount 1000000000
```

## Troubleshooting

**"Insufficient balance" error:**

- Fund the Tickpay wallet: `sui client transfer-sui --to <WALLET_ID> --amount 1000000000 --gas-budget 10000000`
- Or re-run setup to get faucet funds: `./setup.sh --force`

**"Unauthorized" or SessionCap expired:**

- Re-run: `./setup.sh --force`

**"sui CLI not found":**

- Install from: https://docs.sui.io/guides/developer/getting-started/sui-install

**"jq not found":**

- macOS: `brew install jq`
- Linux: `apt-get install jq`
