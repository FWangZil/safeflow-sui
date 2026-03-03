# SafeFlow (Sui Edition) - Agent Air-Gap Wallet

**基于 Sui 和 OpenClaw 的智能体专属“零花钱”与流支付协议**

[English Version](./README.md)

## 项目概述

SafeFlow (Sui Edition) 是一个专门为 **AI Agent (如 OpenClaw)** 设计的链上资金管理与流支付协议。在 Agent 变得越来越自治的今天，如何安全地给 Agent 授权资金，同时又防止由于 Prompt Injection 等攻击导致 Agent 恶意挥霍资金，成为了一个关键挑战（The Wallet Air-Gap）。

本项目利用 Sui 独特的**对象模型 (Object Model)**，通过赋予 Agent 一个受限的 `SessionCap`（会话凭证），完美解决了这个挑战：

1. **资金隔离 (Air-Gap)**: 人类将资金存入 `AgentWallet` 共享对象，Agent 本地生成私钥，只持有 `SessionCap`。
2. **严格的速率限制**: `SessionCap` 强制规定了 Agent 的“每秒最大花费”和“总花费上限”。即使 Agent 暴走，也无法瞬间抽干钱包。
3. **结合 Walrus 的审计追踪**: Agent 脚本会先将推理证据上传到 Walrus（testnet）再执行支付；默认开启降级策略，上传失败时会用 `fallback:<sha256>` 标记继续支付，保证流程不中断且可追踪。

## 文档导航

- 架构说明：[`docs/architecture.md`](./docs/architecture.md)
- 角色参与的全 E2E 流程图：[`docs/safeflow-e2e-role-flow.md`](./docs/safeflow-e2e-role-flow.md)
- E2E 运行手册：[`docs/safeflow-e2e-producer-consumer-runbook.md`](./docs/safeflow-e2e-producer-consumer-runbook.md)
- 部署与配置手册：[`docs/safeflow-deploy-and-config-runbook.md`](./docs/safeflow-deploy-and-config-runbook.md)

## 核心功能与技术栈

- **智能体安全隔离钱包**: Sui Move 实现的 `AgentWallet` 与 `SessionCap` 机制。
- **精确到秒的流支付限制**: Move 合约内基于 Sui Clock 的时间戳流速计算 (`max_spend_per_second`)。
- **可审计的支付意图 (Walrus Integration)**: 真实上传 Walrus 并记录 `walrus_blob_id` 到链上事件，前端可按交易 digest 查询。
- **Agent 本地执行**: 基于 `@mysten/sui.js` 和 Node.js 的 TypeScript 脚本，模拟 OpenClaw Agent 本地静默运行并按需支付。
- **人类控制面板 (Human Dashboard)**: 基于 Next.js + Tailwind CSS + Sui dApp Kit 构建的前端，用于管理资金和授权。

| 组件 | 技术 |
|-----------|------------|
| Blockchain | Sui (Testnet) |
| Smart Contracts | Sui Move (2024.beta Edition) |
| Agent Scripts | Node.js, TypeScript, `@mysten/sui.js` |
| Frontend | Next.js 16, React, Tailwind CSS, `@mysten/dapp-kit` |

## 目录结构

```
.
├── agent_wallet/           # Sui Move 智能合约
│   ├── sources/
│   │   └── wallet.move     # 核心钱包与授权逻辑
│   ├── tests/
│   │   └── wallet_tests.move # 单元测试
│   └── Move.toml
├── agent_scripts/          # OpenClaw Agent 本地执行脚本与工具
│   ├── index.ts            # Agent 密钥管理与 PTB 支付执行逻辑
│   ├── create_intent.ts    # 快速创建测试 PaymentIntent
│   ├── e2e_runner.ts       # 轮询/ACK/执行/回写结果
│   ├── package.json
│   └── tsconfig.json
├── producer_api/           # PaymentIntent 生产者 API
│   ├── server.mjs
│   └── package.json
├── web/                    # 供人类使用的主控制面板 (Next.js)
│   ├── src/app/
│   │   ├── page.tsx        # Dashboard UI
│   │   ├── providers.tsx   # dApp Kit Providers
│   │   └── layout.tsx
│   ├── package.json
│   └── tailwind.config.ts
├── docs/                   # 项目相关文档
│   ├── architecture.md     # 技术架构详解
│   ├── safeflow-e2e-role-flow.md # 多角色全链路流程图
│   ├── safeflow-e2e-producer-consumer-runbook.md # E2E 运行手册
│   ├── safeflow-deploy-and-config-runbook.md # 部署配置手册
│   └── hackathon_intro.md  # 黑客松提交介绍
└── README.md               # 本文件
```

