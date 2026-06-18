---
name: safe-flow-sui-skill
description: Use when running SafeFlow Sui checkout demos against Producer API, native gasless stablecoin rail, sponsored AgentPay Guard rail, owner-assisted SessionCap provisioning, Walrus evidence, or shared package runtime setup.
---

# Using SafeFlow Sui Checkout

Operate this as a **test skill** for real-world owner/agent collaboration on SafeFlow Sui.

Default Producer API endpoint:

- `https://producer.safeflow.space`

Default coin:

- Circle Sui testnet USDC: `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC`

## Rail Selection

Producer API supports `executionRail: "auto"`:

| Case | Rail |
|---|---|
| allowlisted stablecoin, no guard objects | `native_gasless` |
| `requiresGuard` requested or wallet/session cap objects included | `sponsored_guard` |
| explicit `native_gasless` or `sponsored_guard` | use requested rail |

Use native gasless for simple P2P stablecoin checkout. Use sponsored guard when the payment must consume from `AgentWallet<T>` under `SessionCap` limits, or when sponsor stablecoin fee reimbursement is required.

## Quick Start: Producer API E2E

Run the default auto rail test:

```bash
cd .claude/skills/safe-flow-sui-skill/scripts
./test_publish_api_flow.sh \
  --publish-api-base-url https://producer.safeflow.space \
  --agent-address <AGENT_ADDRESS> \
  --recipient <RECIPIENT_ADDRESS> \
  --amount-atomic 1000000
```

Run guarded AgentPay flow:

```bash
cd .claude/skills/safe-flow-sui-skill/scripts
./test_publish_api_flow.sh \
  --publish-api-base-url https://producer.safeflow.space \
  --recipient <RECIPIENT_ADDRESS> \
  --requires-guard \
  --wallet-id <WALLET_ID> \
  --session-cap-id <SESSION_CAP_ID>
```

## Owner-Handoff for Guarded Flow

1. Bootstrap agent context and owner handoff instructions:

```bash
cd .claude/skills/safe-flow-sui-skill/scripts
chmod +x ./*.sh
./bootstrap_owner_handoff.sh --portal-url https://dash.safeflow.space
```

2. Ask owner to:
- fund agent SUI gas only when local direct transactions are needed;
- open the portal URL and finish stablecoin wallet pre-deposit/config;
- return `walletId` and `sessionCapId`.

3. Save owner-provided runtime config:

```bash
./save_owner_config.sh \
  --wallet-id <WALLET_ID> \
  --session-cap-id <SESSION_CAP_ID> \
  --coin-type 0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
```

4. Run guarded Producer API flow:

```bash
./test_publish_api_flow.sh --recipient <RECIPIENT_ADDRESS> --requires-guard
```

`test_publish_api_flow.sh` and its `--publish-api-base-url` flag keep the older script naming for compatibility, but the endpoint is the current Producer API. `execute_payment.sh` is a legacy direct contract call helper. Prefer Producer API E2E so auto rail, sponsor signatures, sponsor stablecoin fee, and result reporting are exercised together.

When user gives a real API URL, run:

```bash
./test_publish_api_flow.sh \
  --publish-api-base-url <PRODUCER_API_BASE_URL> \
  --recipient <RECIPIENT_ADDRESS>
```

This flow will:

1. call Producer API health endpoint;
2. create intent with `executionRail=auto` unless overridden;
3. run the agent consumer once (`e2e_runner.ts --once`);
4. upload reasoning evidence to Walrus or report `fallback:<sha256>`;
5. print final `intentId`, status, digest, and blob id.

## SQL Sync for Package ID

Sync package id for AI runtime lookup:

```bash
./sync_package_id_to_sql.sh --driver sqlite
```

Use `--driver postgres --postgres-dsn <DSN>` when needed.

## Progressive Disclosure References

Load only what is needed:

- Owner handoff workflow: `references/owner-handoff-flow.md`
- Producer API test workflow: `references/publish-api-test-flow.md`
- SQL sync details: `references/sql-sync.md`
- Troubleshooting: `references/troubleshooting.md`
