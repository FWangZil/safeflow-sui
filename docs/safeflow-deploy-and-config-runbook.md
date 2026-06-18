# SafeFlow Deployment & Config Runbook

This document records the current deployment/config flow for the Sui Move package, Producer API, agent runner, and web console.

## 1. Publish Move Package

From repo root:

```bash
chmod +x scripts/deploy_and_configure_safeflow.sh
./scripts/deploy_and_configure_safeflow.sh --gas-budget 200000000
```

The script:

1. backs up and clears `agent_wallet/Published.toml`;
2. runs `sui client publish --json`;
3. parses `PACKAGE_ID`;
4. writes `agent_scripts/.env`;
5. writes `web/.env.local`.

It does not configure Postgres or sponsor keys.

## 2. Configure Producer API

```bash
cd producer_api
bun install

export DATABASE_URL=postgres://postgres:postgres@localhost:5432/safeflow
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
export PACKAGE_ID=<SAFEFLOW_PACKAGE_ID>
export SPONSOR_SECRET_KEY=<SUI_SPONSOR_PRIVATE_KEY>
export SPONSOR_MAX_GAS_BUDGET=10000000
export SPONSOR_FEE_BPS=100
export SPONSOR_MIN_FEE_ATOMIC=0
export SPONSOR_FEE_RECIPIENT=<SPONSOR_STABLECOIN_FEE_ADDRESS>
export DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
export NATIVE_GASLESS_COIN_TYPES=$DEFAULT_COIN_TYPE

bun run migrate
bun run seed:demo
bun run dev
```

`SPONSOR_SECRET_KEY` is the SUI gas payer for sponsored guard transactions. Stablecoin sponsor fee reimbursement is configured by `SPONSOR_FEE_BPS` / `SPONSOR_MIN_FEE_ATOMIC`.

## 3. Configure Agent Runner

```bash
cd agent_scripts
bun install

export PACKAGE_ID=<SAFEFLOW_PACKAGE_ID>
export PRODUCER_API_BASE_URL=http://localhost:8787
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
export DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
export WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
export WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
export WALRUS_EPOCHS=5
export WALRUS_DEGRADE_ON_UPLOAD_FAILURE=true

bun run typecheck
```

## 4. Configure Web Console

```bash
cd web
bun install

export NEXT_PUBLIC_PACKAGE_ID=<SAFEFLOW_PACKAGE_ID>
export NEXT_PUBLIC_PRODUCER_API_BASE_URL=http://localhost:8787
export NEXT_PUBLIC_DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
export NEXT_PUBLIC_WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
export NEXT_PUBLIC_WALRUS_SITE_SUFFIX=.walrus.site

bun run dev
```

## 5. Funding Notes

- Native gasless rail does not need sponsor API and is intended for simple allowlisted stablecoin transfers.
- Sponsored guard rail needs sponsor SUI gas and an `AgentWallet<T>` funded with the target stablecoin.
- `scripts/deposit_safeflow_wallet.sh` is a legacy `Coin<SUI>` helper. For USDC, use the dashboard or a Sui PTB/CLI call to pass a `Coin<USDC>` object into `wallet::deposit<USDC>`.

## Troubleshooting

- `Your package is already published`: reset `agent_wallet/Published.toml` before publishing. The deploy script does this automatically.
- `PACKAGE_ID` parse failed: inspect the raw and parsed JSON paths printed by the deploy script.
- Sponsor endpoint `503`: sponsor key has no SUI gas coin.
- Sponsor endpoint `409`: intent is native gasless or has not been ACKed.
