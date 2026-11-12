#!/usr/bin/env bash
# Deploy the escrow to NEAR with near-cli-rs (npm i -g near-cli-rs, or see
# https://github.com/near/near-cli-rs). Keys come from your system keychain
# (`near account import-account` first if needed).
#
#   cp .env.example .env   # fill it in
#   bash scripts/deploy.sh create     # make the escrow sub-account (funds it)
#   bash scripts/deploy.sh deploy     # deploy the wasm and call new(...)
#   bash scripts/deploy.sh register   # register the escrow with USDC (storage_deposit)
#   bash scripts/deploy.sh all        # all three in order
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
: "${OWNER:?set OWNER in .env}" "${ESCROW:?set ESCROW in .env}" "${RELAYER:?set RELAYER in .env}" "${CHECKER_PK:?set CHECKER_PK in .env}"

NETWORK="${NETWORK:-mainnet}"
WINDOW="${COMPLAINT_WINDOW_MS:-600000}"
USDC=17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1
WASM=contracts/escrow/res/doorstep_escrow.wasm

create() {
  # ESCROW must be a sub-account of OWNER, e.g. escrow.yourname.near.
  # ~267 KB of code needs about 2.7 NEAR of storage; 4 NEAR leaves room for orders.
  near account create-account fund-myself "$ESCROW" "${ESCROW_FUNDING:-4 NEAR}" \
    autogenerate-new-keypair save-to-keychain \
    sign-as "$OWNER" network-config "$NETWORK" sign-with-keychain send
}

deploy() {
  local args
  args=$(printf '{"owner":"%s","relayer":"%s","usdc":"%s","checker_pk":"%s","complaint_window_ms":"%s"}' \
    "$OWNER" "$RELAYER" "$USDC" "$CHECKER_PK" "$WINDOW")
  near contract deploy "$ESCROW" use-file "$WASM" \
    with-init-call new json-args "$args" \
    prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
    network-config "$NETWORK" sign-with-keychain send
}

register() {
  # Without this, USDC can't be sent to the escrow and 1Click payments are lost.
  near contract call-function as-transaction "$USDC" storage_deposit \
    json-args "{\"account_id\":\"$ESCROW\",\"registration_only\":true}" \
    prepaid-gas '30.0 Tgas' attached-deposit '0.00125 NEAR' \
    sign-as "$OWNER" network-config "$NETWORK" sign-with-keychain send
}

case "${1:-}" in
  create) create ;;
  deploy) deploy ;;
  register) register ;;
  all) create && deploy && register ;;
  *) echo "Usage: bash scripts/deploy.sh <create|deploy|register|all>"; exit 1 ;;
esac
