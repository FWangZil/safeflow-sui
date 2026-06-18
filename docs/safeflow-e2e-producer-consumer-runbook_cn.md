# SafeFlow E2E 运行手册（Producer / Consumer）

当前完整 demo 流程：

`商户 checkout -> Producer API -> Agent 拉单/ACK/证据 -> native gasless 或 sponsored guard 交易 -> API 回写结果`。

角色图见：[`safeflow-e2e-role-flow_cn.md`](./safeflow-e2e-role-flow_cn.md)。

## 1. 启动 Producer API

Producer API 使用 Postgres。

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

`seed:demo` 会打印一次商户 API key。

## 2. 准备 Agent Runner 环境

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

Runner 读取 `agent_scripts/.agent_key.json`。如果文件不存在，先运行现有 Agent key bootstrap。

## 3. 创建 Checkout Session

简单 allowlisted stablecoin checkout。Producer API 会自动选择 `native_gasless`。

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

需要 SessionCap Guard 的 AgentPay checkout。Producer API 会解析成 `sponsored_guard`。

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

## 4. 单次运行 Agent

```bash
cd agent_scripts
bun run typecheck
bunx tsx e2e_runner.ts --once --poll-ms 3000
```

执行顺序：

1. `GET /v1/intents/next?agentAddress=...`
2. 校验签名后的 intent。
3. `POST /v1/intents/{id}/ack`
4. 上传 Walrus 证据，失败时生成 fallback 标记。
5. 按 rail 执行：
   - `native_gasless`: 原生稳定币转账，无 sponsor 签名。
   - `sponsored_guard`: 请求 sponsor bytes，agent 签名后提交双签交易。
6. `POST /v1/intents/{id}/result`

## 5. 观察结果

```bash
curl http://localhost:8787/v1/intents/<INTENT_ID>
curl http://localhost:8787/v1/checkout/sessions/<SESSION_ID>
```

前端：

1. 打开 `web`。
2. 创建或加载 checkout session。
3. 在 Audit Trail 中输入 `intentId` 或交易 digest。

## 常见错误信号

- `signature_invalid`: `PRODUCER_SIGNING_SECRET` 两端不一致。
- `rate_limit`: guarded SessionCap 流速限制触发。
- `insufficient_balance`: AgentWallet 稳定币余额不足。
- `expired`: intent 超过 `expiresAtMs`。
- sponsor endpoint 返回 `409`: intent 是 native gasless，或尚未 ACK。
