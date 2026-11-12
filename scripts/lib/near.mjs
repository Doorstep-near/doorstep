// Small NEAR helpers with no dependencies (Node 20+).
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const USDC_NEAR = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const USDC_NEAR_ASSET = `nep141:${USDC_NEAR}`;
export const DEFAULT_RPC = process.env.NEAR_RPC || "https://rpc.mainnet.fastnear.com";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function b58decode(str) {
  let n = 0n;
  for (const ch of str) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error(`Bad base58 character: ${ch}`);
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const ch of str) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------- ed25519 keys

/** New ed25519 key pair; `publicKey` is in NEAR form ("ed25519:<base58>"). */
export function newKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  return { publicKey: nearPublicKey(jwk), jwk };
}

export function nearPublicKey(jwk) {
  return "ed25519:" + b58encode(Buffer.from(jwk.x, "base64url"));
}

export function saveKey(path, key) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(key, null, 2), { mode: 0o600 });
}

export function loadKey(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Signs `message` (utf8) and returns the 64-byte signature as base64. */
export function signMessage(jwk, message) {
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  return sign(null, Buffer.from(message, "utf8"), key).toString("base64");
}

export function verifyMessage(nearPk, message, signatureB64) {
  const raw = b58decode(nearPk.replace(/^ed25519:/, ""));
  const key = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") },
    format: "jwk",
  });
  return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
}

// ------------------------------------------------------------------ NEAR RPC

export async function viewCall(contract, method, args = {}, rpc = DEFAULT_RPC) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "doorstep",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contract,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`RPC error: ${JSON.stringify(body.error)}`);
  if (body.result?.error) throw new Error(`View error: ${body.result.error}`);
  const text = Buffer.from(body.result.result).toString("utf8");
  return text ? JSON.parse(text) : null;
}

export const messages = {
  delivered: (orderId, contract) => `delivered|${orderId}|${contract}`,
  complaint: (orderId, contract) => `complaint|${orderId}|${contract}`,
  checker: (orderId, courierRef, signedAt, contract) =>
    `checker|delivered|${orderId}|${courierRef}|${signedAt}|${contract}`,
};

/** USDC has 6 decimals: "2" -> "2000000", "1.5" -> "1500000". */
export function usdcToUnits(amount) {
  const [whole, frac = ""] = String(amount).split(".");
  if (frac.length > 6) throw new Error("USDC has at most 6 decimals");
  return (BigInt(whole || "0") * 1_000_000n + BigInt(frac.padEnd(6, "0") || "0")).toString();
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[k] = true;
      else {
        out[k] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}
