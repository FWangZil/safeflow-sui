# SafeFlow (Sui Edition) - Gasless Checkout + AgentPay Guard

**基于 Sui 和 OpenClaw 的 AI Agent 可控花钱 + 商户稳定币收款 demo**

[English Version](./README.md)

## 项目概述

SafeFlow (Sui Edition) 是面向 **AI Agent（如 OpenClaw）** 的链上 checkout 与受控支付协议。它解决的问题是：既让 Agent 能自动完成稳定币支付，又不把人类主钱包私钥或无限额度交给 Agent。

当前实现支持两条 gasless rail：

1. **Native gasless stablecoin**：简单 allowlisted stablecoin 转账走 Sui native gasless，适合普通商户 P2P checkout。
2. **Sponsored AgentPay Guard**：需要 `SessionCap` 限额、总额、过期时间或 sponsor fee reimbursement 时，Producer API 构造 sponsored `execute_payment<T>` / `execute_payment_with_fee<T>`，Agent 追加签名并双签提交。

## 黑客松期间新增功能 / Redesign 范围

SafeFlow 是一个已有的 Sui 项目，本次 **SuiOverflow 2026** 提交不是把旧版 demo 原样提交，而是在黑客松期间完成一个 **well-defined new feature and redesign**：把早期 `SessionCap` 钱包 demo 迭代成完整的 Gasless Checkout + AgentPay Guard 产品。

黑客松期间完成的新功能与 redesign 包括：

- 基于 Postgres 的 merchant checkout session 与 payment intent；
- `executionRail=auto`，自动判断 Sui native gasless stablecoin transfer 与 sponsored AgentPay Guard；
- Sponsor 支付 guarded execution gas，并支持同稳定币手续费补偿；
- 重新设计的 Web console：operator setup、merchant checkout/status、public checkout、audit trail；
- 更新后的 Agent runner 与可复用 SafeFlow Sui skill，适配新的 Producer API flow。

因此，本项目满足 SuiOverflow 2026 对“必须是 Sui 上的新项目，或 established project 在 hackathon 期间实现 well-defined new feature or redesign”的要求。

默认稳定币为 Circle Sui testnet USDC：

```text
0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
```

## OpenClaw Agent 视角

从 OpenClaw runtime 看，SafeFlow 是受控 checkout 执行循环，不是热钱包转账脚本：

1. 从 Producer API 拉取分配给自己的 checkout payment intent。
2. 验签 + TTL + 本地策略（收款地址/金额）校验。
3. ACK 意图（`pending -> claimed`），避免重复消费。
4. 上传推理证据到 Walrus；如果允许降级，则记录 `fallback:<sha256>`。
5. 根据 Producer API 解析出的 `executionRail` 自动执行：
   - `native_gasless`：提交 Sui native gasless `balance::send_funds<CoinType>` 稳定币转账。
   - `sponsored_guard`：请求 sponsor 交易字节，Agent 签名后与 sponsor 签名一起提交。
6. 回写执行结果到 Producer API（`executed/failed/expired`）。

默认 `executionRail: "auto"`：allowlisted stablecoin 且不需要 Guard 时走 native gasless；请求 `requiresGuard: true` 或携带 `walletId/sessionCapId` 时走 sponsored guard。

## Demo 视频

