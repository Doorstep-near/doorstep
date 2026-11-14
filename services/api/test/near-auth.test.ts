import { createHash, generateKeyPairSync, sign as edSign, type KeyObject } from "node:crypto";
import { AuthChallenge, NEAR_SIGN_IN_MESSAGE, SellerMe, SellerOrder, SellerSession, evmSignInMessage } from "@doorstep/shared";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { describe, expect, it } from "vitest";
import { personalMessageHash, recoverPersonalSigner } from "../src/auth/evm";
import { nep413Hash } from "../src/auth/near";
import { b58encode } from "../src/util";
import { SHOP, fixedKey, makeLive, sellerAuth } from "./helpers";

const HOUR = 3600_000;

/** A NEAR wallet in a test: an ed25519 key that signs NEP-413 messages. */
function wallet(accountId: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from((publicKey.export({ format: "jwk" }) as { x: string }).x, "base64url");
  const pk = "ed25519:" + b58encode(raw);
  return {
    accountId,
    publicKey: pk,
    sign(c: { nonce: string; recipient: string; message?: string }, key: KeyObject = privateKey) {
      const hash = nep413Hash({ message: c.message ?? NEAR_SIGN_IN_MESSAGE, nonce: Buffer.from(c.nonce, "base64"), recipient: c.recipient });
      return edSign(null, hash, key).toString("base64");
    },
  };
}

type T = Awaited<ReturnType<typeof makeLive>>;

async function challenge(t: T) {
  return AuthChallenge.parse((await t.app.inject("/seller/auth/challenge")).json());
}

async function signIn(t: T, w: ReturnType<typeof wallet>, shop?: { name: string; area?: string }, c?: AuthChallenge) {
  const ch = c ?? (await challenge(t));
  return t.app.inject({
    method: "POST",
    url: "/seller/auth/near",
    payload: { accountId: w.accountId, publicKey: w.publicKey, signature: w.sign(ch), nonce: ch.nonce, ...(shop ? { shop } : {}) },
  });
}

async function newOrder(t: T, auth: Record<string, string>, priceUnits: string) {
  return t.app.inject({
    method: "POST",
    url: "/seller/orders",
    headers: auth,
    payload: { item: "Saffron", priceUnits, buyerPhone: "+91 99110 22334", deliveryMethod: "hand", deliverBy: new Date(t.clock.t + 48 * HOUR).toISOString() },
  });
}

describe("NEP-413 payload", () => {
  it("is sha256(tag ++ borsh(message, nonce, recipient, no callbackUrl))", () => {
    const nonce = Buffer.alloc(32, 7);
    const u32 = (n: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(n);
      return b;
    };
    const str = (s: string) => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);
    const expected = createHash("sha256")
      .update(Buffer.concat([u32(2 ** 31 + 413), str("hi"), nonce, str("Doorstep"), Buffer.from([0])]))
      .digest();
    expect(nep413Hash({ message: "hi", nonce, recipient: "Doorstep" })).toEqual(expected);
    expect(nep413Hash({ message: "hi", nonce, recipient: "Other" })).not.toEqual(expected);
    expect(() => nep413Hash({ message: "hi", nonce: Buffer.alloc(31), recipient: "x" })).toThrow(/32 bytes/);
  });
});

