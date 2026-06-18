# SafeFlow (Sui Edition) - Gasless Checkout + AgentPay Guard

**AI-agent-controlled spending with merchant stablecoin checkout on Sui**

[中文版本 (Chinese Version)](./README_CN.md)

## Project Overview

SafeFlow (Sui Edition) is an on-chain checkout and controlled payment demo for **AI Agents (such as OpenClaw)**. The product goal is to let an agent complete stablecoin checkout autonomously while keeping treasury policy, spending limits, gas sponsorship, and audit evidence under operator control.

Current execution is split into two rails:

1. **Native gasless stablecoin checkout**: simple allowlisted stablecoin payments use Sui native gasless transfer, so the agent does not need SUI gas for that path.
2. **Sponsored AgentPay Guard**: complex payments use `AgentWallet<T>` + `SessionCap` and a sponsor-paid `execute_payment<T>` / `execute_payment_with_fee<T>` transaction.
3. **Walrus audit trail**: agent scripts upload reasoning evidence to Walrus before execution, or record `fallback:<sha256>` when degraded mode is enabled.

## OpenClaw Agent POV

From the OpenClaw runtime perspective, SafeFlow is a controlled checkout execution loop, not a hot-wallet transfer bot:

1. Poll one assigned checkout payment intent from Producer API.
2. Verify signature + TTL + local policy (recipient/amount).
3. ACK intent (`pending -> claimed`) to avoid duplicate consumption.
4. Upload reasoning to Walrus (or fallback marker when degraded).
5. Execute by rail:
   - `native_gasless`: submit a Sui native gasless stablecoin `balance::send_funds<CoinType>` transfer.
   - `sponsored_guard`: request a sponsored guarded transaction from Producer API. When a sponsor fee is configured, the Move call is `execute_payment_with_fee<CoinType>` and the stablecoin fee is debited under the same `SessionCap`.
6. Sign and submit the selected transaction path.
7. Report final result back to Producer API (`executed/failed/expired`).

Key point: **Agent autonomy is preserved, but treasury policy is never delegated to the agent.**

Producer API defaults checkout creation to `executionRail: "auto"`: simple allowlisted stablecoin payments use native gasless, while requests marked `requiresGuard: true` or carrying guard object IDs resolve to sponsored `SessionCap` execution.

## Fast Verification Checklist

You can verify the full value proposition in minutes:

1. Check Producer intent status progression (`pending -> claimed -> executed/failed/expired`).
2. Check on-chain transaction digest and `PaymentExecuted` event fields.
3. Check `walrus_blob_id` evidence link (or explicit `fallback:` degradation marker).
4. Confirm rate-limit / total-limit enforcement by contract when inputs are abusive.

## Demo

