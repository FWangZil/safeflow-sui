# SafeFlow E2E Producer/Consumer Runbook

This runbook demonstrates the full real-world flow:

`Producer API -> Agent poll/ack/execute -> on-chain tx + Walrus proof -> API result state`.

## 1) Start Producer API

```bash
cd producer_api
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
# export PRODUCER_API_KEY=optional-write-key
node server.mjs
```

## 2) Prepare Agent Runner Env

`agent_scripts/.env` should include:

```bash
PACKAGE_ID=<DEPLOYED_PACKAGE_ID>
PRODUCER_API_BASE_URL=http://localhost:8787
PRODUCER_SIGNING_SECRET=dev-secret-change-me
WALRUS_PUBLISHER_URL=https://publisher.testnet.walrus.space
WALRUS_AGGREGATOR_URL=https://aggregator.testnet.walrus.space
WALRUS_EPOCHS=5
WALRUS_DEGRADE_ON_UPLOAD_FAILURE=true
```

## 3) Create a Payment Intent

```bash
cd agent_scripts
npx tsx create_intent.ts \
  --agent-address <AGENT_ADDRESS> \
  --wallet-id <WALLET_ID> \
  --session-cap-id <SESSION_CAP_ID> \
  --recipient <RECIPIENT_ADDRESS> \
  --amount-mist 1000000 \
  --reason "demo e2e payment"
```

## 4) Start Agent Consumer Runner

```bash
cd agent_scripts
npx tsx e2e_runner.ts --poll-ms 3000
```

Runner actions:
1. `GET /v1/intents/next`
2. Signature verification
3. `POST /v1/intents/{id}/ack`
4. `executePaymentWithEvidence(...)`
5. `POST /v1/intents/{id}/result`

## 5) Observe Results

### API:

```bash
curl http://localhost:8787/v1/intents/<INTENT_ID>
```

### Frontend:
1. Open `web` app.
2. Use **Producer Intent Observer** with `intentId`.
3. Use **Walrus Evidence Lookup** with `txDigest` to inspect `walrus_blob_id` links.

## Common Failure Signals

- `signature_invalid`: `PRODUCER_SIGNING_SECRET` mismatch between API and runner.
- `rate_limit`: SessionCap flow limit exceeded.
- `insufficient_balance`: SafeFlow wallet balance too low.
- `expired`: intent reached `expiresAtMs`.