describe("seller sign-up and sign-in with a NEAR wallet", () => {
  it("issues a fresh challenge with our message and recipient", async () => {
    const t = await makeLive();
    const a = await challenge(t);
    const b = await challenge(t);
    expect(a.message).toBe(NEAR_SIGN_IN_MESSAGE);
    expect(a.recipient).toBe("Doorstep");
    expect(Buffer.from(a.nonce, "base64")).toHaveLength(32);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("signs up a new shop, then signs it in again without creating another", async () => {
    const t = await makeLive();
    const w = wallet("chai-corner.near");
    t.chain.accessKeys.set(`${w.accountId}|${w.publicKey}`, "full");

    const res = await signIn(t, w, { name: "Chai Corner", area: "Jaipur" });
    expect(res.statusCode).toBe(200);
    const s = SellerSession.parse(res.json());
    expect(s.created).toBe(true);
    expect(s.shop).toMatchObject({ name: "Chai Corner", account: "chai-corner.near", beta: true, maxPriceUnits: "25000000" });

    const me = SellerMe.parse((await t.app.inject({ url: "/seller/me", headers: { authorization: `Bearer ${s.token}` } })).json());
    expect(me.id).toBe(s.shop.id);

    const again = SellerSession.parse((await signIn(t, w)).json());
    expect(again.created).toBe(false);
    expect(again.shop.id).toBe(s.shop.id);
    expect(again.token).not.toBe(s.token);
  });

  it("tells an unknown account to create a shop first", async () => {
    const t = await makeLive();
    const w = wallet("nobody.near");
    t.chain.accessKeys.set(`${w.accountId}|${w.publicKey}`, "full");
    const res = await signIn(t, w);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toMatch(/no shop for nobody.near/);
  });

  it("signs a shop from .env (like Eraya) into its existing shop, without beta limits", async () => {
    const t = await makeLive();
    const w = wallet(SHOP);
    t.chain.accessKeys.set(`${SHOP}|${w.publicKey}`, "full");
    const s = SellerSession.parse((await signIn(t, w, { name: "ignored" })).json());
    expect(s.created).toBe(false);
    expect(s.shop).toMatchObject({ id: "main", account: SHOP, beta: false, maxPriceUnits: null });
  });

  it("rejects a reused, expired, unknown or wrongly signed challenge", async () => {
    const t = await makeLive();
    const w = wallet("chai-corner.near");
    t.chain.accessKeys.set(`${w.accountId}|${w.publicKey}`, "full");

    const ch = await challenge(t);
    expect((await signIn(t, w, { name: "Chai" }, ch)).statusCode).toBe(200);
    const replay = await signIn(t, w, undefined, ch);
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error.code).toBe("invalid_signature");

    const old = await challenge(t);
    t.clock.advance(6 * 60_000);
    expect((await signIn(t, w, undefined, old)).json().error.code).toBe("invalid_signature");

    const made = { nonce: Buffer.alloc(32, 1).toString("base64"), message: NEAR_SIGN_IN_MESSAGE, recipient: "Doorstep", expiresAt: new Date().toISOString() };
    expect((await signIn(t, w, undefined, made)).json().error.code).toBe("invalid_signature");

    // Signed for another app (recipient), or by a different key.
    const ch2 = await challenge(t);
    const wrongRecipient = await t.app.inject({
      method: "POST",
      url: "/seller/auth/near",
      payload: { accountId: w.accountId, publicKey: w.publicKey, signature: w.sign({ ...ch2, recipient: "evil.app" }), nonce: ch2.nonce },
    });
    expect(wrongRecipient.json().error.code).toBe("invalid_signature");
    const other = wallet("chai-corner.near");
    const ch3 = await challenge(t);
    const wrongKey = await t.app.inject({
      method: "POST",
      url: "/seller/auth/near",
      payload: { accountId: w.accountId, publicKey: w.publicKey, signature: other.sign(ch3), nonce: ch3.nonce },
    });
    expect(wrongKey.json().error.code).toBe("invalid_signature");
  });

  it("accepts only a full-access key of that account", async () => {
    const t = await makeLive();
    const w = wallet("chai-corner.near");
    expect((await signIn(t, w, { name: "Chai" })).json().error.message).toMatch(/full-access key/);
    t.chain.accessKeys.set(`${w.accountId}|${w.publicKey}`, "function");
    expect((await signIn(t, w, { name: "Chai" })).json().error.message).toMatch(/full-access key/);
    // Someone else's account with your own key: refused.
    const thief = wallet("eraya.near");
    t.chain.accessKeys.set(`chai-corner.near|${thief.publicKey}`, "full");
    expect((await signIn(t, thief, { name: "Fake Eraya" })).statusCode).toBe(400);
  });

  it("ends a session on logout and after it expires", async () => {
    const t = await makeLive();
    const w = wallet("chai-corner.near");
    t.chain.accessKeys.set(`${w.accountId}|${w.publicKey}`, "full");
    const a = SellerSession.parse((await signIn(t, w, { name: "Chai" })).json());
    const auth = { authorization: `Bearer ${a.token}` };
    expect((await t.app.inject({ url: "/seller/me", headers: auth })).statusCode).toBe(200);
    await t.app.inject({ method: "POST", url: "/seller/auth/logout", headers: auth });
    expect((await t.app.inject({ url: "/seller/me", headers: auth })).statusCode).toBe(401);

    const b = SellerSession.parse((await signIn(t, w)).json());
    t.clock.advance(31 * 24 * HOUR);
    expect((await t.app.inject({ url: "/seller/me", headers: { authorization: `Bearer ${b.token}` } })).statusCode).toBe(401);
  });
});

describe("beta limits", () => {
  it("caps price and unpaid orders for shops that signed up, not for shops we added", async () => {
    const t = await makeLive({ config: { betaMaxOpenOrders: 2 } });
    const w = wallet("chai-corner.near");
    t.chain.accessKeys.set(`${w.accountId}|${w.publicKey}`, "full");
    const s = SellerSession.parse((await signIn(t, w, { name: "Chai Corner" })).json());
    const auth = { authorization: `Bearer ${s.token}` };

    const tooBig = await newOrder(t, auth, "30000000");
    expect(tooBig.statusCode).toBe(400);
    expect(tooBig.json().error.message).toMatch(/up to 25 USDC/);

    const ok = await newOrder(t, auth, "20000000");
    expect(ok.statusCode).toBe(201);
    expect(SellerOrder.parse(ok.json()).shop).toEqual({ name: "Chai Corner", account: "chai-corner.near" });
    expect((await newOrder(t, auth, "1000000")).statusCode).toBe(201);
    const third = await newOrder(t, auth, "1000000");
    expect(third.statusCode).toBe(429);
    expect(third.json().error.message).toMatch(/up to 2 unpaid orders/);

    // The shop from .env has no beta limits.
    expect((await newOrder(t, sellerAuth, "30000000")).statusCode).toBe(201);
  });

  it("caps new on-chain orders per hour across all shops", async () => {
    const t = await makeLive({ config: { maxChainOrdersPerHour: 1 } });
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) ids.push(SellerOrder.parse((await newOrder(t, sellerAuth, "2000000")).json()).id);
    const body = { buyerPk: fixedKey().publicKey, refundAccount: "0x8ba1f109551bd432803012645ac136ddd64dba72" };
    expect((await t.app.inject({ method: "POST", url: `/orders/${ids[0]}/buyer`, payload: body })).statusCode).toBe(200);
    const second = await t.app.inject({ method: "POST", url: `/orders/${ids[1]}/buyer`, payload: { ...body, buyerPk: fixedKey(Buffer.alloc(32, 9)).publicKey } });
    expect(second.statusCode).toBe(429);
    t.clock.advance(61 * 60_000);
    expect((await t.app.inject({ method: "POST", url: `/orders/${ids[1]}/buyer`, payload: { ...body, buyerPk: fixedKey(Buffer.alloc(32, 9)).publicKey } })).statusCode).toBe(200);
  });
});

