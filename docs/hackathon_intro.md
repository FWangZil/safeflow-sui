# SafeFlow (Sui Edition) - Rebel in Paradise Hackathon Intro

## 1. 项目一句话简介
基于 Sui native gasless stablecoin 与 Object Model 的**防注入、可追溯** AI 智能体 (OpenClaw) checkout / AgentPay Guard 产品。

## 2. 解决什么问题？(The Problem)
在 AI 智能体变得越来越自治的今天（特别是类似 OpenClaw 这样的本地或云端自治 Agent），我们希望它们能够**自主在 Web3 世界流转、购买 API 服务、甚至互相协作并流式支付（Agent-native Payments）**。但是：

1. **"The Wallet Air-Gap" (安全与防注入危机)**
   如果直接给 Agent 授权一个装满资产的钱包私钥，一旦 Agent 遭遇 Prompt Injection（恶意提示词注入）攻击，黑客就可以轻易让 Agent 转走所有资产。
2. **"The Infinite Money Glitch" (按需无感支付)**
   Agent 调用外部服务（如大模型 API 或其他 Web3 节点）时，需要一种不需要人类反复点击确认的、能以极高频度（如每秒）进行的微支付方式。

## 3. 我们如何解决的？(The Solution: Dual Gasless Rails)
我们利用 Sui 的 native gasless stablecoin、**Object Model（对象模型）** 和 **Walrus（去中心化存储）**，为 Agent 打造了一个可自动分流的支付环境：

- **简单支付走 native gasless**:
  商户 checkout 如果只是 allowlisted stablecoin P2P 转账，Producer API 会自动解析为 `native_gasless`，Agent 不需要持有 SUI gas。
- **速率与额度限制的 SessionCap**: 
  如果业务需要 AgentPay Guard，人类在 Sui 上创建 `AgentWallet<T>` 并颁发 `SessionCap`。这个 Cap 在智能合约层面严格限制：**总花费上限 (Max Total Spend)**、**每秒最大花费流速 (Max Spend per Second)** 和过期时间。
  *效果：即便 Agent 被黑客注入，它也只能按照设定好的极低速率（如 1 USDC / 每秒）缓慢吸血，人类可以随时链上吊销 Cap，阻止损失。*
- **Sponsor + 稳定币手续费**:
  Guarded flow 由 sponsor 支付 SUI gas；如果配置了手续费，`execute_payment_with_fee<T>` 会用同一稳定币给 sponsor fee recipient 结算，且仍受 `SessionCap` 约束。
- **Walrus 审计追踪 (Track 1 Bonus)**: 
  Agent 每次执行前都会上传推理证据到 Walrus；失败时可降级为 `fallback:<sha256>`。Producer API 与链上事件共同保存 evidence reference。

## 4. 为什么选择 Sui? (Why Sui & Move?)
1. **Move 语言的安全性与对象模型**: `SessionCap` 作为一种 Capability 模式的实现，非常自然且安全。它不需要复杂的智能合约账户（ERC-4337），只需签发一个 `Cap` 对象给 Agent 即可。
2. **极速与低费用的 PTB**: Sui 的低延迟与 PTB 机制，让 Agent 可以将“思考”、“证明”和“支付”打包在一个交易块中瞬间完成。
3. **Native gasless + PTB**: 简单 checkout 可以不需要 Agent gas；复杂 Guarded flow 可以通过 sponsored PTB 组合链上限额、手续费与证据记录。
4. **Walrus 的原生支持**: 能够低成本保存 Agent 日志，是构建“防作恶可审计 Agent”的关键拼图。

## 5. 契合的 Track

本项目完美横跨并契合本次黑客松的两大 Track：

### Track 1: Safety & Security 
**解决: Agent 越权操作与提示词注入导致资金流失**
- 我们的 `SessionCap` 速率限制机制和强制 Walrus 审计日志，是目前应对 Agent 资金安全的最优解之一。它将资金权与使用权（速率受限）进行了物理（Air-Gap）层面的隔离。

### Track 2: Local God Mode
**解决: 本地智能体无缝对接链上经济**
- 我们的 TypeScript 脚本允许 OpenClaw Agent 在用户的笔记本本地安全运行。简单稳定币 checkout 不需要 Agent SUI gas；复杂支付则利用分配到的 `SessionCap` 与 sponsor 执行 gas 完成 AgentPay Guard。

## 6. 团队成员与分工
*(请根据实际情况补充)*

## 7. 未来展望
- 开发基于 Sui 的全功能 Agent to Agent 支付流控制 SDK。
- 将 Walrus 日志结合 ZK 技术，实现 Agent “只在特定逻辑验证通过后才允许流支付”的更高级防火墙。
