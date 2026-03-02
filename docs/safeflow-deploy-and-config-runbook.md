# SafeFlow Deployment & Config Runbook

This document records the full flow from contract deployment to local project config updates.

## What This Covers

1. Publish the Move package under `agent_wallet/`
2. Extract the new `PACKAGE_ID` from publish JSON
3. Update:
   - `agent_scripts/.env`
   - `web/.env.local`

## One-Command Script

From repo root:

```bash
chmod +x scripts/deploy_and_configure_safeflow.sh
./scripts/deploy_and_configure_safeflow.sh
```

Optional gas budget:

```bash
./scripts/deploy_and_configure_safeflow.sh --gas-budget 200000000
```

## What The Script Does

1. Verifies prerequisites: `sui`, `jq`
2. Backs up `agent_wallet/Published.toml` to `Published.toml.bak.<timestamp>`
3. Clears `Published.toml` (required when republishing same package locally)
4. Runs:

```bash
sui client publish --gas-budget <value> --json
```

5. Parses `PACKAGE_ID` from:
   - `.objectChanges[] | select(.type=="published") | .packageId`
   - Fallback: `.changed_objects[] ... | .objectId`
6. Writes:
   - `agent_scripts/.env` with `PACKAGE_ID=<id>`
   - `web/.env.local` with `NEXT_PUBLIC_PACKAGE_ID=<id>`

## Current Published Package (from latest run)

- `PACKAGE_ID`: `0xcc76747b518ea5d07255a26141fb5e0b81fcdd0dc1cc578a83f88adc003a6191`

## Start Frontend After Config

```bash
cd web
npm run dev
```

## Deposit Into AgentWallet

Do not transfer SUI directly to `walletId`. Use contract `deposit`:

```bash
chmod +x scripts/deposit_safeflow_wallet.sh
./scripts/deposit_safeflow_wallet.sh --wallet-id <WALLET_ID> --amount-mist 1000000000
```

Optional:

```bash
./scripts/deposit_safeflow_wallet.sh \
  --wallet-id <WALLET_ID> \
  --amount-mist 500000000 \
  --package-id <PACKAGE_ID> \
  --from-coin-id <GAS_COIN_ID> \
  --gas-budget 10000000
```

## Troubleshooting

1. `NativeCertsNotFound` / TLS errors:
   - Run publish outside restricted sandbox environment so system certs are available.

2. `Your package is already published`:
   - Ensure `Published.toml` is reset before publish (script already does this and makes a backup).

3. `PACKAGE_ID` parse failed:
   - Inspect files printed by script:
     - raw publish output
     - parsed JSON output
