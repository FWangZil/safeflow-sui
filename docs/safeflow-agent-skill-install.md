# SafeFlow Agent Skill Install

SafeFlow's reusable agent skill is published at:

- [`FWangZil/safe-flow-sui-skill`](https://github.com/FWangZil/safe-flow-sui-skill)

OpenClaw and other compatible agent runtimes can install it with:

```bash
npx skills add FWangZil/safe-flow-sui-skill
```

or:

```bash
npx clawhub@latest install safe-flow-sui-skill
```

After installation, the agent can run SafeFlow workflows including:

1. local Sui CLI bootstrap and agent wallet/address preparation,
2. owner-assisted wallet/session provisioning handoff,
3. controlled payment execution with `SessionCap`,
4. producer intent E2E tests with Walrus evidence upload.
