#!/usr/bin/env node
// Adds a shop to data/merchants.json with a fresh seller token.
// The token is written to data/merchant-tokens/<id>.txt (mode 600) and never printed,
// so it doesn't end up in terminal logs. Send it to the shop privately.
//
//   npm run merchant:add -- --id spice --name "Spice Route" --account 0xabc...
//   [--address "Shop 4, Market Road, Delhi" --phone "+91 98100 00000"]  (only for Borzo)
//
// Then set MERCHANTS_FILE=data/merchants.json in .env and restart the API.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data", "merchants.json");
const TOKENS = join(ROOT, "data", "merchant-tokens");

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i];
  if (!k?.startsWith("--")) fail(`Unexpected argument: ${k}`);
  args[k.slice(2)] = process.argv[i + 1] ?? "";
}
function fail(msg) {
  console.error(`add-merchant: ${msg}`);
  process.exit(1);
}

const id = (args.id ?? "").trim();
const name = (args.name ?? "").trim();
const account = (args.account ?? "").trim();
if (!/^[a-z0-9-]{2,32}$/.test(id)) fail("--id must be 2-32 lowercase letters, digits or -");
if (!name || name.length > 80) fail("--name is required (max 80 characters)");
// NEAR account id, including lowercase 0x… (EVM) accounts in NEAR Intents.
if (account.length < 2 || account.length > 64 || !/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(account)) {
  fail("--account must be a NEAR account (e.g. shop.near) or a lowercase 0x… address");
}

const list = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [];
if (list.some((m) => m.id === id)) fail(`a shop with id "${id}" already exists`);
if (list.some((m) => m.account === account)) fail(`another shop already uses ${account}`);

const token = randomBytes(24).toString("base64url");
list.push({ id, name, account, token, address: args.address ?? "", phone: args.phone ?? "" });
mkdirSync(TOKENS, { recursive: true });
writeFileSync(FILE, JSON.stringify(list, null, 2) + "\n", { mode: 0o600 });
chmodSync(FILE, 0o600);
const tokenFile = join(TOKENS, `${id}.txt`);
writeFileSync(tokenFile, token + "\n", { mode: 0o600 });

console.log(`Added "${name}" (${id}), payouts to ${account}.`);
console.log(`Seller token saved in ${tokenFile} (open it yourself; it isn't printed here).`);
console.log("Next: set MERCHANTS_FILE=data/merchants.json in .env and restart the API.");
