#!/usr/bin/env bash
set -euo pipefail

# Deploy SafeFlow Move package and update local app config files with PACKAGE_ID.
#
# Usage:
#   ./scripts/deploy_and_configure_safeflow.sh [--gas-budget 200000000]
#
# Output:
#   - Updates agent_wallet/Published.toml (backs up existing file)
#   - Writes agent_scripts/.env with PACKAGE_ID
#   - Writes web/.env.local with NEXT_PUBLIC_PACKAGE_ID

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_WALLET_DIR="$ROOT_DIR/agent_wallet"
AGENT_SCRIPTS_ENV="$ROOT_DIR/agent_scripts/.env"
WEB_ENV_LOCAL="$ROOT_DIR/web/.env.local"

GAS_BUDGET="200000000"
WALRUS_PUBLISHER_URL_DEFAULT="${WALRUS_PUBLISHER_URL:-https://publisher.walrus-testnet.walrus.space}"
WALRUS_AGGREGATOR_URL_DEFAULT="${WALRUS_AGGREGATOR_URL:-https://aggregator.walrus-testnet.walrus.space}"
WALRUS_EPOCHS_DEFAULT="${WALRUS_EPOCHS:-5}"
WALRUS_DEGRADE_ON_UPLOAD_FAILURE_DEFAULT="${WALRUS_DEGRADE_ON_UPLOAD_FAILURE:-true}"
WALRUS_SITE_SUFFIX_DEFAULT="${WALRUS_SITE_SUFFIX:-.walrus.site}"
PRODUCER_API_BASE_URL_DEFAULT="${PRODUCER_API_BASE_URL:-http://localhost:8787}"
PRODUCER_SIGNING_SECRET_DEFAULT="${PRODUCER_SIGNING_SECRET:-dev-secret-change-me}"
PRODUCER_API_KEY_DEFAULT="${PRODUCER_API_KEY:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gas-budget)
      GAS_BUDGET="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: ./scripts/deploy_and_configure_safeflow.sh [--gas-budget <number>]" >&2
      exit 1
      ;;
  esac
done

if ! command -v sui >/dev/null 2>&1; then
  echo "sui CLI not found. Install from https://docs.sui.io/guides/developer/getting-started/sui-install" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found. Install jq first." >&2
  exit 1
fi

cd "$AGENT_WALLET_DIR"

TS="$(date +%Y%m%d%H%M%S)"
if [[ -f Published.toml ]]; then
  cp Published.toml "Published.toml.bak.${TS}"
fi
: > Published.toml

TMP_OUT="$(mktemp)"
sui client publish --gas-budget "$GAS_BUDGET" --json > "$TMP_OUT" 2>&1 || {
  echo "Publish failed. Output:" >&2
  sed -n '1,220p' "$TMP_OUT" >&2
  exit 1
}

TMP_JSON="${TMP_OUT}.json"
awk 'BEGIN{p=0} /^\s*\{/{p=1} p{print}' "$TMP_OUT" > "$TMP_JSON"

PACKAGE_ID="$(jq -r '.objectChanges[]? | select(.type=="published") | .packageId' "$TMP_JSON" | head -n1)"
if [[ -z "$PACKAGE_ID" || "$PACKAGE_ID" == "null" ]]; then
  PACKAGE_ID="$(jq -r '.changed_objects[]? | select(.idOperation=="CREATED" and (.objectType|test("package::"))) | .objectId' "$TMP_JSON" | head -n1)"
fi

if [[ -z "$PACKAGE_ID" || "$PACKAGE_ID" == "null" ]]; then
  echo "Could not parse PACKAGE_ID from publish output." >&2
  echo "Raw output file: $TMP_OUT" >&2
  echo "Parsed json file: $TMP_JSON" >&2
  exit 1
fi

cat > "$AGENT_SCRIPTS_ENV" <<EOF
PACKAGE_ID=$PACKAGE_ID
WALRUS_PUBLISHER_URL=$WALRUS_PUBLISHER_URL_DEFAULT
WALRUS_AGGREGATOR_URL=$WALRUS_AGGREGATOR_URL_DEFAULT
WALRUS_EPOCHS=$WALRUS_EPOCHS_DEFAULT
WALRUS_DEGRADE_ON_UPLOAD_FAILURE=$WALRUS_DEGRADE_ON_UPLOAD_FAILURE_DEFAULT
PRODUCER_API_BASE_URL=$PRODUCER_API_BASE_URL_DEFAULT
PRODUCER_SIGNING_SECRET=$PRODUCER_SIGNING_SECRET_DEFAULT
PRODUCER_API_KEY=$PRODUCER_API_KEY_DEFAULT
EOF

cat > "$WEB_ENV_LOCAL" <<EOF
NEXT_PUBLIC_PACKAGE_ID=$PACKAGE_ID
NEXT_PUBLIC_WALRUS_AGGREGATOR_URL=$WALRUS_AGGREGATOR_URL_DEFAULT
NEXT_PUBLIC_WALRUS_SITE_SUFFIX=$WALRUS_SITE_SUFFIX_DEFAULT
NEXT_PUBLIC_PRODUCER_API_BASE_URL=$PRODUCER_API_BASE_URL_DEFAULT
EOF

echo "Done."
echo "PACKAGE_ID=$PACKAGE_ID"
echo "Published.toml backup: Published.toml.bak.${TS}"
echo "agent_scripts/.env updated: $AGENT_SCRIPTS_ENV"
echo "web/.env.local updated: $WEB_ENV_LOCAL"
echo "Publish raw output: $TMP_OUT"
echo "Publish parsed json: $TMP_JSON"
