#!/usr/bin/env bash
# Give the backend its own key for the relayer account: a FUNCTION-CALL access
# key that can only call the escrow's relayer methods (it can't move NEAR or
# call anything else).
#
#   bash scripts/add-relayer-key.sh
#
# 1. Generates an ed25519 key pair and writes .keys/relayer.json (mode 0600,
#    NEAR credentials format). Prints only the public key. Reuses the file if
#    it already exists.
# 2. Adds the public key to RELAYER_ACCOUNT with near-cli-rs, signed with the
#    account's full-access key from your keychain. THIS SENDS A TRANSACTION on
#    NETWORK (mainnet by default); it asks before sending.
#
# Reads from .env: ESCROW, RELAYER_ACCOUNT (or RELAYER), NETWORK, RELAYER_KEY_FILE,
# RELAYER_ALLOWANCE (NEAR the key may spend on gas; default "1 NEAR").
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
: "${ESCROW:?set ESCROW in .env}"
ACCOUNT="${RELAYER_ACCOUNT:-${RELAYER:?set RELAYER_ACCOUNT or RELAYER in .env}}"
KEY_FILE="${RELAYER_KEY_FILE:-.keys/relayer.json}"
NETWORK="${NETWORK:-mainnet}"
ALLOWANCE="${RELAYER_ALLOWANCE:-1 NEAR}"
METHODS="create_order,mark_shipped,confirm_by_buyer,confirm_by_checker,raise_complaint,release,refund"

if [ -f "$KEY_FILE" ]; then
  PK=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).public_key)" "$KEY_FILE")
  echo "Reusing $KEY_FILE"
else
  # Tiny helper: node:crypto only. Writes { account_id, public_key, private_key }
  # where private_key is NEAR's "ed25519:<base58 of 32-byte seed + 32-byte public key>".
  PK=$(node --input-type=module -e "$(cat <<'NODE'
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const [file, account] = process.argv.slice(1);
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = (bytes) => {
  let n = 0n, out = "";
  for (const b of bytes) n = n * 256n + BigInt(b);
  while (n > 0n) { out = A[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
};
const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
const seed = Buffer.from(jwk.d, "base64url");
const pub = Buffer.from(jwk.x, "base64url");
const publicKey = "ed25519:" + b58(pub);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify({ account_id: account, public_key: publicKey, private_key: "ed25519:" + b58(Buffer.concat([seed, pub])) }, null, 2) + "\n", { mode: 0o600 });
console.log(publicKey);
NODE
)" "$KEY_FILE" "$ACCOUNT")
  echo "Wrote $KEY_FILE (mode 0600)"
fi
echo "Relayer public key: $PK"

echo
echo "About to send a transaction on $NETWORK:"
echo "  add function-call key $PK to $ACCOUNT"
echo "  contract: $ESCROW   methods: $METHODS   allowance: $ALLOWANCE"
read -r -p "Send it? [y/N] " answer
[ "$answer" = "y" ] || [ "$answer" = "Y" ] || { echo "Not sent. The key file is kept; re-run to add it later."; exit 0; }

near account add-key "$ACCOUNT" \
  grant-function-call-access \
  --allowance "$ALLOWANCE" \
  --contract-account-id "$ESCROW" \
  --function-names "$METHODS" \
  use-manually-provided-public-key "$PK" \
  network-config "$NETWORK" sign-with-keychain send

echo "Done. Set RELAYER_ACCOUNT=$ACCOUNT and RELAYER_KEY_FILE=$KEY_FILE in .env (the defaults already match)."
echo "The escrow must name $ACCOUNT as its relayer (get_config.relayer); the owner can change it with set_relayer."
