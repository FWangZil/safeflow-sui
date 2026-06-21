# Owner-Handoff Flow (Shared Contract)

Use this flow for realistic demo operation where owner controls guarded provisioning, and agent executes under Producer API policy plus SafeFlow guard constraints when a guard is required.

## Roles

- Owner (human): completes web provisioning, stablecoin predeposit, and returns wallet/session ids for guarded flows.
- Agent: consumes producer intents and executes either native gasless stablecoin transfer or sponsored guarded payment.

## Step-by-Step

1. Bootstrap handoff context:

```bash
cd .claude/skills/safe-flow-sui-skill/scripts
./bootstrap_owner_handoff.sh \
  --package-id 0xd3977766a8a8f3213c95455a2deff77d6cd271b6b666c10763a0362f1f5e4c09 \
  --portal-url https://dash.safeflow.space
```

2. Tell owner to do:
- transfer SUI gas to `agentAddress` only if the local runner must submit direct/non-gasless transactions;
- open the portal URL;
- complete stablecoin wallet predeposit and SessionCap provisioning;
- return `walletId` and `sessionCapId`.

3. Persist owner return values:

```bash
./save_owner_config.sh \
  --wallet-id <WALLET_ID> \
  --session-cap-id <SESSION_CAP_ID> \
  --coin-type 0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
```

4. Optional package id SQL sync:

```bash
./sync_package_id_to_sql.sh --driver sqlite
```

5. Execute Producer API test flow:

```bash
./test_publish_api_flow.sh --recipient <RECIPIENT_ADDRESS>
./test_publish_api_flow.sh --recipient <RECIPIENT_ADDRESS> --requires-guard
```

The first command lets Producer API auto-select the rail. The second command includes guard objects and exercises sponsored `SessionCap` execution.

## Produced Local Artifacts

- `.agent-address.txt`: agent execution address.
- `.owner-handoff.json`: owner-facing context and checklist.
- `.safeflow-config.json`: runtime config used by Producer API test helpers.
- `.safeflow-owner.env`: env exports for runner/test commands.
