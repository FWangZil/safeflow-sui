#!/usr/bin/env bash
set -euo pipefail

# Deposit SUI into SafeFlow AgentWallet by calling wallet::deposit.
#
# Usage:
#   ./scripts/deposit_safeflow_wallet.sh --wallet-id <WALLET_ID> --amount-mist <MIST> [--package-id <PACKAGE_ID>] [--from-coin-id <COIN_ID>] [--gas-budget 10000000]
#
# Notes:
# - This script does NOT transfer directly to wallet object ID.
# - It splits a Coin<SUI> from your gas coin, then calls deposit().

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_ENV_FILE="$ROOT_DIR/agent_scripts/.env"
WEB_ENV_FILE="$ROOT_DIR/web/.env.local"

SUI_COIN_TYPE="0x2::sui::SUI"
WALLET_ID=""
PACKAGE_ID=""
AMOUNT_MIST=""
FROM_COIN_ID=""
GAS_BUDGET="5000000"

usage() {
  cat <<EOF
Usage:
  ./scripts/deposit_safeflow_wallet.sh --wallet-id <WALLET_ID> --amount-mist <MIST> [--package-id <PACKAGE_ID>] [--from-coin-id <COIN_ID>] [--gas-budget 10000000]

Examples:
  ./scripts/deposit_safeflow_wallet.sh --wallet-id 0xabc... --amount-mist 1000000000
  ./scripts/deposit_safeflow_wallet.sh --wallet-id 0xabc... --amount-mist 500000000 --package-id 0xdef...
EOF
}

run_sui_json() {
  local tmp
  tmp="$(mktemp)"
  if ! "$@" > "$tmp" 2>&1; then
    echo "Command failed: $*" >&2
    sed -n '1,220p' "$tmp" >&2
    return 1
  fi

  local parsed
  parsed="$(awk 'BEGIN{p=0} /^[[:space:]]*[\{\[]/{p=1} p{print}' "$tmp")"
  if [[ -z "$parsed" ]]; then
    echo "Failed to parse JSON output from: $*" >&2
    sed -n '1,220p' "$tmp" >&2
    return 1
  fi

  printf '%s\n' "$parsed"
}

extract_created_sui_coin_id() {
  local tx_json="$1"
  local owner_addr="$2"

  local coin_id
  coin_id="$(echo "$tx_json" | jq -r \
    --arg owner "$owner_addr" \
    '.objectChanges[]? 
      | select(.type=="created"
      and (.objectType|contains("0x2::coin::Coin<0x2::sui::SUI>"))
      and (.owner.AddressOwner? == $owner))
      | .objectId' | head -n1)"

  if [[ -z "$coin_id" || "$coin_id" == "null" ]]; then
    coin_id="$(echo "$tx_json" | jq -r \
      '.objectChanges[]?
        | select(.type=="created"
        and (.objectType|contains("0x2::coin::Coin<0x2::sui::SUI>")))
        | .objectId' | head -n1)"
  fi

  printf '%s\n' "$coin_id"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wallet-id)
      WALLET_ID="$2"
      shift 2
      ;;
    --amount-mist)
      AMOUNT_MIST="$2"
      shift 2
      ;;
    --package-id)
      PACKAGE_ID="$2"
      shift 2
      ;;
    --from-coin-id)
      FROM_COIN_ID="$2"
      shift 2
      ;;
    --gas-budget)
      GAS_BUDGET="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v sui >/dev/null 2>&1; then
  echo "sui CLI not found." >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found." >&2
  exit 1
fi

if [[ -z "$WALLET_ID" || -z "$AMOUNT_MIST" ]]; then
  echo "--wallet-id and --amount-mist are required." >&2
  usage >&2
  exit 1
fi

