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
3. 基于 `SessionCap` 的受控支付执行，
4. 带 Walrus 证据上传的 Producer Intent 端到端测试。
