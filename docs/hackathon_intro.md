# SafeFlow (Sui Edition) - Rebel in Paradise Hackathon Intro

## 1. 项目一句话简介
基于 Sui Object Model 的**防注入、可追溯** AI 智能体 (OpenClaw) 流支付“零花钱”物理隔离钱包。

## 2. 解决什么问题？(The Problem)
在 AI 智能体变得越来越自治的今天（特别是类似 OpenClaw 这样的本地或云端自治 Agent），我们希望它们能够**自主在 Web3 世界流转、购买 API 服务、甚至互相协作并流式支付（Agent-native Payments）**。但是：

1. **"The Wallet Air-Gap" (安全与防注入危机)**
   如果直接给 Agent 授权一个装满资产的钱包私钥，一旦 Agent 遭遇 Prompt Injection（恶意提示词注入）攻击，黑客就可以轻易让 Agent 转走所有资产。
2. **"The Infinite Money Glitch" (按需无感支付)**
   Agent 调用外部服务（如大模型 API 或其他 Web3 节点）时，需要一种不需要人类反复点击确认的、能以极高频度（如每秒）进行的微支付方式。

## 3. 我们如何解决的？(The Solution: Sui Object Edition)
我们摒弃了在 Monad 上使用的 EIP-7702，转而利用 Sui 强大的 **Object Model（对象模型）** 和 **Walrus（去中心化存储）**，为 Agent 打造了一个绝对安全的本地运行支付环境：

- **隔离钱包与提款机机制**: 
  人类用户在 Sui 上创建一个共享对象 `AgentWallet` 并存入 USDC/SUI。
- **速率与额度限制的 SessionCap**: 
  人类通过前端 Dashboard 给 Agent（其本地生成的受限私钥）颁发一个 `SessionCap`。这个 Cap 在智能合约层面严格限制了：**总花费上限 (Max Total Spend)** 和 **每秒最大花费流速 (Max Spend per Second)**。
  *效果：即便 Agent 被黑客注入，它也只能按照设定好的极低速率（如 1 USDC / 每秒）缓慢吸血，人类可以随时链上吊销 Cap，阻止损失。*
- **Walrus 审计追踪 (Track 1 Bonus)**: 
  我们在合约中硬编码要求：Agent 每次发起支付 PTB（Programmable Transaction Block）时，必须提交一个有效上传到 Walrus 的 `Blob ID`。这个 Blob 包含 Agent 当下决定支付的**推理日志/意图说明**。
  *效果：每一笔钱花到哪里、为什么花，都在去中心化存储上有据可查，做到了智能体行为的 100% On-chain Auditability。*

## 4. 为什么选择 Sui? (Why Sui & Move?)
1. **Move 语言的安全性与对象模型**: `SessionCap` 作为一种 Capability 模式的实现，非常自然且安全。它不需要复杂的智能合约账户（ERC-4337），只需签发一个 `Cap` 对象给 Agent 即可。
2. **极速与低费用的 PTB**: Sui 的低延迟与 PTB 机制，让 Agent 可以将“思考”、“证明”和“支付”打包在一个交易块中瞬间完成。
3. **Walrus 的原生支持**: 能够低成本、永久/大文件地保存 Agent 日志，是构建“防作恶可审计 Agent”的完美拼图。

## 5. 契合的 Track

本项目完美横跨并契合本次黑客松的两大 Track：

### Track 1: Safety & Security 
**解决: Agent 越权操作与提示词注入导致资金流失**
- 我们的 `SessionCap` 速率限制机制和强制 Walrus 审计日志，是目前应对 Agent 资金安全的最优解之一。它将资金权与使用权（速率受限）进行了物理（Air-Gap）层面的隔离。

### Track 2: Local God Mode
**解决: 本地智能体无缝对接链上经济**
- 我们的 TypeScript 脚本允许 OpenClaw Agent 在用户的笔记本本地安全运行，它自己管理一个临时私钥，不碰用户的冷钱包，却能利用分配到的 `SessionCap` 购买云端服务，成为一个真正的“本地神明”。

## 6. 团队成员与分工
*(请根据实际情况补充)*

## 7. 未来展望
- 开发基于 Sui 的全功能 Agent to Agent 支付流控制 SDK。
- 将 Walrus 日志结合 ZK 技术，实现 Agent “只在特定逻辑验证通过后才允许流支付”的更高级防火墙。
