# 技术架构详解 (SafeFlow Sui Edition)

本架构文档旨在说明 SafeFlow 是如何利用 Sui 区块链的特性（特别是 Object Model）结合 OpenClaw 实现 Agent-native Payments 的。

## 整体架构图

```text
┌───────────────────────┐            ┌──────────────────────────────────────────┐
│   Human (人类用户)     │            │             Sui Blockchain               │
│                       │            │                                          │
│ 1. 存入资金           │ Deposit    │  ┌────────────────────────────────────┐  │
│ 2. 设置流支付参数      ├───────────►│  │      AgentWallet (Shared Object)   │  │
│ 3. 授权给特定 Agent   │ Grant      │  │      - Owner: Human Address        │  │
└───────────────────────┘ Cap        │  │      - Balance: 10,000 USDC        │  │
                                     │  └──────────────────┬─────────────────┘  │
                                     │                     │                    │
┌───────────────────────┐            │  ┌──────────────────▼─────────────────┐  │
│   OpenClaw Agent      │            │  │      SessionCap (Owned Object)     │  │
│                       │            │  │      - Agent: 0xAgent...           │  │
│ - Local Private Key   │            │  │      - Max/Sec: 0.1 USDC           │  │
│ - Decision Engine     │            │  │      - Max/Total: 10 USDC          │  │
│                       │            │  └──────────────────┬─────────────────┘  │
│ 1. 产生支付意图        │ Exec       │                     │                    │
│ 2. 将意图上传 Walrus   ├───────────►│                     │                    │
│ 3. 构造 PTB 发起支付   │ Payment    │  ┌──────────────────▼─────────────────┐  │
└───────────┬───────────┘            │  │      execute_payment()             │  │
            │                        │  │      1. 验证 Cap 所有权             │  │
            │                        │  │      2. 验证时间戳计算流支付限制    │  │
            │                        │  │      3. 扣除余额                   │  │
            │                        │  │      4. Event 记录 Walrus Blob ID  │  │
            │                        │  └──────────────────┬─────────────────┘  │
            │                        └─────────────────────┼────────────────────┘
            │                                              │
            │                                              │
            ▼                                              ▼
┌───────────────────────┐                        ┌──────────────────┐
│   Walrus Storage      │                        │ Service Provider │
│                       │                        │                  │
│ - 存储 Agent Reasoning │                        │ (e.g. LLM API)   │
│ - 返回 Blob ID        │                        │                  │
└───────────────────────┘                        └──────────────────┘
```

## 核心组件设计

### 1. AgentWallet (智能体钱包)
由于 Agent 需要在后台（独立于人类干预）进行支付操作，它需要能够访问存放资金的钱包。在 Sui 中，我们将 `AgentWallet` 设计为 **Shared Object (共享对象)**：
- 只有创建者（人类）可以注资。
- 任何人都可以尝试调用提取函数，但必须出示对应且有效的 `SessionCap`。

### 2. SessionCap (会话凭证)
这是典型的 Move 能力模式 (Capability Pattern)。`SessionCap` 是一个赋予特定 Agent 地址的 **Owned Object (独占对象)**。
- 只有拥有该 Cap 的 Agent 才能在 PTB 中将其作为参数传入 `execute_payment`。
- Cap 内部记录了 `max_spend_per_second` 和 `last_spend_time_ms`，利用 Sui 的系统 `Clock` 对象来计算自上次支付以来累积的“额度”，从而实现流支付速率控制。

### 3. Walrus 审计日志 (Audit Trail)
在 Web2 世界中，支付往往伴随着订单和账单。在 Agent 自治的场景下，我们利用 Walrus 实现“自证清白”的支付：
- Agent 在执行支付前会把推理过程（如：“我需要调用 OpenAI 接口翻译一段文本，预计花费 0.01$，因此我申请支付”）打包并上传到 Walrus。
- Walrus 成功时返回 immutable 的 `Blob ID`；上传失败时（默认策略）SDK 会写入 `fallback:<sha256(payload)>` 继续执行，保证付款流程不中断且仍可追踪。
- Move 合约的 `execute_payment` 会把 `walrus_blob_id` 作为 Event 发射，前端可通过交易 digest 回查该字段并拼接 aggregator/site 链接。
- 这意味着：链上发生的每一笔支付，都会携带可审计的证据引用（真实 blob 或 fallback hash）。

## 安全性分析 (The Air-Gap)

在这个架构中，我们实现了完美的 Wallet Air-Gap：

1. **私钥隔离**: 存放大量资金的主钱包（人类所有）的私钥永远不会暴露给运行 Agent 的环境。Agent 仅拥有自己在本地生成、没有任何初始资金的临时私钥。
2. **授权隔离**: 即使 Agent 的环境被攻破（如恶意提示词诱导其转账），攻击者最多只能利用 `SessionCap` 按照设定的速率（例如 0.1 USDC/秒）“缓慢”地转走资金，而受制于 `Max Total`。
3. **撤销机制**: 人类一旦发现异常，可以通过合约一键销毁或暂停 `SessionCap`，及时止损。

## 为什么不继续用 EIP-7702 (Monad)?

我们在 Monad 赛道使用了 EIP-7702 实现代付和权限委托，非常优雅。但在 Sui 上，由于原生支持 Object Model，我们**不需要引入复杂的账户抽象 (AA)**。
通过简单地组合 Shared Object (`AgentWallet`) 和 Owned Object (`SessionCap`)，Sui Move 就能以极低的复杂度和极高的安全性达到完全一样的效果，甚至通过 PTB 可以实现更复杂的组合调用。这是不同公链范式带来的不同解法。
