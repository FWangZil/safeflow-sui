# SafeFlow E2E Producer/Consumer Runbook

This runbook demonstrates the current full-chain demo:

`Merchant checkout -> Producer API -> Agent poll/ack/evidence -> native gasless or sponsored guard tx -> API result`.

For role diagrams, see [`safeflow-e2e-role-flow.md`](./safeflow-e2e-role-flow.md).

## 1. Start Producer API

Producer API is Postgres-backed.

```bash
cd producer_api
bun install

export DATABASE_URL=postgres://postgres:postgres@localhost:5432/safeflow
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
export PACKAGE_ID=<SAFEFLOW_PACKAGE_ID>
export SPONSOR_SECRET_KEY=<SUI_SPONSOR_PRIVATE_KEY>
export SPONSOR_FEE_BPS=100
export SPONSOR_MIN_FEE_ATOMIC=0
export NATIVE_GASLESS_COIN_TYPES=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC

bun run migrate
bun run seed:demo
bun run dev
```

`seed:demo` prints the merchant API key once.

## 2. Prepare Agent Runner Env

```bash
cd agent_scripts
bun install

export PACKAGE_ID=<SAFEFLOW_PACKAGE_ID>
export PRODUCER_API_BASE_URL=http://localhost:8787
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
export DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
export WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
export WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
export WALRUS_EPOCHS=5
export WALRUS_DEGRADE_ON_UPLOAD_FAILURE=true
```

The runner reads `agent_scripts/.agent_key.json`; run the existing agent key bootstrap if the file is missing.

## 3. Create Checkout Session

Simple allowlisted stablecoin checkout. Producer API auto-selects `native_gasless`.

```bash
curl -X POST http://localhost:8787/v1/checkout/sessions \
  -H "content-type: application/json" \
  -H "x-api-key: <MERCHANT_API_KEY>" \
  -d '{
    "merchantOrderId": "order-demo-native",
    "executionRail": "auto",
    "amountAtomic": 1000000,
    "currencySymbol": "USDC",
    "reason": "demo native gasless checkout"
  }'
```

Guarded AgentPay checkout. Producer API resolves to `sponsored_guard`.

```bash
curl -X POST http://localhost:8787/v1/checkout/sessions \
  -H "content-type: application/json" \
  -H "x-api-key: <MERCHANT_API_KEY>" \
  -d '{
    "merchantOrderId": "order-demo-guard",
    "executionRail": "auto",
    "requiresGuard": true,
    "amountAtomic": 1000000,
    "currencySymbol": "USDC",
    "reason": "demo guarded checkout"
  }'
```

## 4. Run Agent Once

```bash
cd agent_scripts
bun run typecheck
bunx tsx e2e_runner.ts --once --poll-ms 3000
```

Runner actions:

1. `GET /v1/intents/next?agentAddress=...`
2. Verify signed intent payload.
3. `POST /v1/intents/{id}/ack`
4. Upload Walrus evidence or build fallback marker.
5. Execute selected rail:
   - `native_gasless`: native stablecoin transfer, no sponsor signature.
   - `sponsored_guard`: request sponsor bytes, agent signs, submit dual-signed tx.
6. `POST /v1/intents/{id}/result`

## 5. Observe Results

```bash
curl http://localhost:8787/v1/intents/<INTENT_ID>
curl http://localhost:8787/v1/checkout/sessions/<SESSION_ID>
```

Frontend:

1. Open `web` app.
2. Create or load checkout session.
3. Use Audit Trail with `intentId` or transaction digest.

## Common Failure Signals

- `signature_invalid`: `PRODUCER_SIGNING_SECRET` mismatch.
- `rate_limit`: guarded SessionCap flow limit exceeded.
- `insufficient_balance`: AgentWallet stablecoin balance too low.
- `expired`: intent reached `expiresAtMs`.
- sponsor endpoint returns `409`: intent is native gasless or has not been ACKed.
