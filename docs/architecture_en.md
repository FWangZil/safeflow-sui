# Technical Architecture (SafeFlow Sui Edition)

SafeFlow combines Sui checkout orchestration, native gasless stablecoin transfer, and `SessionCap`-guarded sponsored execution for agent-native payments with bounded risk.

For full multi-role sequence/state diagrams, see [`safeflow-e2e-role-flow.md`](./safeflow-e2e-role-flow.md).

## System Overview

SafeFlow separates three concerns:

- **business intent**: merchant checkout sessions and signed payment intents in Producer API;
- **simple stablecoin settlement**: native gasless transfer for allowlisted stablecoins;
- **guarded treasury execution**: human-owned `AgentWallet<T>` plus agent-owned `SessionCap`.

Producer API defaults to `executionRail: "auto"`:

| Case | Resolved rail |
|---|---|
| allowlisted stablecoin, no guard requirement | `native_gasless` |
| `requiresGuard=true` or guard object IDs present | `sponsored_guard` |
| explicit rail requested | requested rail, after validation |

## Core Components

### 0. Producer API

- Creates merchant checkout sessions and linked `PaymentIntent` records.
- Stores state in Postgres: merchants, agent allowances, checkout sessions, payment intents, sponsor attempts.
- Signs intents and exposes polling, ACK, result, and sponsor APIs.
- Resolves `executionRail=auto` before the agent executes.

### 1. Native Gasless Rail

- Used for simple allowlisted stablecoin transfers.
- Agent signs the transfer intent, but does not need SUI gas for the payment path.
- Best fit: merchant checkout where no `SessionCap` policy is required.

### 2. AgentWallet<T>

- Human-controlled shared object for guarded flows.
- Holds `Coin<T>` deposits, where `T` can be USDC or another configured coin type.
- Can only be spent through guarded Move entry points with a valid `SessionCap`.

### 3. SessionCap

- Owned capability object granted to a specific agent address.
- Encodes:
  - `max_spend_per_second`
  - `max_spend_total`
  - `expires_at_ms`
- Required only for `sponsored_guard` execution.

### 4. Sponsored Guard Rail

- Agent claims an intent, uploads Walrus evidence, then calls `POST /v1/intents/:intentId/sponsor`.
- Producer API validates the claimed agent, builds `execute_payment<T>` or `execute_payment_with_fee<T>`, sets sender to the agent, uses sponsor-owned gas, signs bytes, and returns sponsor signature.
- Agent signs the same bytes and submits the transaction with both signatures.
- Optional sponsor fee reimbursement is debited in the same stablecoin under the same `SessionCap`.

### 5. Walrus Audit Trail

- Agent uploads reasoning payload before execution.
- Success path stores a real `walrus_blob_id`.
- Degraded path, when enabled, stores `fallback:<sha256(payload)>`.
- Guarded rail emits `walrus_blob_id` in `PaymentExecuted`; both rails report it to Producer API for the checkout audit trail.

## OpenClaw Agent POV

1. Poll next intent from Producer API.
2. Verify signature, TTL, recipient, amount, coin type, and local policy.
3. ACK to claim execution right (`pending -> claimed`).
4. Upload reasoning to Walrus or produce a fallback marker.
5. Execute selected rail:
   - `native_gasless`: submit native gasless stablecoin transfer.
   - `sponsored_guard`: request sponsor bytes, agent-sign, submit dual-signed transaction.
6. Report `txDigest`, `walrusBlobId`, and status back to Producer API.

The agent executes policy; it does not define treasury policy.

## Security Model

1. **Key isolation**
   - Human treasury key is never exposed to agent runtime.
   - Agent only uses its local key for scoped execution.

2. **Automatic least-privilege rail selection**
   - Simple allowlisted transfers avoid custom guard complexity.
   - Guarded spend uses Move-enforced rate, total, expiry, and wallet binding.

3. **Sponsor blast-radius control**
   - Sponsor pays only execution gas for approved guarded intents.
   - Optional stablecoin fee reimbursement is explicit and subject to `SessionCap`.

4. **Auditability**
   - Every checkout records intent state, tx digest, and Walrus evidence reference.

## Why Sui Object Model

- Capability objects map cleanly to bounded agent authority.
- Shared/owned object separation maps to custody versus execution permission.
- Sui native gasless stablecoin support covers the simple checkout path without forcing every payment through a custom sponsor.
- PTB support makes sponsored guarded execution composable for advanced AgentPay flows.
