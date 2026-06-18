# SafeFlow Producer API

Postgres-backed checkout and intent API for the gasless AgentPay Guard demo.

Checkout sessions support two execution rails:

- `native_gasless`: simple allowlisted stablecoin transfer using Sui native gasless `balance::send_funds<CoinType>`.
- `sponsored_guard`: guarded `wallet::execute_payment<CoinType>` or `wallet::execute_payment_with_fee<CoinType>` with `AgentWallet<T>` / `SessionCap`; Producer API sponsors the agent execution gas and can collect a stablecoin fee from the same guarded wallet.

`executionRail` may also be omitted or set to `auto`. In auto mode, allowlisted stablecoin payments without guard signals use `native_gasless`; requests with `requiresGuard: true` or guard object IDs use `sponsored_guard`.

## Run

```bash
cd producer_api
bun install

export DATABASE_URL=postgres://postgres:postgres@localhost:5432/safeflow
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
export PACKAGE_ID=<PUBLISHED_PACKAGE_ID>
export SPONSOR_SECRET_KEY=<SUI_SPONSOR_PRIVATE_KEY>
export SPONSOR_FEE_BPS=100
export SPONSOR_MIN_FEE_ATOMIC=0
export SPONSOR_FEE_RECIPIENT=<SPONSOR_STABLECOIN_FEE_ADDRESS>
export NATIVE_GASLESS_COIN_TYPES=<COMMA_SEPARATED_ALLOWLISTED_STABLECOIN_TYPES>
export NEXT_PUBLIC_APP_URL=http://localhost:3000
export DEMO_PAYOUT_ADDRESS=<MERCHANT_PAYOUT_ADDRESS>
export DEMO_AGENT_ADDRESS=<AGENT_ADDRESS>
export DEMO_WALLET_ID=<AGENT_WALLET_OBJECT_ID>
export DEMO_SESSION_CAP_ID=<SESSION_CAP_OBJECT_ID>

bun run migrate
bun run seed:demo
bun run dev
```

`seed:demo` prints the merchant API key once. Use it as `x-api-key` for checkout/session creation.

## Defaults

- `DEFAULT_COIN_TYPE`: Circle Sui testnet USDC
- `DEFAULT_CURRENCY_SYMBOL`: `USDC`
- `DEFAULT_CURRENCY_DECIMALS`: `6`
- `SPONSOR_MAX_GAS_BUDGET`: `10000000`
- `SPONSOR_FEE_BPS`: `0`
- `SPONSOR_MIN_FEE_ATOMIC`: `0`
- `SPONSOR_FEE_RECIPIENT`: defaults to the sponsor key address when omitted
- `NATIVE_GASLESS_COIN_TYPES`: defaults to `DEFAULT_COIN_TYPE`
- `SUI_NETWORK`: `testnet`

## Endpoints

- `POST /v1/checkout/sessions`
- `GET /v1/checkout/sessions/{sessionId}`
- `GET /v1/intents/next?agentAddress=...`
- `POST /v1/intents/{intentId}/ack`
- `POST /v1/intents/{intentId}/sponsor`
- `POST /v1/intents/{intentId}/result`
- `GET /v1/intents/{intentId}`
- `GET /v1/intents?agentAddress=...&status=...&limit=...`
- `GET /health`

`POST /v1/intents` remains as a compatibility path for local CLI/demo commands and accepts either `amountAtomic` or legacy `amountMist`.

Merchant-created endpoints (`POST /v1/checkout/sessions` and compatibility `POST /v1/intents`) require `x-api-key`. Agent ACK, sponsor, and result endpoints validate the assigned `agentAddress` and intent state instead.

## Execution Flow

1. Agent polls and ACKs an intent.
2. Agent uploads Walrus reasoning evidence.
3. For `native_gasless`, the agent submits a native stablecoin transfer directly with no sponsor signature.
4. For `sponsored_guard`, the agent calls `POST /v1/intents/{intentId}/sponsor` with `agentAddress` and `walrusBlobId`.
5. Server validates the claimed intent. If `sponsorFeeAtomic > 0`, it builds `execute_payment_with_fee<CoinType>` so merchant principal and sponsor fee are both enforced by the same `SessionCap`; otherwise it keeps the legacy `execute_payment<CoinType>` call.
6. Agent signs the returned transaction bytes and submits the transaction with agent + sponsor signatures.

The sponsor still needs SUI for gas. The stablecoin fee is reimbursement/revenue collected inside the guarded payment, not a replacement for the protocol gas coin.

## Tests

```bash
bun run test
```
