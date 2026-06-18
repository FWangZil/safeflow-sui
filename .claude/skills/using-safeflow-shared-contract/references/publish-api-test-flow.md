# Producer API Test Flow (Intent Producer + Agent Consumer)

This skill treats Producer API integration as a test harness for full E2E. The helper script and `--publish-api-base-url` flag keep their old names for compatibility.

1. create an intent from producer side,
2. let Producer API resolve `executionRail=auto`,
3. let agent poll and execute once,
4. report result with `txDigest` + `walrusBlobId`.

## Required Inputs

- `publish-api-base-url` (Producer API base URL; legacy flag name)
- `recipient` address
- `agentAddress`
- `walletId` + `sessionCapId` only for guarded AgentPay flows

## One Command E2E

```bash
cd .claude/skills/safe-flow-sui-skill/scripts
./test_publish_api_flow.sh \
  --publish-api-base-url <PRODUCER_API_BASE_URL> \
  --recipient <RECIPIENT_ADDRESS>
```

Add `--requires-guard` to force `sponsored_guard` with `AgentWallet<T>` and `SessionCap`:

```bash
./test_publish_api_flow.sh \
  --publish-api-base-url <PRODUCER_API_BASE_URL> \
  --recipient <RECIPIENT_ADDRESS> \
  --requires-guard
```

## What It Does Internally

1. `curl <base>/health`
2. `agent_scripts/create_intent.ts` with:
- `--agent-address`
- `--execution-rail auto`
- `--recipient`
- `--amount-atomic`
- `--coin-type`
- `--wallet-id` and `--session-cap-id` only when guard is requested
3. `agent_scripts/e2e_runner.ts --once`
4. `curl /v1/intents/<intentId>` and print final state.

## Auto Rail Rules

- Allowlisted stablecoin with no guard objects resolves to `native_gasless`.
- `--requires-guard` or explicit `--execution-rail sponsored_guard` resolves to `sponsored_guard`.
- Sponsored guard can include same-coin sponsor fee reimbursement when Producer API has `SPONSOR_FEE_BPS` / `SPONSOR_MIN_FEE_ATOMIC` configured.

## Walrus Upload Behavior

- Walrus upload is performed by the agent runner before executing either rail.
- Successful upload stores real blob id.
- If degrade is enabled and upload fails, `fallback:<sha256>` is reported.

## Optional Auth

If your API enforces key-based write auth:

```bash
./test_publish_api_flow.sh \
  --publish-api-base-url <URL> \
  --recipient <RECIPIENT_ADDRESS> \
  --api-key <X_API_KEY>
```
