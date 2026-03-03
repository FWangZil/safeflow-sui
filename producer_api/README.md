# SafeFlow Producer API

Lightweight HTTP API that issues signed `PaymentIntent` objects and tracks state transitions:

`pending -> claimed -> executed|failed|expired`.

## Run

```bash
cd producer_api
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
# export PRODUCER_API_KEY=optional-write-api-key
node server.mjs
```

## Endpoints

- `POST /v1/intents`
- `GET /v1/intents/next?agentAddress=...`
- `POST /v1/intents/{intentId}/ack`
- `POST /v1/intents/{intentId}/result`
- `GET /v1/intents/{intentId}`
- `GET /v1/intents?agentAddress=...&status=...&limit=...`
- `GET /health`

## Notes

- If `PRODUCER_API_KEY` is set, write endpoints require `x-api-key`.
- Intents are persisted in `producer_api/data/intents.json`.
- Signatures are HMAC-SHA256 over canonical intent payload fields.
