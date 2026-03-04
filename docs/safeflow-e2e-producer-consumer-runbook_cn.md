# SafeFlow E2E 运行手册（Producer / Consumer）

本手册用于跑通真实闭环：

`Producer API -> Agent 轮询/ACK/执行 -> 链上交易 + Walrus 证据 -> API 状态回写`。

完整角色流程图见：[`safeflow-e2e-role-flow_cn.md`](./safeflow-e2e-role-flow_cn.md)。

## 1) 启动 Producer API

```bash
cd producer_api
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
# export PRODUCER_API_KEY=<可选写入密钥>
node server.mjs
```

## 2) 准备 Agent Runner 环境

确保 `agent_scripts/.env` 包含：

```bash
PACKAGE_ID=<DEPLOYED_PACKAGE_ID>
PRODUCER_API_BASE_URL=http://localhost:8787
PRODUCER_SIGNING_SECRET=dev-secret-change-me
WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
WALRUS_EPOCHS=5
WALRUS_DEGRADE_ON_UPLOAD_FAILURE=true
```

## 3) 创建支付意图

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

## 4) 启动 Agent 消费执行器

```bash
cd agent_scripts
npx tsx e2e_runner.ts --poll-ms 3000
```

执行器动作顺序：
1. `GET /v1/intents/next`
2. 验签与本地策略检查
3. `POST /v1/intents/{id}/ack`
4. `executePaymentWithEvidence(...)`
5. `POST /v1/intents/{id}/result`

## 5) 观察结果

### API 查询

```bash
curl http://localhost:8787/v1/intents/<INTENT_ID>
```

### 前端观察
1. 打开 `web` 页面。
2. 在 **Producer Intent Observer** 输入 `intentId`。
3. 在 **Walrus Evidence Lookup** 输入 `txDigest` 查看证据链接。

## 常见错误信号

- `signature_invalid`: `PRODUCER_SIGNING_SECRET` 两端不一致。
- `rate_limit`: SessionCap 流速限制触发。
- `insufficient_balance`: SafeFlow wallet 余额不足。
- `expired`: intent 超过 `expiresAtMs`。
