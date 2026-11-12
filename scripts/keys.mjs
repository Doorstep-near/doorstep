#!/usr/bin/env node
// Make and use ed25519 keys the way the buyer's browser and the checker will.
//
//   node scripts/keys.mjs new --out .keys/buyer.json
//   node scripts/keys.mjs delivered --key .keys/buyer.json --order 1 --escrow escrow.you.near
//   node scripts/keys.mjs complaint --key .keys/buyer.json --order 1 --escrow escrow.you.near
//   node scripts/keys.mjs checker --key .keys/checker.json --order 1 --ref borzo:123 --escrow escrow.you.near
//
// The signature it prints is base64, ready for confirm_by_buyer / raise_complaint /
// confirm_by_checker. Keys are written with 0600 permissions; never commit .keys/.
import { newKey, saveKey, loadKey, signMessage, verifyMessage, nearPublicKey, messages, parseArgs } from "./lib/near.mjs";

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

function need(name) {
  if (!args[name] || args[name] === true) {
    console.error(`Missing --${name}`);
    process.exit(1);
  }
  return args[name];
}

function signAndPrint(message) {
  const key = loadKey(need("key"));
  const signature = signMessage(key.jwk, message);
  if (!verifyMessage(nearPublicKey(key.jwk), message, signature)) throw new Error("Self-check failed");
  console.log(JSON.stringify({ message, public_key: nearPublicKey(key.jwk), signature }, null, 2));
}

switch (cmd) {
  case "new": {
    const out = need("out");
    const key = newKey();
    saveKey(out, key);
    console.log(JSON.stringify({ saved: out, public_key: key.publicKey }, null, 2));
    break;
  }
  case "delivered":
    signAndPrint(messages.delivered(need("order"), need("escrow")));
    break;
  case "complaint":
    signAndPrint(messages.complaint(need("order"), need("escrow")));
    break;
  case "checker": {
    const signedAt = args["signed-at"] && args["signed-at"] !== true ? args["signed-at"] : Math.floor(Date.now() / 1000);
    signAndPrint(messages.checker(need("order"), need("ref"), signedAt, need("escrow")));
    console.error(`signed_at: ${signedAt}  (pass the same value to confirm_by_checker)`);
    break;
  }
  default:
    console.log("Usage: node scripts/keys.mjs <new|delivered|complaint|checker> [options]  (see the top of this file)");
    process.exit(cmd ? 1 : 0);
}
