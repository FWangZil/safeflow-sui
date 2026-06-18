# SafeFlow Agent Skill 安装指南

SafeFlow 可复用 Agent Skill 已发布在：

- [`FWangZil/safe-flow-sui-skill`](https://github.com/FWangZil/safe-flow-sui-skill)

OpenClaw 以及其他兼容的 Agent 运行时可通过以下命令安装：

```bash
npx skills add FWangZil/safe-flow-sui-skill
```

或者：

```bash
npx clawhub@latest install safe-flow-sui-skill
```

安装后，Agent 可以直接复用 SafeFlow 的关键流程：

1. 本地 Sui CLI 启动与 Agent 地址准备，
2. 主人协作式钱包/SessionCap 配置交接，
3. Producer API checkout 的 `executionRail=auto` 端到端测试，
4. native gasless allowlisted stablecoin checkout，
5. 基于 `AgentWallet<T>` / `SessionCap` 的 sponsored AgentPay Guard checkout，
6. Walrus evidence 上传与执行结果回写。
