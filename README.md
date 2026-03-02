# SafeFlow (Sui Edition) - Agent Air-Gap Wallet

**A smart agent "pocket money" and streaming payment protocol based on Sui and OpenClaw**

[中文版本 (Chinese Version)](./README_CN.md)

## Project Overview

SafeFlow (Sui Edition) is an on-chain fund management and streaming payment protocol specifically designed for **AI Agents (such as OpenClaw)**. In today's world where agents are becoming increasingly autonomous, a key challenge is how to securely authorize funds to an agent while preventing malicious overspending due to attacks like Prompt Injection (The Wallet Air-Gap).

This project leverages Sui's unique **Object Model** to solve this challenge by granting the agent a restricted `SessionCap` (session credential):

1. **Air-Gap Isolation**: Humans deposit funds into the `AgentWallet` shared object. The agent generates a private key locally and only holds the `SessionCap`.
2. **Strict Rate Limiting**: The `SessionCap` enforces a "maximum spend per second" and a "total spending limit" for the agent. Even if the agent goes rogue, it cannot instantly drain the wallet.
3. **Audit Trail with Walrus**: Agent scripts upload reasoning evidence to Walrus (testnet) before executing a payment. A degradation strategy is enabled by default; if the upload fails, it continues the payment with a `fallback:<sha256>` tag, ensuring the process is non-blocking and traceable.

## Core Features & Tech Stack

- **Agent Security Isolation Wallet**: `AgentWallet` and `SessionCap` mechanism implemented in Sui Move.
- **Second-Level Precision Rate Limiting**: Flow rate calculation based on Sui Clock timestamps (`max_spend_per_second`) within the Move contract.
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
│   ├── package.json
│   └── tsconfig.json
├── web/                    # Main dashboard for humans (Next.js)
│   ├── src/app/
│   │   ├── page.tsx        # Dashboard UI
│   │   ├── providers.tsx   # dApp Kit Providers
│   │   └── layout.tsx
│   ├── package.json
│   └── tailwind.config.ts
├── docs/                   # Project documentation
│   ├── architecture.md     # Technical architecture details
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
export WALRUS_PUBLISHER_URL=https://publisher.testnet.walrus.space
export WALRUS_AGGREGATOR_URL=https://aggregator.testnet.walrus.space
export WALRUS_EPOCHS=5
export WALRUS_DEGRADE_ON_UPLOAD_FAILURE=true

# Run Agent script (It will auto-generate/read local agent private key and print address)
npx tsx index.ts
```

Record the **Agent Address** printed in the console.

*(In actual use, have the Human Dashboard grant a `SessionCap` to this address, then fill in `walletId/sessionCapId` in the script to execute real payments.)*

### 3. Run Human Dashboard (Frontend)

```bash
cd web

# Install dependencies
bun install

# Specify the Package ID for the frontend to call Move contracts
export NEXT_PUBLIC_PACKAGE_ID=<YOUR_PACKAGE_ID>
export NEXT_PUBLIC_WALRUS_AGGREGATOR_URL=https://aggregator.testnet.walrus.space
export NEXT_PUBLIC_WALRUS_SITE_SUFFIX=.walrus.site

# Run development server
bun run dev
```

Open `http://localhost:3000` in your browser. Connect your Sui wallet, input the Agent Address from the previous step, and click the buttons for on-chain execution:

1. `create_wallet`
2. `create_session_cap`

You can then enter a payment transaction digest in the **Walrus Evidence Lookup** section to resolve and open the evidence link corresponding to the `walrus_blob_id`.

## Use Cases (Track Matching)

This project fits perfectly with two themes of the **Sui OpenClaw Hackathon**:

1. **Safety & Security (Track 1)**:
   By leveraging Move's Object capabilities and Walrus's decentralized storage, we've built an **injection-proof, traceable, and run-proof** agent isolation wallet. Humans maintain absolute control and auditing rights over funds.

2. **Local God Mode (Track 2)**:
   The OpenClaw agent runs locally and uses its assigned `SessionCap` to seamlessly pay for cloud LLM APIs or other Web3 services in the background, achieving true Local Autonomy.

## License

MIT License