## 安装与运行步骤

### 1. 部署 Sui Move 合约

```bash
cd agent_wallet

# 构建合约
sui move build

# 运行测试
sui move test

# 发布到测试网 (请确保你的 sui client 环境已经配置好 testnet 并有测试币)
sui client publish --gas-budget 100000000
```

部署成功后，请记录下 `Package ID`。

### 2. 运行 Agent 脚本

```bash
cd agent_scripts

# 安装依赖
bun install

# 指定刚部署得到的 Package ID（并配置 Walrus testnet）
export PACKAGE_ID=<YOUR_PACKAGE_ID>
export WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
export WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
export WALRUS_EPOCHS=5
export WALRUS_DEGRADE_ON_UPLOAD_FAILURE=true

# 运行 Agent 脚本 (它会自动生成/读取本地 Agent 私钥并打印地址)
npx tsx index.ts
```

记录下控制台打印出的 **Agent Address**。

*(在实际应用中，让 Human Dashboard 给该地址授予 `SessionCap` 后，再在脚本里填入 `walletId/sessionCapId` 来执行真实支付。)*

### 3. 运行 Producer API（支付意图生产者）

```bash
cd producer_api

export PRODUCER_SIGNING_SECRET=dev-secret-change-me
# export PRODUCER_API_KEY=<可选写入密钥>

node server.mjs
```

### 4. 创建 Intent + 运行 Agent E2E Runner

```bash
cd agent_scripts

export PRODUCER_API_BASE_URL=http://localhost:8787
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
# export PRODUCER_API_KEY=<可选写入密钥>

# 创建测试意图
npx tsx create_intent.ts \
  --agent-address <AGENT_ADDRESS> \
  --wallet-id <WALLET_ID> \
  --session-cap-id <SESSION_CAP_ID> \
  --recipient <RECIPIENT_ADDRESS> \
  --amount-mist 1000000 \
  --reason "demo e2e payment"

# 启动轮询执行器
npx tsx e2e_runner.ts --poll-ms 3000
```

### 5. 运行 Human Dashboard (前端)

```bash
cd web

# 安装依赖
bun install

# 指定刚部署得到的 Package ID，供前端调用 Move 合约
export NEXT_PUBLIC_PACKAGE_ID=<YOUR_PACKAGE_ID>
export NEXT_PUBLIC_WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
export NEXT_PUBLIC_WALRUS_SITE_SUFFIX=.walrus.site
export NEXT_PUBLIC_PRODUCER_API_BASE_URL=http://localhost:8787

# 运行开发服务器
bun run dev
```

打开浏览器访问 `http://localhost:3000`。连接你的 Sui 钱包，输入上一步生成的 Agent Address，点击按钮即可链上执行：

1. `create_wallet`
2. `create_session_cap`

随后你可以在前端的 **Walrus Evidence Lookup** 区块输入支付交易 digest，直接解析并打开 `walrus_blob_id` 对应的证据链接。
你也可以在 **Producer Intent Observer** 区块输入 `intentId`，查看状态 (`pending/claimed/executed/failed`) 并关联 `txDigest` 与 `walrus_blob_id`。
完整角色流程图见：[`docs/safeflow-e2e-role-flow.md`](./docs/safeflow-e2e-role-flow.md)。

## 适用场景 (Track 匹配)

本项目极度契合 **Sui OpenClaw Hackathon** 的两大相关主题：

1. **Safety & Security (Track 1)**:
   通过 Move 的 Object 能力和 Walrus 的去中心化存储，打造了一个**防注入、可追溯、防挤兑**的 Agent 隔离钱包。人类掌握绝对的资金控制权和审计权。

2. **Local God Mode (Track 2)**:
   OpenClaw 智能体在本地机器上运行，利用分配到的 `SessionCap` 在后台无缝地为自己调用的云端大模型 API 或其他 Web3 服务进行流式付费，实现真正的 Local Autonomy (本地自治)。

## 许可证

MIT License