[![Watch the Demo - SafeFlow on Sui](https://img.youtube.com/vi/pAd18KE81DI/hqdefault.jpg)](https://www.youtube.com/watch?v=pAd18KE81DI)

- YouTube demo: [SafeFlow on Sui: Secure Autonomous Payments for OpenClaw Agents (Walrus-Auditable E2E Demo)](https://www.youtube.com/watch?v=pAd18KE81DI)

https://github.com/user-attachments/assets/cfff0f3e-d586-4c85-b3ef-c7aade79fb3c

## Documentation Map

- Architecture: [`docs/architecture_en.md`](./docs/architecture_en.md)
- Full E2E role flow diagram: [`docs/safeflow-e2e-role-flow.md`](./docs/safeflow-e2e-role-flow.md)
- E2E runbook: [`docs/safeflow-e2e-producer-consumer-runbook.md`](./docs/safeflow-e2e-producer-consumer-runbook.md)
- Deploy/config runbook: [`docs/safeflow-deploy-and-config-runbook.md`](./docs/safeflow-deploy-and-config-runbook.md)
- OpenClaw/Agent skill install guide: [`docs/safeflow-agent-skill-install.md`](./docs/safeflow-agent-skill-install.md)

## Install SafeFlow Agent Skill

The standalone skill repository is:

- [`FWangZil/safe-flow-sui-skill`](https://github.com/FWangZil/safe-flow-sui-skill)

OpenClaw and other compatible agent runtimes can install this skill with either command:

```bash
npx skills add FWangZil/safe-flow-sui-skill
```

or

```bash
npx clawhub@latest install safe-flow-sui-skill
```

## Core Features & Tech Stack

- **Agent Security Isolation Wallet**: `AgentWallet` and `SessionCap` mechanism implemented in Sui Move.
- **Second-Level Precision Rate Limiting**: Flow rate calculation based on Sui Clock timestamps (`max_spend_per_second`) within the Move contract.
- **Dual Gasless Rails**: Simple allowlisted stablecoin checkout uses Sui native gasless transfer; complex AgentPay Guard checkout uses sponsored `SessionCap` execution with optional same-coin sponsor fee reimbursement.
- **Auditable Payment Intent (Walrus Integration)**: Real uploads to Walrus with `walrus_blob_id` recorded in on-chain events, queryable by transaction digest in the frontend.
- **Local Agent Execution**: Node.js/TypeScript scripts based on `@mysten/sui.js`, simulating OpenClaw agent running silently and paying on demand.
- **Human Dashboard**: A frontend built with Next.js + Tailwind CSS + Sui dApp Kit for managing funds and authorizations.

| Component | Technology |
|-----------|------------|
| Blockchain | Sui (Testnet) |
| Smart Contracts | Sui Move (2024.beta Edition) |
| Agent Scripts | Node.js, TypeScript, `@mysten/sui.js` |
| Frontend | Next.js 16, React, Tailwind CSS, `@mysten/dapp-kit` |

## Directory Structure

```
.
├── agent_wallet/           # Sui Move smart contracts
│   ├── sources/
│   │   └── wallet.move     # Core wallet and authorization logic
│   ├── tests/
│   │   └── wallet_tests.move # Unit tests
│   └── Move.toml
├── agent_scripts/          # OpenClaw Agent local execution scripts & tools
│   ├── index.ts            # Agent key management & PTB payment logic
│   ├── create_intent.ts    # Create producer-side test payment intents
│   ├── e2e_runner.ts       # Poll/ack/execute/report intent runner
│   ├── package.json
│   └── tsconfig.json
├── producer_api/           # Postgres checkout, intent, and sponsor API
│   ├── migrations/
│   ├── scripts/
│   ├── server.mjs
│   └── package.json
├── web/                    # Main dashboard for humans (Next.js)
│   ├── src/app/
│   │   ├── page.tsx        # Dashboard UI
│   │   ├── providers.tsx   # dApp Kit Providers
│   │   └── layout.tsx
│   ├── package.json
│   └── tailwind.config.ts
├── docs/                   # Project documentation
│   ├── architecture.md     # Technical architecture details
│   ├── safeflow-e2e-role-flow.md # Full E2E role flow with diagrams
│   ├── safeflow-e2e-producer-consumer-runbook.md # E2E operation runbook
│   ├── safeflow-deploy-and-config-runbook.md # Deploy/config runbook
│   └── hackathon_intro.md  # Hackathon submission introduction
└── README.md               # This file
```

## Installation & Running

### 1. Deploy Sui Move Contract

```bash
cd agent_wallet

# Build contract
sui move build

# Run tests
sui move test

# Publish to testnet (Ensure your sui client is configured for testnet with SUI tokens)
sui client publish --gas-budget 100000000
```

After successful deployment, please record the `Package ID`.

### 2. Run Agent Script

```bash
cd agent_scripts

# Install dependencies
bun install

# Specify the Package ID from deployment (and configure Walrus testnet)
export PACKAGE_ID=<YOUR_PACKAGE_ID>
export WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
export WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
export WALRUS_EPOCHS=5
export WALRUS_DEGRADE_ON_UPLOAD_FAILURE=true

# Run Agent script (It will auto-generate/read local agent private key and print address)
npx tsx index.ts
```

Record the **Agent Address** printed in the console.

*(In actual use, have the Human Dashboard grant a `SessionCap` to this address, then fill in `walletId/sessionCapId` in the script to execute real payments.)*

### 3. Run Producer API (Checkout + Sponsor Producer)

```bash
cd producer_api

bun install

export DATABASE_URL=postgres://postgres:postgres@localhost:5432/safeflow
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
export PACKAGE_ID=<YOUR_PACKAGE_ID>
export SPONSOR_SECRET_KEY=<SPONSOR_SUI_PRIVATE_KEY>
export SPONSOR_FEE_BPS=100
export SPONSOR_MIN_FEE_ATOMIC=0
export SPONSOR_FEE_RECIPIENT=<SPONSOR_STABLECOIN_FEE_ADDRESS>
export NATIVE_GASLESS_COIN_TYPES=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
export NEXT_PUBLIC_APP_URL=http://localhost:3000
export DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
export DEFAULT_CURRENCY_SYMBOL=USDC
export DEFAULT_CURRENCY_DECIMALS=6
export DEMO_PAYOUT_ADDRESS=<MERCHANT_PAYOUT_ADDRESS>
export DEMO_AGENT_ADDRESS=<AGENT_ADDRESS>
export DEMO_WALLET_ID=<WALLET_ID>
export DEMO_SESSION_CAP_ID=<SESSION_CAP_ID>

bun run migrate
bun run seed:demo
bun run dev
```

`seed:demo` prints the merchant API key once. Use it in the dashboard or checkout API as `x-api-key`.

### 4. Create Checkout Session + Run Agent E2E Runner

```bash
cd agent_scripts

export PRODUCER_API_BASE_URL=http://localhost:8787
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
export DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC

# Create a checkout session from the web dashboard or:
curl -X POST http://localhost:8787/v1/checkout/sessions \
  -H "content-type: application/json" \
  -H "x-api-key: <MERCHANT_API_KEY>" \
  -d '{
    "merchantOrderId": "order-demo-001",
    "executionRail": "auto",
    "amountAtomic": 1000000,
    "reason": "demo USDC checkout"
  }'

# Run polling consumer
bun run typecheck
bunx tsx e2e_runner.ts --poll-ms 3000
```

### 5. Run Human Dashboard (Frontend)

```bash
cd web

# Install dependencies
bun install

# Specify the Package ID for the frontend to call Move contracts
export NEXT_PUBLIC_PACKAGE_ID=<YOUR_PACKAGE_ID>
export NEXT_PUBLIC_WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
export NEXT_PUBLIC_WALRUS_SITE_SUFFIX=.walrus.site
export NEXT_PUBLIC_PRODUCER_API_BASE_URL=http://localhost:8787
export NEXT_PUBLIC_DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC

# Run development server
bun run dev
```

Open `http://localhost:3000` in your browser. Connect your Sui wallet, input the Agent Address from the previous step, and click the buttons for on-chain execution:

1. `create_wallet`
2. `create_session_cap`

You can create a merchant checkout session, leave the rail on `auto` or explicitly choose `native_gasless` / `sponsored_guard`, open the public `/checkout?sessionId=...` page, run the agent, and watch the session progress from `created/claimed` to `executed` with `txDigest` + `walrus_blob_id`.

Use `native_gasless` for simple allowlisted stablecoin recipient transfers. Use `sponsored_guard` when you need `AgentWallet<T>` / `SessionCap` rate limits, total limits, expiry, and wallet binding.

For a role-by-role sequence diagram and state machine, see [`docs/safeflow-e2e-role-flow.md`](./docs/safeflow-e2e-role-flow.md).

## Use Cases (Track Matching)

This project fits perfectly with two themes of the **Sui OpenClaw Hackathon**:

1. **Safety & Security (Track 1)**:
   By leveraging Move's Object capabilities and Walrus's decentralized storage, we've built an **injection-proof, traceable, and run-proof** agent isolation wallet. Humans maintain absolute control and auditing rights over funds.

2. **Local God Mode (Track 2)**:
   The OpenClaw agent runs locally and uses its assigned `SessionCap` to seamlessly pay for cloud LLM APIs or other Web3 services in the background, achieving true Local Autonomy.

## License

MIT License
