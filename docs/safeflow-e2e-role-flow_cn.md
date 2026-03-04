# SafeFlow 全链路 E2E 角色流程

本文描述 SafeFlow 在真实场景中的多角色职责与端到端流程：

`Producer API + Agent Runner + SafeFlow Contract + Walrus + Human Dashboard`。

## 角色职责

- **Human Operator（人类操作者）**
  - 部署合约、注资钱包、授权 SessionCap、监控状态。
- **Producer Service（业务服务）**
  - 产生业务支付请求（订单号、金额、收款方、原因、过期时间）。
- **Producer API（意图生产者）**
  - 签名 `PaymentIntent`，维护状态机，提供拉单/ACK/回写接口。
- **OpenClaw Agent Runner（执行者）**
  - 拉取意图、验签与本地策略检查、链上执行并回写结果。
- **SafeFlow Move Contract（链上约束）**
  - 校验授权关系、限速、总额约束，并发射支付事件。
- **Walrus（证据存储）**
  - 存储推理证据，返回 `walrus_blob_id`（或降级 fallback 标记）。
- **Frontend Observer（可视化观察）**
  - 展示意图状态、交易信息和证据链接，供人工审计。

## OpenClaw Agent 视角

从 Agent Runner 看，流程是可重复、可验证的执行循环：

1. 轮询拉取分配给 `agentAddress` 的 intent。
2. 验签 + TTL + 本地策略（收款白名单/金额上限）。
3. ACK 抢占执行权（`pending -> claimed`）。
4. 调用 `executePaymentWithEvidence(...)` 执行支付：
   - 正常上传 Walrus；
   - 若允许降级则记录 `fallback:<sha256>`。
5. 回写执行结果（`success/failure`、`txDigest`、`walrusBlobId`）。

Agent 不负责定义资金策略，仅在业务意图与链上约束范围内执行。

## 端到端时序图

```mermaid
sequenceDiagram
    autonumber
    participant Human as Human Operator
    participant Service as Producer Service
    participant API as Producer API
    participant Agent as OpenClaw Agent Runner
    participant Contract as SafeFlow Move Contract
    participant Chain as Sui Testnet
    participant Walrus as Walrus Testnet
    participant UI as Web Dashboard

    Human->>Chain: 部署 + 创建钱包/授权 + 注资
    Service->>API: POST /v1/intents 生成业务请求
    API->>API: 创建签名 PaymentIntent (pending)

    loop 每 N 秒
        Agent->>API: GET /v1/intents/next
        API-->>Agent: pending intent / null
    end

    Agent->>Agent: 验签 + TTL + 本地策略检查
    Agent->>API: POST /v1/intents/{id}/ack
    API->>API: pending -> claimed

    Agent->>Walrus: 上传推理证据
    alt 上传成功
        Walrus-->>Agent: real walrus_blob_id
    else 上传失败且允许降级
        Agent->>Agent: fallback:sha256(payload)
    end

    Agent->>Contract: execute_payment(..., walrus_blob_id)
    Contract->>Chain: 转账 + 发射 PaymentExecuted
    Chain-->>Agent: txDigest
    Agent->>API: POST /v1/intents/{id}/result
    API->>API: claimed -> executed/failed/expired

    UI->>API: 查询 intent 状态
    UI->>Chain: 查询 tx 事件
    UI->>Walrus: 打开证据链接
```

## Intent 状态机

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> claimed: agent ack
    pending --> expired: 过期
    claimed --> executed: 回写成功
    claimed --> failed: 回写失败
    claimed --> expired: 执行前过期
    pending --> cancelled: 人工取消（扩展）
    executed --> [*]
    failed --> [*]
    expired --> [*]
    cancelled --> [*]
```
