# SafeFlow 部署与配置手册

本文记录从合约部署到本地配置写入的完整流程。

## 覆盖内容

1. 发布 `agent_wallet/` 下的 Move 包
2. 从 publish JSON 提取新的 `PACKAGE_ID`
3. 更新：
   - `agent_scripts/.env`
   - `web/.env.local`

## 一键脚本

在仓库根目录执行：

```bash
chmod +x scripts/deploy_and_configure_safeflow.sh
./scripts/deploy_and_configure_safeflow.sh
```

可选 gas budget：

```bash
./scripts/deploy_and_configure_safeflow.sh --gas-budget 200000000
```

## 脚本行为

1. 检查依赖：`sui`、`jq`
2. 备份 `agent_wallet/Published.toml` 到 `Published.toml.bak.<timestamp>`
3. 清空 `Published.toml`（便于重复本地发布）
4. 执行：

```bash
sui client publish --gas-budget <value> --json
```

5. 解析 `PACKAGE_ID`：
   - `.objectChanges[] | select(.type=="published") | .packageId`
   - 兜底：`.changed_objects[] ... | .objectId`
6. 写入 `agent_scripts/.env`：
   - `PACKAGE_ID`
   - `WALRUS_PUBLISHER_URL`
   - `WALRUS_AGGREGATOR_URL`
   - `WALRUS_EPOCHS`
   - `WALRUS_DEGRADE_ON_UPLOAD_FAILURE`
   - `PRODUCER_API_BASE_URL`
   - `PRODUCER_SIGNING_SECRET`
   - `PRODUCER_API_KEY`
7. 写入 `web/.env.local`：
   - `NEXT_PUBLIC_PACKAGE_ID`
   - `NEXT_PUBLIC_WALRUS_AGGREGATOR_URL`
   - `NEXT_PUBLIC_WALRUS_SITE_SUFFIX`
   - `NEXT_PUBLIC_PRODUCER_API_BASE_URL`

## 最新已发布包（示例）

- `PACKAGE_ID`: `0xcc76747b518ea5d07255a26141fb5e0b81fcdd0dc1cc578a83f88adc003a6191`

## 启动前端

```bash
cd web
npm run dev
```

## 给 AgentWallet 充值

不要直接转账到 `walletId`，应调用合约 `deposit`：

```bash
chmod +x scripts/deposit_safeflow_wallet.sh
./scripts/deposit_safeflow_wallet.sh --wallet-id <WALLET_ID> --amount-mist 1000000000
```

可选参数：

```bash
./scripts/deposit_safeflow_wallet.sh \
  --wallet-id <WALLET_ID> \
  --amount-mist 500000000 \
  --package-id <PACKAGE_ID> \
  --from-coin-id <GAS_COIN_ID> \
  --gas-budget 10000000
```

## 常见问题

1. TLS/证书错误：
   - 在可访问系统证书与外网的环境中执行发布命令。
2. `already published`：
   - 确认 `Published.toml` 已重置（脚本已自动处理并备份）。
3. `PACKAGE_ID` 解析失败：
   - 查看脚本输出的 raw/parsed 文件排查字段格式变化。
