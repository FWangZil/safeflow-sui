# Technical Architecture (SafeFlow Sui Edition)

This document explains how SafeFlow combines Sui's object model with OpenClaw to deliver agent-native payments with bounded risk.

For full multi-role sequence/state diagrams, see: [`safeflow-e2e-role-flow.md`](./safeflow-e2e-role-flow.md).

## System Overview

SafeFlow separates:
- **fund custody** (human-owned AgentWallet), and
- **execution capability** (agent-owned SessionCap).

The contract enforces spend rate/total/expiry on-chain, while the app layer provides signed intents and execution orchestration.

## Core Components

### 0. Producer API (Intent Producer)
- Creates and signs `PaymentIntent` (recipient, amount, reason, expiry).
- Exposes polling/ack/result APIs.
- Maintains state transitions: `pending -> claimed -> executed/failed/expired`.

### 1. AgentWallet (Shared Object)
- Human-controlled on-chain treasury object.
- Receives deposits.
- Can only be spent via valid execution path with SessionCap checks.

### 2. SessionCap (Owned Capability Object)
- Granted by human to a specific agent address.
- Encodes:
  - `max_spend_per_second`
  - `max_spend_total`
  - `expires_at_ms`
- Required by `execute_payment(...)`.

### 3. Walrus Audit Trail
- Agent uploads reasoning payload before payment.
- Success path: real `walrus_blob_id`.
- Degraded path (enabled by default): `fallback:<sha256(payload)>`.
- `walrus_blob_id` is emitted on-chain in `PaymentExecuted` event.

### 4. OpenClaw Agent POV (Executor Loop)
1. Poll next intent from Producer API.
2. Verify signature + TTL + local policy.
3. ACK to claim execution right (`pending -> claimed`).
4. Execute payment via `execute_payment(...)` with SessionCap constraints.
5. Upload/report Walrus evidence and submit execution result.

The agent executes policy; it does not define treasury policy.

## Security Model

1. **Key isolation**
- Human treasury key is never exposed to agent runtime.
- Agent only uses its local key for scoped execution.

2. **Blast-radius control**
- On-chain SessionCap constraints bound damage even under prompt injection.

3. **Auditability**
- Every payment carries evidence reference (`walrus_blob_id`).

4. **Operational recovery**
- Human can stop future spending by revoking/rotating policy objects (extension path).

## Why Sui Object Model

- Capability pattern is native and explicit.
- Shared/owned object separation maps directly to custody-vs-execution.
- PTB and low-cost execution fit micro-payment automation.
