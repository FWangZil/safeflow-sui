# @safeflow/sui-sdk

TypeScript SDK for SafeFlow Sui checkout agents.

## Current Execution Model

The preferred flow is Producer API driven:

1. Merchant creates a checkout session or direct intent.
2. Producer API resolves `executionRail`:
   - `auto` + allowlisted stablecoin without guard objects -> `native_gasless`
   - `auto` + guard request or guard objects -> `sponsored_guard`
3. Agent polls, verifies, ACKs, uploads Walrus evidence, executes, and reports result.

Direct `executePaymentWithEvidence` still exists for guarded contract calls, but demo agents should normally use `ProducerApiClient` plus the runner flow.

## Install In Monorepo

```bash
bun install
bun run build
bun run test
```

## Producer Client

```ts
import { ProducerApiClient } from '@safeflow/sui-sdk';

const producer = new ProducerApiClient({
  baseUrl: process.env.PRODUCER_API_BASE_URL!,
  apiKey: process.env.PRODUCER_API_KEY,
  signingSecret: process.env.PRODUCER_SIGNING_SECRET!,
});

const intent = await producer.createIntent({
  merchantOrderId: 'order_001',
  agentAddress: '0x...',
  recipient: '0x...',
  amountAtomic: 1_000_000,
  coinType: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
  executionRail: 'auto',
  currencySymbol: 'USDC',
  reason: 'demo checkout',
  expiresAtMs: Date.now() + 10 * 60 * 1000,
});
```

For guarded execution, include `walletId` and `sessionCapId`, or set `executionRail: 'sponsored_guard'`.

## Agent Execution Helpers

- `executeNativeGaslessStablecoinTransfer(...)`: submit native Sui stablecoin gasless transfer.
- `requestSponsor(...)` + `signAndSubmitSponsoredTransaction(...)`: submit dual-signed sponsored guard transaction.
- `executePaymentWithEvidence(...)`: direct guarded contract payment with Walrus evidence, mainly for compatibility and low-level tests.

## Skill Helpers

```ts
import {
  SafeFlowAgent,
  ProducerApiClient,
  createProducerApiSkills,
  createSafeFlowSkill,
} from '@safeflow/sui-sdk';
```

`createProducerApiSkills` exposes intent polling/result tools. `createSafeFlowSkill` exposes direct guarded payment execution for runtimes that still need the low-level path.
