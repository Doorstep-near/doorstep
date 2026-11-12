import * as ed from "@noble/ed25519";
import { links, messages, Signature, Ed25519PublicKey } from "@doorstep/shared";
import { describe, expect, it } from "vitest";
import { base58Decode } from "../base58";
import { base64ToBytes } from "../bytes";
import {
  generateKey,
  getOrCreateKey,
  importKeyFromHash,
  keyFromBase64Url,
  keyFromSeed,
  loadKey,
  seedToBase64Url,
  signMessage,
  verifyMessage,
} from "../buyerKey";

// RFC 8032 test vector 1.
const RFC_SEED = Uint8Array.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60".match(/../g)!.map((h) => parseInt(h, 16)));
// "ed25519:" + base58(d75a9801…511a), computed independently with scripts/lib/near.mjs (b58encode).
const RFC_NEAR_PK = "ed25519:FVen3X669xLzsi6N2V91DoiyzHzg1uAgqiT8jZ9nS96Z";

describe("buyer key", () => {
  it("derives the known NEAR public key from a fixed seed", () => {
    const key = keyFromSeed(RFC_SEED);
    expect(key.publicKey).toBe(RFC_NEAR_PK);
    expect(Ed25519PublicKey.safeParse(key.publicKey).success).toBe(true);
  });

  it("signs messages.delivered so that @noble/ed25519 verifies it", () => {
    const key = keyFromSeed(RFC_SEED);
    const msg = messages.delivered("1", "escrow.shop.near");
    const sig = signMessage(key, msg);
    expect(Signature.safeParse(sig).success).toBe(true);
    const pub = base58Decode(key.publicKey.slice("ed25519:".length));
    expect(ed.verify(base64ToBytes(sig), new TextEncoder().encode(msg), pub)).toBe(true);
    expect(ed.verify(base64ToBytes(sig), new TextEncoder().encode(messages.complaint("1", "escrow.shop.near")), pub)).toBe(false);
    expect(verifyMessage(key.publicKey, msg, sig)).toBe(true);
  });

  it("generates fresh 32-byte keys", () => {
    const a = generateKey();
    const b = generateKey();
    expect(a.seed).toHaveLength(32);
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  it("stores one key per order", () => {
    const k = getOrCreateKey("orderAAAAAAAA");
    expect(getOrCreateKey("orderAAAAAAAA").publicKey).toBe(k.publicKey);
    expect(loadKey("orderBBBBBBBB")).toBeNull();
    expect(localStorage.getItem("doorstep:key:orderAAAAAAAA")).toBe(seedToBase64Url(k));
  });

  it("round-trips through the order-pass backup link", () => {
    const key = generateKey();
    const url = links.order("https://doorstep.app", "q7Xr2kP9mWz4", seedToBase64Url(key));
    expect(url).toMatch(/^https:\/\/doorstep\.app\/o\/q7Xr2kP9mWz4#k=[A-Za-z0-9_-]{43}$/);
    const hash = new URL(url).hash;
    const imported = importKeyFromHash("q7Xr2kP9mWz4", hash);
    expect(imported?.publicKey).toBe(key.publicKey);
    expect(loadKey("q7Xr2kP9mWz4")?.publicKey).toBe(key.publicKey);
    expect(keyFromBase64Url(seedToBase64Url(key)).publicKey).toBe(key.publicKey);
  });

  it("ignores a damaged backup fragment", () => {
    expect(importKeyFromHash("q7Xr2kP9mWz4", "#k=short")).toBeNull();
    expect(importKeyFromHash("q7Xr2kP9mWz4", "#nothing")).toBeNull();
    expect(loadKey("q7Xr2kP9mWz4")).toBeNull();
  });
});

import { refundPlan, validateNearAccount, validateOriginAddress } from "../chains";

describe("refund addresses", () => {
  it("validates per chain and maps EVM payers to their lowercase eth-implicit account", () => {
    expect(validateOriginAddress("base", "0x123")).toMatch(/Base address/);
    expect(validateOriginAddress("base", "0x5E2f1a4b7c9d3e8f0a1b2c3d4e5f6a7b8c9d0e1F")).toBeNull();
    expect(refundPlan("base", "0x5E2f1a4b7c9d3e8f0a1b2c3d4e5f6a7b8c9d0e1F", "")).toEqual({
      family: "evm",
      refundTo: "0x5E2f1a4b7c9d3e8f0a1b2c3d4e5f6a7b8c9d0e1F",
      refundAccount: "0x5e2f1a4b7c9d3e8f0a1b2c3d4e5f6a7b8c9d0e1f",
    });
    expect(validateOriginAddress("near", "mom-gifts.near")).toBeNull();
    expect(validateOriginAddress("near", "bob.near")).toBeNull();
    expect(validateOriginAddress("sol", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBeNull();
    expect(validateNearAccount("Not An Account")).toBeTruthy();
    expect(refundPlan("sol", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", "Mom.near").refundAccount).toBe("mom.near");
  });
});
