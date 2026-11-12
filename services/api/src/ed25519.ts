// ed25519 with node:crypto only (same approach as scripts/lib/near.mjs).
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type JsonWebKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { b58decode, b58encode } from "./util";

export interface Ed25519Signer {
  /** NEAR form, "ed25519:<base58>". */
  publicKey: string;
  /** Signs a UTF-8 message; returns standard base64 of the 64-byte signature. */
  sign(message: string): string;
}

/** Verifies a base64 signature over a UTF-8 message. Returns false on any malformed input. */
export function verifyEd25519(nearPublicKey: string, message: string, signatureB64: string): boolean {
  try {
    const raw = b58decode(nearPublicKey.replace(/^ed25519:/, ""));
    if (raw.length !== 32) return false;
    const sig = Buffer.from(signatureB64, "base64");
    if (sig.length !== 64) return false;
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") }, format: "jwk" });
    return verify(null, Buffer.from(message, "utf8"), key, sig);
  } catch {
    return false;
  }
}

function signerFromKeyObject(key: KeyObject): Ed25519Signer {
  const jwk = key.export({ format: "jwk" }) as JsonWebKey;
  const publicKey = "ed25519:" + b58encode(Buffer.from(jwk.x as string, "base64url"));
  return { publicKey, sign: (message) => sign(null, Buffer.from(message, "utf8"), key).toString("base64") };
}

export function signerFromJwk(jwk: JsonWebKey): Ed25519Signer {
  return signerFromKeyObject(createPrivateKey({ key: jwk, format: "jwk" }));
}

/** From NEAR's "ed25519:<base58 of 64 bytes: 32 seed + 32 public>" secret key form. */
export function signerFromNearSecret(secret: string): Ed25519Signer {
  const raw = b58decode(secret.replace(/^ed25519:/, ""));
  if (raw.length !== 64 && raw.length !== 32) throw new Error("Bad ed25519 secret key length");
  const seed = Buffer.from(raw.slice(0, 32));
  return signerFromJwk({ kty: "OKP", crv: "Ed25519", d: seed.toString("base64url"), x: publicXFromSeed(seed) });
}

function publicXFromSeed(seed: Buffer): string {
  // PKCS#8 DER prefix for a raw ed25519 seed lets node derive the public key.
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const jwk = createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" })).export({ format: "jwk" }) as JsonWebKey;
  return jwk.x as string;
}

/** Fresh random key (demo checker, demo buyers, tests). */
export function newSigner(): Ed25519Signer & { jwk: JsonWebKey } {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { ...signerFromKeyObject(privateKey), jwk: privateKey.export({ format: "jwk" }) as JsonWebKey };
}

/** NEAR secret-key string for a JWK (used by scripts/add-relayer-key.sh's helper and tests). */
export function nearSecretFromJwk(jwk: JsonWebKey): string {
  const d = Buffer.from(jwk.d as string, "base64url");
  const x = Buffer.from(jwk.x as string, "base64url");
  return "ed25519:" + b58encode(Buffer.concat([d, x]));
}

/**
 * Loads a key file in either format we use:
 * - scripts/keys.mjs: { publicKey, jwk }
 * - NEAR credentials: { account_id?, public_key, private_key: "ed25519:..." } (or secret_key)
 * Never logs the contents.
 */
export function loadSignerFile(path: string): Ed25519Signer {
  const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  if (data.jwk && typeof data.jwk === "object") return signerFromJwk(data.jwk as JsonWebKey);
  const secret = (data.private_key ?? data.secret_key) as string | undefined;
  if (typeof secret === "string") return signerFromNearSecret(secret);
  throw new Error(`Unrecognised key file format: ${path}`);
}

/** The raw NEAR secret string from a credentials file (for near-api-js). */
export function loadNearSecret(path: string): string {
  const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const secret = (data.private_key ?? data.secret_key) as string | undefined;
  if (typeof secret === "string") return secret;
  if (data.jwk && typeof data.jwk === "object") return nearSecretFromJwk(data.jwk as JsonWebKey);
  throw new Error(`Unrecognised key file format: ${path}`);
}