// ------------------------------------------------------------- MetaMask & co.

/** An EVM wallet in a test: personal_sign like MetaMask (r || s || v with v = 27/28). */
function evmWallet() {
  const priv = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(priv, false);
  const address = "0x" + Buffer.from(keccak_256(pub.subarray(1)).subarray(-20)).toString("hex");
  return {
    address,
    /** Checksummed-looking (mixed case) form, as MetaMask returns it. */
    display: "0x" + address.slice(2).toUpperCase(),
    personalSign(message: string) {
      const sig = secp256k1.sign(personalMessageHash(message), priv);
      return "0x" + Buffer.from(sig.toCompactRawBytes()).toString("hex") + (27 + sig.recovery).toString(16);
    },
  };
}

async function evmSignIn(t: T, w: ReturnType<typeof evmWallet>, shop?: { name: string }, c?: AuthChallenge, sign = w.personalSign.bind(w)) {
  const ch = c ?? (await challenge(t));
  return t.app.inject({
    method: "POST",
    url: "/seller/auth/evm",
    payload: { address: w.display, signature: sign(evmSignInMessage(ch.nonce, ch.recipient)), nonce: ch.nonce, ...(shop ? { shop } : {}) },
  });
}

describe("seller sign-up and sign-in with MetaMask (personal_sign)", () => {
  it("recovers the signing address", () => {
    const w = evmWallet();
    expect(recoverPersonalSigner("hello", w.personalSign("hello"))).toBe(w.address);
    expect(recoverPersonalSigner("hello!", w.personalSign("hello"))).not.toBe(w.address);
    expect(recoverPersonalSigner("hello", "0x1234")).toBeNull();
  });

  it("signs up a shop whose payout account is the lowercase 0x address, then signs it in", async () => {
    const t = await makeLive();
    const w = evmWallet();
    const res = await evmSignIn(t, w, { name: "Spice Route" });
    expect(res.statusCode).toBe(200);
    const s = SellerSession.parse(res.json());
    expect(s.created).toBe(true);
    expect(s.shop).toMatchObject({ name: "Spice Route", account: w.address, beta: true });
    const order = SellerOrder.parse((await newOrder(t, { authorization: `Bearer ${s.token}` }, "2000000")).json());
    expect(order.shop.account).toBe(w.address);

    const again = SellerSession.parse((await evmSignIn(t, w)).json());
    expect(again.created).toBe(false);
    expect(again.shop.id).toBe(s.shop.id);
  });

  it("rejects another wallet's signature, a replay, and an unknown account without sign-up", async () => {
    const t = await makeLive();
    const w = evmWallet();
    const other = evmWallet();
    const ch = await challenge(t);
    const forged = await evmSignIn(t, w, { name: "Fake" }, ch, other.personalSign.bind(other));
    expect(forged.json().error.code).toBe("invalid_signature");

    const ch2 = await challenge(t);
    expect((await evmSignIn(t, w, { name: "Spice" }, ch2)).statusCode).toBe(200);
    expect((await evmSignIn(t, w, undefined, ch2)).json().error.code).toBe("invalid_signature");

    const stranger = await evmSignIn(t, evmWallet());
    expect(stranger.statusCode).toBe(404);
  });
});
