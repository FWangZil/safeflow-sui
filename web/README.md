# SafeFlow Web Console

Next.js demo console for SafeFlow Sui checkout.

## What It Does

- Operator setup: create `AgentWallet<T>` and `SessionCap`.
- Merchant checkout: create checkout sessions through Producer API.
- Rail selection: default `auto`, with explicit `native_gasless` and `sponsored_guard` overrides.
- Audit trail: inspect intent state, Sui transaction digest, and Walrus evidence.
- Public checkout page: `/checkout?sessionId=...` polls Producer API status.

## Run Locally

```bash
bun install

export NEXT_PUBLIC_PACKAGE_ID=<SAFEFLOW_PACKAGE_ID>
export NEXT_PUBLIC_PRODUCER_API_BASE_URL=http://localhost:8787
export NEXT_PUBLIC_DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
export NEXT_PUBLIC_WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
export NEXT_PUBLIC_WALRUS_SITE_SUFFIX=.walrus.site

bun run dev
```

Open `http://localhost:3000`.

## Checks

```bash
bun run lint
bun run build
```
