#!/usr/bin/env bash
#
# propagate_package_id.sh — swap the SafeFlow agent_wallet PACKAGE_ID across the
# repo after republishing the Move package to testnet.
#
# Usage:
#   scripts/propagate_package_id.sh 0x<new-64-hex-package-id>
#
# Idempotent: replaces every occurrence of the old (drifted) package id with the
# new one in the source-controlled config/scripts/docs, rewrites the
# "Known source/deployment drift" note in docs/architecture_en.md to "Resolved",
# and reminds you about the runtime-only env (producer_api).
#
set -euo pipefail

OLD_ID="0xd3977766a8a8f3213c95455a2deff77d6cd271b6b666c10763a0362f1f5e4c09"
NEW_ID="${1:-}"

if [[ ! "$NEW_ID" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "ERROR: pass the new PACKAGE_ID as 0x + 64 hex chars" >&2
  echo "Usage: $0 0x<new-package-id>" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Source-controlled sites that carry the literal id.
FILES=(
  "agent_scripts/.env"
  "web/.env.local"
  ".claude/skills/using-safeflow-shared-contract/scripts/setup.sh"
  ".claude/skills/using-safeflow-shared-contract/scripts/bootstrap_owner_handoff.sh"
  ".claude/skills/using-safeflow-shared-contract/scripts/save_owner_config.sh"
  ".claude/skills/using-safeflow-shared-contract/references/owner-handoff-flow.md"
  "docs/architecture_en.md"
)

# Untracked skill mirror (present in working tree); update if it exists.
MIRROR=(
  "safe-flow-sui-skill/clawhub/scripts/setup.sh"
  "safe-flow-sui-skill/clawhub/scripts/bootstrap_owner_handoff.sh"
  "safe-flow-sui-skill/clawhub/scripts/save_owner_config.sh"
  "safe-flow-sui-skill/clawhub/references/owner-handoff-flow.md"
)

swap() {
  local f="$1"
  [[ -f "$f" ]] || { echo "  skip (missing): $f"; return; }
  if grep -q "$OLD_ID" "$f"; then
    # macOS/BSD sed in-place
    sed -i '' "s/${OLD_ID}/${NEW_ID}/g" "$f"
    echo "  updated: $f"
  else
    echo "  no-op (id not present): $f"
  fi
}

echo "Swapping ${OLD_ID}"
echo "      -> ${NEW_ID}"
echo "Source-controlled files:"
for f in "${FILES[@]}"; do swap "$f"; done
echo "Skill mirror (safe-flow-sui-skill/):"
for f in "${MIRROR[@]}"; do swap "$f"; done

# Rewrite the drift note to a resolved note (only if the warning is still there).
DOC="docs/architecture_en.md"
if grep -q "Known source/deployment drift" "$DOC"; then
  perl -0777 -i -pe 's/> \xE2\x9A\xA0\xEF\xB8\x8F \*\*Known source\/deployment drift\.\*\*.*?republishing `agent_wallet` and updating `PACKAGE_ID`\*\* everywhere\.\n/> \xE2\x9C\x85 **Source\/deployment drift resolved.** `agent_wallet` was republished to\n> testnet (see PACKAGE_ID above); the deployed package now exposes\n> `execute_payment_with_fee` \/ `SponsorFeePaid` in addition to `execute_payment`\n> (verified via `sui_getNormalizedMoveModule`). Both the default flow\n> (`SPONSOR_FEE_BPS=0`) and the on-chain sponsor-fee flow (`SPONSOR_FEE_BPS>0`)\n> run against the deployed package.\n/s' "$DOC"
  echo "  rewrote drift note -> resolved: $DOC"
fi

cat <<EOF

Done editing files. Remaining manual step:
  * producer_api reads PACKAGE_ID from the shell environment at launch (no file).
    Relaunch it with: export PACKAGE_ID=${NEW_ID}
    (same for producer_api/scripts/reconcile_from_chain.mjs invocations).
EOF
