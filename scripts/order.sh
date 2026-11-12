#!/usr/bin/env bash
# Drive one order by hand on mainnet, for the Thursday test.
#
#   bash scripts/order.sh create [price_units]        # default 2000000 = 2 USDC, deadline in 24 h
#   bash scripts/order.sh show <order_id>
#   bash scripts/order.sh delivered <order_id>         # sign as the buyer and submit confirm_by_buyer
#   bash scripts/order.sh release <order_id>           # after the complaint window
#   bash scripts/order.sh refund <order_id>            # after the deadline, if not delivered
#   bash scripts/order.sh intents-balance <account>    # USDC credited to an account inside NEAR Intents
#   bash scripts/order.sh unmatched                    # payments the escrow parked
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
: "${OWNER:?}" "${ESCROW:?}" "${SELLER:?set SELLER in .env}" "${BUYER_REFUND:?set BUYER_REFUND in .env}"
NETWORK="${NETWORK:-mainnet}"
CALLER="${RELAYER:-$OWNER}"
BUYER_KEY="${BUYER_KEY:-.keys/buyer.json}"
USDC=17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1

view() { near contract call-function as-read-only "$1" "$2" json-args "$3" network-config "$NETWORK" now; }
call() {
  near contract call-function as-transaction "$ESCROW" "$1" json-args "$2" \
    prepaid-gas "${3:-30.0 Tgas}" attached-deposit '0 NEAR' \
    sign-as "$CALLER" network-config "$NETWORK" sign-with-keychain send
}

case "${1:-}" in
  create)
    [ -f "$BUYER_KEY" ] || node scripts/keys.mjs new --out "$BUYER_KEY" >/dev/null
    BUYER_PK=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$BUYER_KEY')).publicKey)")
    DEADLINE_MS=$(( ($(date +%s) + 86400) * 1000 ))
    call create_order "$(printf '{"seller":"%s","price":"%s","deadline_ms":"%s","buyer_pk":"%s","buyer_refund":"%s"}' \
      "$SELLER" "${2:-2000000}" "$DEADLINE_MS" "$BUYER_PK" "$BUYER_REFUND")"
    echo "The new order id is in the result above (or run: bash scripts/order.sh show <id>)."
    ;;
  show) view "$ESCROW" get_order "{\"order_id\":\"$2\"}" ;;
  delivered)
    SIG=$(node scripts/keys.mjs delivered --key "$BUYER_KEY" --order "$2" --escrow "$ESCROW" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).signature))")
    call confirm_by_buyer "{\"order_id\":\"$2\",\"signature\":\"$SIG\"}"
    ;;
  release) call release "{\"order_id\":\"$2\"}" '100.0 Tgas' ;;
  refund) call refund "{\"order_id\":\"$2\"}" '100.0 Tgas' ;;
  intents-balance) view intents.near mt_balance_of "{\"account_id\":\"$2\",\"token_id\":\"nep141:$USDC\"}" ;;
  unmatched) view "$ESCROW" get_unmatched '{}' ;;
  *) sed -n '2,11p' "$0"; exit 1 ;;
esac
