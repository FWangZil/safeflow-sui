# 技术架构详解 (SafeFlow Sui Edition)

SafeFlow 将 Sui checkout 编排、native gasless stablecoin transfer 与 `SessionCap` guarded sponsored execution 组合在一起，实现“AI Agent 可控花钱 + 商户稳定币收款”。

完整多角色流程图见：[`safeflow-e2e-role-flow_cn.md`](./safeflow-e2e-role-flow_cn.md)。

## 整体架构图

```text
┌───────────────────────┐
│ Merchant / Operator   │
│ create checkout       │
└───────────┬───────────┘
            │ POST /v1/checkout/sessions
            ▼
┌────────────────────────────────────────────────────────┐
│ Producer API + Postgres                               │
│ - checkout session                                    │
│ - payment intent                                      │
│ - executionRail=auto                                  │
│ - sponsor validation / attempts                       │
└───────────┬───────────────────────────┬────────────────┘
            │                           │
            │ native_gasless            │ sponsored_guard
            ▼                           ▼
┌───────────────────────┐       ┌────────────────────────┐
│ Sui native gasless    │       │ AgentWallet<T>          │
│ stablecoin transfer   │       │ SessionCap              │
└───────────┬───────────┘       │ execute_payment<T>      │
            │                   │ execute_payment_with_fee│
            │                   └───────────┬────────────┘
            │                               │
            ▼                               ▼
┌───────────────────────┐       ┌────────────────────────┐
│ Merchant recipient    │       │ Merchant + sponsor fee │
│ receives Coin<T>      │       │ recipient receive T    │
└───────────────────────┘       └────────────────────────┘

OpenClaw Agent:
  poll intent -> verify -> ACK -> upload Walrus evidence -> execute selected rail -> report result
```

## 自动 rail 选择

Producer API 默认接受 `executionRail: "auto"`：

| 场景 | 最终 rail |
|---|---|
| allowlisted stablecoin，且不需要 Guard | `native_gasless` |
| 请求 `requiresGuard=true` 或包含 `walletId/sessionCapId` | `sponsored_guard` |
| 明确指定 `native_gasless` / `sponsored_guard` | 校验通过后使用指定 rail |

默认 coin type 是 Circle Sui testnet USDC：

```text
0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
```

## 核心组件设计

### 0. Producer API（Checkout / Intent / Sponsor）

- 创建 merchant checkout session 和关联的 `PaymentIntent`。
- 使用 Postgres 存储 merchant、agent allowance、checkout session、payment intent、sponsor attempt。
- 对 intent 签名，提供拉取、ACK、回写结果和 sponsor 接口。
- 在 `auto` 模式下根据 coin allowlist 与 guard 需求自动决定 rail。

### 1. Native Gasless Rail

- 面向简单 allowlisted stablecoin 转账。
- Agent 不需要为执行路径持有 SUI gas。
- 适合普通商户 checkout：收款方直接收到 `Coin<T>`。

### 2. AgentWallet<T>（Guarded Flow）

`AgentWallet<T>` 是人类或 operator 控制的共享对象：

- 存放 `Coin<T>`，例如 USDC。
- 不要求 Agent 持有人类主钱包私钥。
- 只有配合有效 `SessionCap` 的 guarded entry point 才能花费。

### 3. SessionCap（会话凭证）

`SessionCap` 是授予特定 Agent 地址的 capability object，记录：

- `max_spend_per_second`
- `max_spend_total`
- `expires_at_ms`
- wallet binding / agent binding

它只在 `sponsored_guard` rail 中强制参与；简单 stablecoin checkout 不需要创建 Guard 对象。

### 4. Sponsored Guard Rail

流程：

1. Agent claim intent 并上传 Walrus evidence。
2. Agent 调用 `POST /v1/intents/:intentId/sponsor`，提交 `agentAddress` 和 `walrusBlobId`。
3. Producer API 校验 intent 已被该 agent claim，构造 `execute_payment<T>` 或 `execute_payment_with_fee<T>`。
4. Producer API 将 sender 设为 agent、gas owner/payment 设为 sponsor，并返回交易 bytes + sponsor signature。
5. Agent 对同一交易 bytes 签名，用双签名提交。

当配置 `SPONSOR_FEE_BPS` 或 `SPONSOR_MIN_FEE_ATOMIC` 时，`execute_payment_with_fee<T>` 会在同一稳定币下给 sponsor fee recipient 结算手续费；该扣费也受同一个 `SessionCap` 约束。

### 5. Walrus 审计日志

- Agent 执行前上传 reasoning payload。
- 成功时记录真实 `walrus_blob_id`。
- 降级模式开启且上传失败时记录 `fallback:<sha256(payload)>`。
- Guarded rail 会在 `PaymentExecuted` 事件中发射 `walrus_blob_id`；两条 rail 都会把 evidence id 回写 Producer API，供 checkout/audit trail 展示。

## OpenClaw Agent 视角

1. 轮询 `GET /v1/intents/next?agentAddress=...`。
2. 验证 intent 签名、TTL、收款方、金额、coin type 与本地策略。
3. ACK 抢占执行权（`pending -> claimed`）。
4. 上传 Walrus evidence 或生成 fallback marker。
5. 根据 `intent.executionRail` 执行：
   - `native_gasless`：提交 native gasless stablecoin transfer。
   - `sponsored_guard`：请求 sponsor bytes，Agent 签名后双签提交。
6. 回写 `txDigest`、`walrusBlobId` 与最终状态。

关键点：Agent 负责执行和上报，不负责定义资金策略。

## 安全性分析

1. **私钥隔离**
   - 人类主钱包私钥不进入 Agent runtime。
   - Agent 只使用本地 key 签署自己被允许执行的路径。

2. **最小复杂度路径**
   - 简单 allowlisted stablecoin payment 走 native gasless，不强行进入自定义合约。
   - 需要限速、总额、过期、wallet binding 或 sponsor fee 时才进入 guarded rail。

3. **Guard blast-radius**
   - Move 合约强制速率、总额与过期约束。
   - Sponsor 只为已 claim 且校验通过的 guarded intent 支付执行 gas。
   - 稳定币手续费是显式配置，并受 `SessionCap` 约束。

4. **可审计性**
   - 每个 checkout 都有 intent 状态、tx digest 和 Walrus evidence reference。

## 为什么选择 Sui

- Object capability 模型天然适合表达受限授权。
- Shared object 与 owned object 分离，直接对应 custody 与 execution permission。
- Sui native gasless stablecoin 能覆盖简单 checkout，不必所有支付都走自定义 sponsor。
- PTB 让复杂 AgentPay Guard flow 可以组合 sponsor gas、stablecoin 扣费和 Walrus evidence。