[![观看 Demo - SafeFlow on Sui](https://img.youtube.com/vi/pAd18KE81DI/hqdefault.jpg)](https://www.youtube.com/watch?v=pAd18KE81DI)

- YouTube demo: [SafeFlow on Sui: OpenClaw Agent 安全自治支付实战（Walrus 可审计证据)](https://www.youtube.com/watch?v=pAd18KE81DI)

https://github.com/user-attachments/assets/cfff0f3e-d586-4c85-b3ef-c7aade79fb3c

## 文档导航

- 架构说明：[`docs/architecture.md`](./docs/architecture.md)
- 黑客松介绍与范围：[`docs/hackathon_intro.md`](./docs/hackathon_intro.md)
- 多角色 E2E 流程：[`docs/safeflow-e2e-role-flow_cn.md`](./docs/safeflow-e2e-role-flow_cn.md)
- E2E 运行手册：[`docs/safeflow-e2e-producer-consumer-runbook_cn.md`](./docs/safeflow-e2e-producer-consumer-runbook_cn.md)
- 部署与配置手册：[`docs/safeflow-deploy-and-config-runbook_cn.md`](./docs/safeflow-deploy-and-config-runbook_cn.md)
- Agent Skill 安装指南：[`docs/safeflow-agent-skill-install_cn.md`](./docs/safeflow-agent-skill-install_cn.md)

## 安装 SafeFlow Agent Skill

独立 skill 仓库：

- [`FWangZil/safe-flow-sui-skill`](https://github.com/FWangZil/safe-flow-sui-skill)

OpenClaw 以及其他兼容的 Agent 运行时可使用以下任一命令安装：

```bash
npx skills add FWangZil/safe-flow-sui-skill
```

或：

```bash
npx clawhub@latest install safe-flow-sui-skill
```

## 核心功能与技术栈

- **双 gasless rail**：自动判断 simple stablecoin transfer 与 guarded AgentPay flow。
- **智能体安全隔离钱包**：Sui Move 实现 `AgentWallet<T>` 与 `SessionCap`。
- **精确到秒的流支付限制**：Move 合约用 Sui Clock 校验 `max_spend_per_second`、总额与过期时间。
- **Sponsor 稳定币手续费**：guarded flow 可通过 `execute_payment_with_fee<T>` 在同一稳定币中补偿 sponsor。
- **Walrus 审计追踪**：Agent 上传推理证据，链上/Producer API 记录 `walrus_blob_id` 或 `fallback:<sha256>`。
- **Postgres Producer API**：维护 merchant、checkout session、payment intent、agent allowance 与 sponsor attempt。
- **Human Dashboard**：Next.js + Tailwind + Sui dApp Kit 的 operator setup、merchant checkout/status 与 audit trail 控制台。

| 组件 | 技术 |
|---|---|
| Blockchain | Sui Testnet |
| Smart Contracts | Sui Move |
| Producer API | Node.js/Bun + Postgres |
| Agent Scripts | TypeScript + `@mysten/sui` |
| Frontend | Next.js 16, React, Tailwind CSS, `@mysten/dapp-kit` |

## 目录结构

```text
.
├── agent_wallet/           # Sui Move 智能合约
├── agent_scripts/          # Agent 本地执行、intent 创建与 e2e runner
├── producer_api/           # Postgres checkout/intent/sponsor API
│   ├── migrations/
│   ├── scripts/
│   └── server.mjs
├── sdk/                    # SafeFlow TS SDK
├── web/                    # Demo console 与 public checkout page
├── docs/                   # 项目文档
└── safe-flow-sui-skill/    # 可发布/同步的 Agent skill
```

## 运行步骤

### 1. 部署 Sui Move 合约

```bash
cd agent_wallet
sui move build
sui move test --build-env testnet
sui client publish --gas-budget 100000000 --json
```

记录发布得到的 `PACKAGE_ID`。

### 2. 运行 Producer API

```bash
cd producer_api
bun install

export DATABASE_URL=postgres://postgres:postgres@localhost:5432/safeflow
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
export PACKAGE_ID=<YOUR_PACKAGE_ID>
export SPONSOR_SECRET_KEY=<SPONSOR_SUI_PRIVATE_KEY>
export SPONSOR_FEE_BPS=100
export SPONSOR_MIN_FEE_ATOMIC=0
export SPONSOR_FEE_RECIPIENT=<SPONSOR_STABLECOIN_FEE_ADDRESS>
export NATIVE_GASLESS_COIN_TYPES=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
export DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
export DEFAULT_CURRENCY_SYMBOL=USDC
export DEFAULT_CURRENCY_DECIMALS=6
export DEMO_PAYOUT_ADDRESS=<MERCHANT_PAYOUT_ADDRESS>
export DEMO_AGENT_ADDRESS=<AGENT_ADDRESS>
export DEMO_WALLET_ID=<WALLET_ID_FOR_GUARDED_FLOW>
export DEMO_SESSION_CAP_ID=<SESSION_CAP_ID_FOR_GUARDED_FLOW>

bun run migrate
bun run seed:demo
bun run dev
```

`seed:demo` 会打印一次 merchant API key。创建 checkout session 时作为 `x-api-key` 使用。

### 3. 创建 Checkout Session 并运行 Agent

```bash
curl -X POST http://localhost:8787/v1/checkout/sessions \
  -H "content-type: application/json" \
  -H "x-api-key: <MERCHANT_API_KEY>" \
  -d '{
    "merchantOrderId": "order-demo-001",
    "executionRail": "auto",
    "amountAtomic": 1000000,
    "reason": "demo USDC checkout"
  }'
```

Guarded flow 加上：

```json
{
  "requiresGuard": true,
  "walletId": "<WALLET_ID>",
  "sessionCapId": "<SESSION_CAP_ID>"
}
```

运行 Agent：

```bash
cd agent_scripts
bun install
export PRODUCER_API_BASE_URL=http://localhost:8787
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
export PACKAGE_ID=<YOUR_PACKAGE_ID>
export DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
export WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
export WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
export WALRUS_DEGRADE_ON_UPLOAD_FAILURE=true

bunx tsx e2e_runner.ts --poll-ms 3000
```

### 4. 运行 Web 控制台

```bash
cd web
bun install
export NEXT_PUBLIC_PACKAGE_ID=<YOUR_PACKAGE_ID>
export NEXT_PUBLIC_PRODUCER_API_BASE_URL=http://localhost:8787
export NEXT_PUBLIC_DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
export NEXT_PUBLIC_WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
export NEXT_PUBLIC_WALRUS_SITE_SUFFIX=.walrus.site
export NEXT_PUBLIC_DEMO_AGENT_ADDRESS=<AGENT_ADDRESS>
export NEXT_PUBLIC_DEMO_WALLET_ID=<WALLET_ID_FOR_GUARDED_FLOW>
export NEXT_PUBLIC_DEMO_SESSION_CAP_ID=<SESSION_CAP_ID_FOR_GUARDED_FLOW>
export NEXT_PUBLIC_DEMO_MERCHANT_API_KEY=<MERCHANT_API_KEY_FROM_SEED_DEMO>
bun run dev
```

打开 `http://localhost:3000`。控制台可自动填入本地 demo 参数、创建 merchant checkout、查看 public checkout 页面、跟踪 session 状态，并在 audit trail 中查看 `txDigest` 与 Walrus evidence。`http://localhost:3000/admin` 会引导 guarded wallet funding、Producer seed 片段和 Agent Runner 命令。

## Docker 镜像与服务器部署

后端服务可以用仓库根目录的 `Dockerfile` 构建两个镜像：

- `producer_api` target：运行 Producer API，并在容器启动前执行数据库 migration。
- `agent_runner` target：运行 `agent_scripts/e2e_runner.ts`，从挂载的 `agent_scripts/.agent_key.json` 等价文件读取 Agent 私钥。

GitHub Actions workflow 位于 `.github/workflows/docker-images.yml`。推送到 `main`、推送 `v*` tag 或手动触发时，会构建并推送：

- `ghcr.io/<owner>/<repo>-producer-api:<tag>`
- `ghcr.io/<owner>/<repo>-agent-runner:<tag>`

PR 只构建，不推送镜像。

服务器上准备配置：

```bash
cp deploy/compose.env.example deploy/compose.env
cp deploy/producer_api.env.example deploy/producer_api.env
cp deploy/agent_runner.env.example deploy/agent_runner.env
cp agent_scripts/.agent_key.json deploy/agent_key.json
```

编辑这几个文件：

- `deploy/compose.env`：设置 GHCR 镜像名、tag、Postgres 密码、API 对外端口。
- `deploy/producer_api.env`：设置 `PACKAGE_ID`、`PRODUCER_SIGNING_SECRET`、`SPONSOR_SECRET_KEY`、demo merchant/allowance 绑定、以及 `APP_URL=<Cloudflare 前端 URL>`。
- `deploy/agent_runner.env`：设置同一个 `PACKAGE_ID` 与 `PRODUCER_SIGNING_SECRET`，并保留 `PRODUCER_API_BASE_URL=http://producer-api:8787`。
- `deploy/agent_key.json`：Agent 私钥文件，只在服务器挂载，不能提交到 git。

启动后端 stack：

```bash
# 拉取 GHCR 镜像；如果要在服务器本地构建，可改用 docker compose build。
docker compose --env-file deploy/compose.env pull producer-api agent-runner

# 一次性启动 Postgres + Producer API + Agent Runner。
# Producer API 会自动执行 migrations；Agent Runner 会等 API healthcheck 通过后再启动。
docker compose --env-file deploy/compose.env up -d

# 首次或重置 demo binding 后 seed merchant/allowance。
docker compose --env-file deploy/compose.env --profile seed run --rm producer-api-seed-demo
```

这里的“融合”发生在编排层：`producer-api` 和 `agent-runner` 仍是两个容器。不要把 Agent Runner 嵌入 Producer API 进程里，否则 API 重启、runner 重启、agent 私钥挂载、日志排查和横向扩容都会变得更难控制。若只想调试 API，可以临时只启动 `docker compose --env-file deploy/compose.env up -d postgres producer-api`。

常用运维命令：

```bash
docker compose --env-file deploy/compose.env logs -f producer-api
docker compose --env-file deploy/compose.env logs -f agent-runner
docker compose --env-file deploy/compose.env ps
docker compose --env-file deploy/compose.env down
```

前端部署到 Cloudflare Pages/Workers 时，只需要把构建变量指向服务器 API：

```bash
NEXT_PUBLIC_PACKAGE_ID=<YOUR_PACKAGE_ID>
NEXT_PUBLIC_PRODUCER_API_BASE_URL=https://api.your-domain.example
NEXT_PUBLIC_DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
NEXT_PUBLIC_WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
NEXT_PUBLIC_WALRUS_SITE_SUFFIX=.walrus.site
NEXT_PUBLIC_DEMO_AGENT_ADDRESS=<AGENT_ADDRESS>
NEXT_PUBLIC_DEMO_WALLET_ID=<WALLET_ID_FOR_GUARDED_FLOW>
NEXT_PUBLIC_DEMO_SESSION_CAP_ID=<SESSION_CAP_ID_FOR_GUARDED_FLOW>
NEXT_PUBLIC_DEMO_MERCHANT_API_KEY=<MERCHANT_API_KEY_FROM_SEED_DEMO>
```

## Track 匹配

Hackathon eligibility：SafeFlow 是 Sui 项目，本次 SuiOverflow 2026 提交的核心是黑客松期间完成的 Gasless Checkout + AgentPay Guard 明确定义新功能与 redesign。

1. **Safety & Security**：`SessionCap`、Move Object capability、Walrus evidence 与 Postgres intent 状态机共同限制 Agent 越权与提示词注入风险。
2. **Local God Mode**：OpenClaw Agent 在本地运行，自动处理 checkout intent；简单交易无需 Agent SUI gas，复杂交易由 sponsor 支付执行 gas。

## 许可证

MIT License