if ! [[ "$AMOUNT_MIST" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid --amount-mist '$AMOUNT_MIST'. Must be a positive integer." >&2
  exit 1
fi

if [[ -z "$PACKAGE_ID" ]]; then
  if [[ -f "$AGENT_ENV_FILE" ]]; then
    PACKAGE_ID="$(awk -F= '$1=="PACKAGE_ID"{print $2}' "$AGENT_ENV_FILE" | tail -n1 | tr -d '[:space:]')"
  fi
  if [[ -z "$PACKAGE_ID" && -f "$WEB_ENV_FILE" ]]; then
    PACKAGE_ID="$(awk -F= '$1=="NEXT_PUBLIC_PACKAGE_ID"{print $2}' "$WEB_ENV_FILE" | tail -n1 | tr -d '[:space:]')"
  fi
fi

if [[ -z "$PACKAGE_ID" ]]; then
  echo "Missing package id. Pass --package-id or set it in agent_scripts/.env or web/.env.local" >&2
  exit 1
fi

MAX_GAS_BALANCE_MIST=""
if [[ -z "$FROM_COIN_ID" ]]; then
  GAS_JSON="$(run_sui_json sui client gas --json)"
  FROM_COIN_ID="$(echo "$GAS_JSON" | jq -r 'max_by(.mistBalance) | .gasCoinId')"
  MAX_GAS_BALANCE_MIST="$(echo "$GAS_JSON" | jq -r 'max_by(.mistBalance) | .mistBalance')"
fi

if [[ -z "$FROM_COIN_ID" || "$FROM_COIN_ID" == "null" ]]; then
  echo "Could not determine source gas coin. Pass --from-coin-id explicitly." >&2
  exit 1
fi

if [[ -n "$MAX_GAS_BALANCE_MIST" && "$MAX_GAS_BALANCE_MIST" != "null" ]]; then
  if (( MAX_GAS_BALANCE_MIST <= GAS_BUDGET )); then
    echo "Largest gas coin balance ($MAX_GAS_BALANCE_MIST MIST) is not enough for gas budget ($GAS_BUDGET)." >&2
    echo "Fund your signer address first or lower --gas-budget." >&2
    exit 1
  fi
fi

echo "Using package id: $PACKAGE_ID"
echo "Using wallet id:  $WALLET_ID"
echo "Deposit amount:   $AMOUNT_MIST MIST"
echo "Source coin:      $FROM_COIN_ID"
echo "Gas budget:       $GAS_BUDGET"

SIGNER_ADDRESS="$(sui client active-address 2>/dev/null | tr -d '[:space:]')"
if [[ -z "$SIGNER_ADDRESS" ]]; then
  echo "Could not read active signer address." >&2
  exit 1
fi

DEPOSIT_COIN_ID=""
if SPLIT_JSON="$(run_sui_json sui client split-coin \
  --coin-id "$FROM_COIN_ID" \
  --amounts "$AMOUNT_MIST" \
  --gas-budget "$GAS_BUDGET" \
  --json)"; then
  DEPOSIT_COIN_ID="$(extract_created_sui_coin_id "$SPLIT_JSON" "$SIGNER_ADDRESS")"
else
  echo "split-coin failed, trying transfer-sui self-split fallback..." >&2
  SELF_SPLIT_JSON="$(run_sui_json sui client transfer-sui \
    --to "$SIGNER_ADDRESS" \
    --sui-coin-object-id "$FROM_COIN_ID" \
    --amount "$AMOUNT_MIST" \
    --gas-budget "$GAS_BUDGET" \
    --json)"
  DEPOSIT_COIN_ID="$(extract_created_sui_coin_id "$SELF_SPLIT_JSON" "$SIGNER_ADDRESS")"
fi

if [[ -z "$DEPOSIT_COIN_ID" || "$DEPOSIT_COIN_ID" == "null" ]]; then
  echo "Failed to extract a Coin<SUI> object id for deposit." >&2
  exit 1
fi

DEPOSIT_JSON="$(run_sui_json sui client call \
  --package "$PACKAGE_ID" \
  --module wallet \
  --function deposit \
  --type-args "$SUI_COIN_TYPE" \
  --args "$WALLET_ID" "$DEPOSIT_COIN_ID" \
  --gas-budget "$GAS_BUDGET" \
  --json)"

STATUS="$(echo "$DEPOSIT_JSON" | jq -r '.effects.status.status // empty')"
if [[ "$STATUS" != "success" ]]; then
  echo "Deposit call failed:" >&2
  echo "$DEPOSIT_JSON" >&2
  exit 1
fi

DIGEST="$(echo "$DEPOSIT_JSON" | jq -r '.digest // empty')"
echo "Deposit success."
echo "Split coin id: $DEPOSIT_COIN_ID"
echo "Tx digest:     $DIGEST"
