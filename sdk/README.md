# @safeflow/sui-sdk

This is the Sui SDK and Agent Skill package for SafeFlow. It provides an easy way for AI Agents (like OpenClaw bots) to interact with SafeFlow's streaming payment sessions on the Sui blockchain.

## Features

- **SafeFlowAgent**: A core wrapper around Sui client and keys to authorize and execute SafeFlow sessions.
- **OpenClaw Skill**: A ready-to-use tool definition (`createSafeFlowSkill`) that can be directly registered into agent frameworks.
- **Walrus testnet integration**: Upload reasoning payloads to Walrus and pass real `walrus_blob_id` to on-chain payment events.
- **Producer API Client**: `ProducerApiClient` for fetching/acking/reporting signed `PaymentIntent`s.

## Installation

You can install this SDK locally within the monorepo:

```bash
npm install @safeflow/sui-sdk@file:../sdk
```

## Usage

### As a standalone Agent

```typescript
import { SafeFlowAgent } from '@safeflow/sui-sdk';

const agent = new SafeFlowAgent({
    network: 'testnet',
    packageId: '0x_YOUR_PACKAGE_ID',
    // Optionally provide an existing secret key (Uint8Array)
    // secretKey: mySecretKey 
});

console.log(`Agent Address: ${agent.getAddress()}`);

// Execute payment and auto-upload evidence to Walrus (with fallback hash if enabled)
const result = await agent.executePaymentWithEvidence({
    walletId: '0x_WALLET_ID',
    sessionCapId: '0x_SESSION_CAP_ID',
    recipient: '0x_RECIPIENT_ADDRESS',
    amount: 1000000, // Amount in MIST
    reasoning: 'Paying for LLM API call',
    mode: 'success',
    walrusConfig: {
        publisherUrl: 'https://publisher.walrus-testnet.walrus.space',
        aggregatorUrl: 'https://aggregator.walrus-testnet.walrus.space',
        epochs: 5,
    },
    degradeOnUploadFailure: true,
});

console.log('Payment executed!', result.digest, result.walrusBlobId, result.uploadStatus);
```

### As an OpenClaw Skill

```typescript
import {
  SafeFlowAgent,
  createSafeFlowSkill,
  createProducerApiSkills,
  ProducerApiClient
} from '@safeflow/sui-sdk';
import { Agent } from 'openclaw'; // Example agent framework

const safeFlowAgent = new SafeFlowAgent({
    network: 'testnet',
    packageId: process.env.PACKAGE_ID
});

const safeFlowSkill = createSafeFlowSkill(safeFlowAgent);
const producerClient = new ProducerApiClient({
    baseUrl: process.env.PRODUCER_API_BASE_URL!,
    signingSecret: process.env.PRODUCER_SIGNING_SECRET!,
});
const producerSkills = createProducerApiSkills(producerClient);

const myBot = new Agent({
    name: 'SafeFlowBot',
    tools: [safeFlowSkill, ...producerSkills]
});

// The bot can now automatically execute SafeFlow payments when requested by the user!
```
