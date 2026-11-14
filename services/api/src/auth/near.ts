// Seller sign-in with a NEAR wallet (NEAR Mobile, Meteor, HOT, MyNearWallet, ...).
// The wallet signs a one-time challenge with NEP-413; we check the signature, that the
// key is a full-access key of the account, and that the challenge is fresh and unused.
// https://github.com/near/NEPs/blob/master/neps/nep-0413.md
import { createHash, randomBytes } from "node:crypto";
import { NEAR_SIGN_IN_MESSAGE, evmSignInMessage, type AuthChallenge, type EvmSignInRequest, type NearSignInRequest, type SellerMe, type SellerSession } from "@doorstep/shared";
import type { Config, Merchant } from "../config";
import type { Db } from "../db";
import { verifyEd25519Bytes } from "../ed25519";
import { fail } from "../errors";
import type { AccessKeyChecker } from "../near/rpc";
import { recoverPersonalSigner } from "./evm";
import { iso, randomId } from "../util";

const NEP413_TAG = 2 ** 31 + 413;
const CHALLENGE_TTL_MS = 5 * 60_000;

function borshString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

/** sha256(borsh(tag) ++ borsh({ message, nonce, recipient, callbackUrl })): the bytes the wallet signs. */
export function nep413Hash(p: { message: string; nonce: Uint8Array; recipient: string; callbackUrl?: string }): Buffer {
  if (p.nonce.length !== 32) throw new Error("NEP-413 nonce must be 32 bytes");
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG);
  const callback = p.callbackUrl == null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), borshString(p.callbackUrl)]);
  const payload = Buffer.concat([tag, borshString(p.message), Buffer.from(p.nonce), borshString(p.recipient), callback]);
  return createHash("sha256").update(payload).digest();
}

/** Wallets return the signature as base64; accept base64url too. */
function normaliseSignature(sig: string): string {
  return Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("base64");
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface SellerAuthDeps {
  config: Config;
  db: Db;
  now: () => number;
  /** Null in demo mode: there's no network, so key ownership isn't checked. */
  accessKey: AccessKeyChecker | null;
  /** Shops from settings (.env and MERCHANTS_FILE). */
  configShops: () => Merchant[];
}

export class SellerAuth {
  constructor(private d: SellerAuthDeps) {}

  /** Every shop: those from settings first, then those that signed up. */
  shops(): Merchant[] {
    const fixed = this.d.configShops();
    const taken = new Set(fixed.map((m) => m.account));
    const signedUp = this.d.db
      .listMerchants()
      .filter((m) => !taken.has(m.account))
      .map((m): Merchant => ({ id: m.id, name: m.name, account: m.account, token: "", address: "", phone: "", beta: true }));
    return [...fixed, ...signedUp];
  }

  shopByAccount(account: string): Merchant | undefined {
    return this.shops().find((m) => m.account === account);
  }

  me(m: Merchant): SellerMe {
    return { id: m.id, name: m.name, account: m.account, beta: !!m.beta, maxPriceUnits: m.beta ? this.d.config.betaMaxPriceUnits : null };
  }

  challenge(): AuthChallenge {
    const nonce = randomBytes(32).toString("base64");
    const expiresAt = this.d.now() + CHALLENGE_TTL_MS;
    this.d.db.putNonce(nonce, expiresAt);
    return { nonce, message: NEAR_SIGN_IN_MESSAGE, recipient: this.d.config.authRecipient, expiresAt: iso(expiresAt)! };
  }

  async signIn(req: NearSignInRequest): Promise<SellerSession> {
    const now = this.d.now();
    if (!this.d.db.nonceIssued(req.nonce, now)) fail("invalid_signature", "This sign-in request expired. Please try again.");
    const nonceBytes = Buffer.from(req.nonce, "base64");
    const hash = nep413Hash({ message: NEAR_SIGN_IN_MESSAGE, nonce: nonceBytes, recipient: this.d.config.authRecipient });
    if (!verifyEd25519Bytes(req.publicKey, hash, normaliseSignature(req.signature))) fail("invalid_signature", "The wallet's signature doesn't match. Please try again.");
    // Mark the challenge used only after a valid signature, and atomically, so it can't be replayed.
    if (!this.d.db.useNonce(req.nonce, now)) fail("invalid_signature", "This sign-in request was already used. Please try again.");
    if (this.d.accessKey) {
      const kind = await this.d.accessKey(req.accountId, req.publicKey);
      if (kind !== "full") fail("invalid_signature", `That key isn't a full-access key of ${req.accountId}. Sign in from the wallet that owns the account.`);
    }

    return this.openSession(req.accountId, req.shop);
  }

  /** MetaMask & co.: personal_sign over our challenge text. The (lowercase) address is the payout account in NEAR Intents. */
  async signInEvm(req: EvmSignInRequest): Promise<SellerSession> {
    const now = this.d.now();
    if (!this.d.db.nonceIssued(req.nonce, now)) fail("invalid_signature", "This sign-in request expired. Please try again.");
    const signer = recoverPersonalSigner(evmSignInMessage(req.nonce, this.d.config.authRecipient), req.signature);
    const address = req.address.toLowerCase();
    if (!signer || signer !== address) fail("invalid_signature", "The wallet's signature doesn't match. Please try again.");
    if (!this.d.db.useNonce(req.nonce, now)) fail("invalid_signature", "This sign-in request was already used. Please try again.");
    return this.openSession(address, req.shop);
  }

  /** Finds the account's shop (or creates it on sign-up) and starts a session. */
  private openSession(account: string, signUp?: { name: string; area?: string }): SellerSession {
    const now = this.d.now();
    let shop = this.shopByAccount(account);
    let created = false;
    if (!shop) {
      const info = signUp ?? fail("not_found", `There's no shop for ${account} yet. Create one first.`);
      this.d.db.insertMerchant({ id: `w-${randomId(8).toLowerCase()}`, name: info.name, account, area: info.area || null, createdAt: now });
      shop = this.shopByAccount(account)!;
      created = true;
    }
    const token = randomBytes(32).toString("base64url");
    this.d.db.putSession({ tokenHash: hashToken(token), account: shop.account, createdAt: now, expiresAt: now + this.d.config.sessionTtlMs });
    return { token, shop: this.me(shop), created };
  }

  /** The shop for a session token, or undefined if unknown or expired. */
  sessionShop(token: string): Merchant | undefined {
    const s = this.d.db.getSession(hashToken(token));
    if (!s || s.expiresAt <= this.d.now()) return undefined;
    return this.shopByAccount(s.account);
  }

  logout(token: string) {
    this.d.db.deleteSession(hashToken(token));
  }
}
