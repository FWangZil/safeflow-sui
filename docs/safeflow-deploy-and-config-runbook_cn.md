# SafeFlow 部署与配置手册

本文记录当前 SafeFlow Sui demo 的部署与配置边界：Move 包发布、Producer API/Postgres、赞助者密钥、Agent Runner 和 Web 控制台。

## 目标状态

- 合约仍位于 `agent_wallet/`，核心 Guard 是 `AgentWallet<T>` + `SessionCap`。
- Producer API 使用 Postgres，不再为新 checkout flow 使用 JSON 文件状态。
- Checkout 默认 `executionRail=auto`：
  - allowlisted stablecoin 且不需要 Guard 时走 `native_gasless`。
  - 指定 `requiresGuard` 或携带 `walletId/sessionCapId` 时走 `sponsored_guard`。
- 默认稳定币是 Circle Sui testnet USDC：
  `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC`

## 发布 Move 包

在仓库根目录执行：

```bash
chmod +x scripts/deploy_and_configure_safeflow.sh
./scripts/deploy_and_configure_safeflow.sh
```

可选 gas budget：

```bash
./scripts/deploy_and_configure_safeflow.sh --gas-budget 200000000
```

脚本会：

1. 检查 `sui` 与 `jq`。
2. 备份并清空 `agent_wallet/Published.toml`，便于本地重复发布。
3. 执行 `sui client publish --gas-budget <value> --json`。
4. 从 publish JSON 中解析 `PACKAGE_ID`。
5. 写入 `agent_scripts/.env` 和 `web/.env.local` 的基础合约/Walrus/Producer API 配置。

## Producer API 配置

```bash
cd producer_api
bun install

export DATABASE_URL=postgres://postgres:postgres@localhost:5432/safeflow
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
export PACKAGE_ID=<YOUR_PACKAGE_ID>
export SUI_NETWORK=testnet
export NEXT_PUBLIC_APP_URL=http://localhost:3000

export DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
export DEFAULT_CURRENCY_SYMBOL=USDC
export DEFAULT_CURRENCY_DECIMALS=6
export NATIVE_GASLESS_COIN_TYPES=$DEFAULT_COIN_TYPE

export SPONSOR_SECRET_KEY=<SPONSOR_SUI_PRIVATE_KEY>
export SPONSOR_MAX_GAS_BUDGET=10000000
export SPONSOR_FEE_BPS=100
export SPONSOR_MIN_FEE_ATOMIC=0
export SPONSOR_FEE_RECIPIENT=<SPONSOR_STABLECOIN_FEE_ADDRESS>

export DEMO_PAYOUT_ADDRESS=<MERCHANT_PAYOUT_ADDRESS>
export DEMO_AGENT_ADDRESS=<AGENT_ADDRESS>
export DEMO_WALLET_ID=<WALLET_ID_FOR_GUARDED_FLOW>
export DEMO_SESSION_CAP_ID=<SESSION_CAP_ID_FOR_GUARDED_FLOW>

bun run migrate
bun run seed:demo
bun run dev
```

`seed:demo` 会打印一次 merchant API key。后续创建 checkout session 时作为 `x-api-key` 使用。

## Agent Runner 配置

```bash
cd agent_scripts
bun install

export PRODUCER_API_BASE_URL=http://localhost:8787
export PRODUCER_SIGNING_SECRET=dev-secret-change-me
export PACKAGE_ID=<YOUR_PACKAGE_ID>
export DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
export WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
export WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
export WALRUS_EPOCHS=5
export WALRUS_DEGRADE_ON_UPLOAD_FAILURE=true

bunx tsx e2e_runner.ts --poll-ms 3000
```

Runner 会拉取 intent、验签、ACK、上传 Walrus 证据，然后根据 Producer API 解析出的 rail 自动执行：

- `native_gasless`：简单 allowlisted stablecoin 转账。
- `sponsored_guard`：向 Producer API 请求 sponsor 构造的 `execute_payment<T>` 或 `execute_payment_with_fee<T>` 交易，Agent 追加签名后双签提交。

## Web 控制台配置

```bash
cd web
bun install

export NEXT_PUBLIC_PACKAGE_ID=<YOUR_PACKAGE_ID>
export NEXT_PUBLIC_PRODUCER_API_BASE_URL=http://localhost:8787
export NEXT_PUBLIC_DEFAULT_COIN_TYPE=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
export NEXT_PUBLIC_WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
export NEXT_PUBLIC_WALRUS_SITE_SUFFIX=.walrus.site

bun run dev
```

控制台包含 operator setup、merchant checkout/status 和 audit trail。公开 checkout 页面会轮询 session 状态。

## 资金准备

- Native gasless 简单转账：需要 allowlisted stablecoin，Agent 不需要 SUI gas。
- Sponsored guard：Sponsor 需要 SUI 支付交易 gas；`AgentWallet<T>` 需要预存对应稳定币。
- Sponsor fee reimbursement：当 `SPONSOR_FEE_BPS` 或 `SPONSOR_MIN_FEE_ATOMIC` 配置后，guarded flow 可以在同一稳定币中扣除 sponsor 手续费。

`scripts/deposit_safeflow_wallet.sh` 是旧的 `Coin<SUI>` 便捷脚本，仍可用于 SUI 类型低层调试。USDC demo 请使用 Dashboard 或 Sui PTB/CLI 调用 `wallet::deposit<USDC>`，不要直接把 coin 转给 `walletId`。

## 常见问题

1. `DATABASE_URL is required`
   - 新 checkout flow 依赖 Postgres；先启动数据库并执行 `bun run migrate`。
2. `PACKAGE_ID is required`
   - sponsor 构造 guarded Move 调用时必须知道已发布包。
3. Native gasless 没有命中
   - 检查 `coinType` 是否在 `NATIVE_GASLESS_COIN_TYPES` 中，且 session 未设置 `requiresGuard` / `walletId` / `sessionCapId`。
4. Guarded sponsor 失败
   - 检查 intent 是否已被该 `agentAddress` claim、Sponsor SUI gas 是否足够、`SPONSOR_SECRET_KEY` 是否有效。
