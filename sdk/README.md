# @tickpay/sui-sdk

This is the Sui SDK and Agent Skill package for Tickpay. It provides an easy way for AI Agents (like OpenClaw bots) to interact with Tickpay's streaming payment sessions on the Sui blockchain.

## Features

- **TickpayAgent**: A core wrapper around Sui client and keys to authorize and execute Tickpay sessions.
- **OpenClaw Skill**: A ready-to-use tool definition (`createTickpaySkill`) that can be directly registered into agent frameworks.

## Installation

You can install this SDK locally within the monorepo:

```bash
npm install @tickpay/sui-sdk@file:../sdk
```

## Usage

### As a standalone Agent

```typescript
import { TickpayAgent } from '@tickpay/sui-sdk';

const agent = new TickpayAgent({
    network: 'testnet',
    packageId: '0x_YOUR_PACKAGE_ID',
    // Optionally provide an existing secret key (Uint8Array)
    // secretKey: mySecretKey 
});

console.log(`Agent Address: ${agent.getAddress()}`);

// Execute a payment on behalf of a user's session
const result = await agent.executePayment(
    '0x_WALLET_ID',
    '0x_SESSION_CAP_ID',
    '0x_RECIPIENT_ADDRESS',
    1000000, // Amount in MIST
    'walrus_blob_id_or_empty'
);

console.log('Payment executed!', result.digest);
```

### As an OpenClaw Skill

```typescript
import { TickpayAgent, createTickpaySkill } from '@tickpay/sui-sdk';
import { Agent } from 'openclaw'; // Example agent framework

const tickpayAgent = new TickpayAgent({
    network: 'testnet',
    packageId: process.env.PACKAGE_ID
});

const tickpaySkill = createTickpaySkill(tickpayAgent);

const myBot = new Agent({
    name: 'TickpayBot',
    tools: [tickpaySkill]
});

// The bot can now automatically execute Tickpay payments when requested by the user!
```
