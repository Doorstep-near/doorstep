// The buyer's ed25519 key. It is generated in the browser, stored per order in
// localStorage, and never sent anywhere except inside the user-controlled
// backup link fragment (#k=...), which browsers do not send to servers.
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { base58Decode, base58Encode } from "./base58";
import { base64UrlToBytes, bytesToBase64, bytesToBase64Url, utf8 } from "./bytes";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const STORAGE_PREFIX = "doorstep:key:";

export interface BuyerKey {
  /** 32-byte seed (the private key). */
  seed: Uint8Array;
  /** NEAR form: "ed25519:<base58>". */
  publicKey: string;
}

export function keyFromSeed(seed: Uint8Array): BuyerKey {
  if (seed.length !== 32) throw new Error("A buyer key seed is 32 bytes");
  return { seed, publicKey: nearPublicKey(ed.getPublicKey(seed)) };
}

export function generateKey(): BuyerKey {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  return keyFromSeed(seed);
}

export function nearPublicKey(pub: Uint8Array): string {
  return `ed25519:${base58Encode(pub)}`;
}

export function publicKeyBytes(nearPk: string): Uint8Array {
  return base58Decode(nearPk.replace(/^ed25519:/, ""));
}

/** Signs a UTF-8 message; returns standard base64 of the 64-byte signature. */
export function signMessage(key: BuyerKey, message: string): string {
  return bytesToBase64(ed.sign(utf8(message), key.seed));
}

export function verifyMessage(nearPk: string, message: string, signatureB64: string): boolean {
  try {
    const sig = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    return ed.verify(sig, utf8(message), publicKeyBytes(nearPk));
  } catch {
    return false;
  }
}

export function seedToBase64Url(key: BuyerKey): string {
  return bytesToBase64Url(key.seed);
}

export function keyFromBase64Url(b64url: string): BuyerKey {
  return keyFromSeed(base64UrlToBytes(b64url));
}

// ------------------------------------------------------------------ storage

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadKey(orderId: string): BuyerKey | null {
  const raw = storage()?.getItem(STORAGE_PREFIX + orderId);
  if (!raw) return null;
  try {
    return keyFromBase64Url(raw);
  } catch {
    return null;
  }
}

export function saveKey(orderId: string, key: BuyerKey): void {
  storage()?.setItem(STORAGE_PREFIX + orderId, seedToBase64Url(key));
}

/** Returns the stored key for an order, creating and storing one if needed. */
export function getOrCreateKey(orderId: string): BuyerKey {
  const existing = loadKey(orderId);
  if (existing) return existing;
  const key = generateKey();
  saveKey(orderId, key);
  return key;
}

/** Reads a backup fragment ("#k=<seed>") and stores the key for this order. */
export function importKeyFromHash(orderId: string, hash: string): BuyerKey | null {
  const k = new URLSearchParams(hash.replace(/^#/, "")).get("k");
  if (!k) return null;
  try {
    const key = keyFromBase64Url(k);
    saveKey(orderId, key);
    return key;
  } catch {
    return null;
  }
}
