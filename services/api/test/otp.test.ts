import { describe, expect, it } from "vitest";
import { ApiError, OtpRevealResponse, SellerOrder, messages } from "@doorstep/shared";
import { ESCROW, fixedKey, makeLive, sellerAuth } from "./helpers";

const HOUR = 3600_000;
const MIN = 60_000;

async function fundedOrder() {
  const t = await makeLive();
  const res = await t.app.inject({
    method: "POST",
    url: "/seller/orders",
    headers: sellerAuth,
    payload: { item: "Ghee", priceUnits: "2000000", buyerPhone: "+91 98765 43210", deliveryMethod: "hand", deliverBy: new Date(t.clock.t + 48 * HOUR).toISOString() },
  });
  const id = res.json().id as string;
  await t.app.inject({ method: "POST", url: `/orders/${id}/buyer`, payload: { buyerPk: fixedKey().publicKey, refundAccount: "buyer.test.near" } });
  t.chain.set("1", { status: "Funded", paid: "2000000", funded_ms: String(t.clock.t) });
  t.chain.onCall.confirm_by_checker = (args) => t.chain.set("1", { status: "Delivered", delivered_ms: String(t.clock.t), proof: { Checker: { courier_ref: String(args.courier_ref) } } });
  t.clock.advance(6_000);
  const buyer = fixedKey();
  const reveal = (signedAt = Math.floor(t.clock.t / 1000), key = buyer) =>
    t.app.inject({ method: "POST", url: `/orders/${id}/otp`, payload: { signedAt, signature: key.sign(messages.otpReveal("1", ESCROW, signedAt)) } });
  const verify = (code: string) => t.app.inject({ method: "POST", url: `/seller/orders/${id}/otp/verify`, headers: sellerAuth, payload: { code } });
  return { ...t, id, reveal, verify };
}

const err = (r: { json: () => unknown }) => ApiError.parse(r.json()).error;
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe("6-digit delivery code", () => {
  it("buyer-signed reveal returns a fresh code; the seller verifies it and the checker confirms on chain", async () => {
    const t = await fundedOrder();
    const r = await t.reveal();
    expect(r.statusCode).toBe(200);
    const { code, expiresAt } = OtpRevealResponse.parse(r.json());
    expect(Date.parse(expiresAt) - t.clock.t).toBe(10 * MIN);

    // Only a salted hash is stored.
    const row = t.deps.db.getOtp(t.id)!;
    expect(row.hash).not.toContain(code);
    expect(row.salt).toHaveLength(32);

    const ok = await t.verify(code);
    expect(ok.statusCode).toBe(200);
    expect(SellerOrder.parse(ok.json())).toMatchObject({ status: "Delivered", proof: "checker" });
    const call = t.chain.calls.find((c) => c.method === "confirm_by_checker")!;
    expect(call.args.courier_ref).toBe("code"); // no courier ref stored on this order
    // single use
    expect(t.deps.db.getOtp(t.id)).toBeUndefined();
  });

  it("uses the stored courier ref when the order was shipped", async () => {
    const t = await fundedOrder();
    t.chain.onCall.mark_shipped = (args) => t.chain.set("1", { status: "Shipped", courier_ref: String(args.courier_ref) });
    const ship = await t.app.inject({ method: "POST", url: `/seller/orders/${t.id}/ship`, headers: sellerAuth, payload: { method: "tracking", carrier: "India Post", trackingNumber: "EE123456789IN" } });
    expect(SellerOrder.parse(ship.json()).delivery.courier?.ref).toBe("track:india-post:EE123456789IN");
    const { code } = OtpRevealResponse.parse((await t.reveal()).json());
    expect((await t.verify(code)).statusCode).toBe(200);
    expect(t.chain.calls.find((c) => c.method === "confirm_by_checker")!.args.courier_ref).toBe("track:india-post:EE123456789IN");
  });

  it("requires the buyer's signature: another key, a stale time or the seller token can't reveal", async () => {
    const t = await fundedOrder();
    const other = await t.reveal(undefined, fixedKey(Buffer.alloc(32, 7)));
    expect(other.statusCode).toBe(400);
    expect(err(other).code).toBe("invalid_signature");

    const stale = await t.reveal(Math.floor(t.clock.t / 1000) - 6 * 60);
    expect(err(stale).code).toBe("invalid_signature");

    const seller = await t.app.inject({ method: "POST", url: `/orders/${t.id}/otp`, headers: sellerAuth, payload: { signedAt: Math.floor(t.clock.t / 1000), signature: "A".repeat(86) + "==" } });
    expect(seller.statusCode).toBe(400);
    expect((await t.app.inject({ method: "POST", url: `/seller/orders/${t.id}/otp`, headers: sellerAuth })).statusCode).toBe(404);

    // Nothing the seller can read contains the code.
    const { code } = OtpRevealResponse.parse((await t.reveal()).json());
    const views = [await t.app.inject({ url: `/seller/orders/${t.id}`, headers: sellerAuth }), await t.app.inject({ url: "/seller/orders", headers: sellerAuth }), await t.app.inject(`/orders/${t.id}`)];
    for (const v of views) expect(v.body).not.toContain(code);
  });

  it("is refused before payment", async () => {
    const t = await fundedOrder();
    t.chain.set("1", { status: "Created", paid: "0", funded_ms: null });
    t.clock.advance(6_000);
    expect((await t.reveal()).statusCode).toBe(409);
  });

  it("expires after 10 minutes", async () => {
    const t = await fundedOrder();
    const { code } = OtpRevealResponse.parse((await t.reveal()).json());
    t.clock.advance(10 * MIN + 1);
    const r = await t.verify(code);
    expect(r.statusCode).toBe(409);
    expect(err(r).message).toMatch(/expired/);
    expect(t.chain.calls.some((c) => c.method === "confirm_by_checker")).toBe(false);
  });

  it("allows 5 wrong tries, then refuses even the right code", async () => {
    const t = await fundedOrder();
    const { code } = OtpRevealResponse.parse((await t.reveal()).json());
    for (let i = 1; i <= 5; i++) {
      const r = await t.verify(wrongCode(code));
      expect(r.statusCode).toBe(400);
      expect(err(r)).toMatchObject({ code: "invalid_input", details: { triesLeft: 5 - i } });
    }
    const locked = await t.verify(code);
    expect(locked.statusCode).toBe(429);
    expect(err(locked).code).toBe("rate_limited");
    expect(t.chain.calls.some((c) => c.method === "confirm_by_checker")).toBe(false);
    // A fresh reveal resets it.
    const fresh = OtpRevealResponse.parse((await t.reveal()).json());
    expect((await t.verify(fresh.code)).statusCode).toBe(200);
  });

  it("parallel wrong guesses can't exceed the limit", async () => {
    const t = await fundedOrder();
    const { code } = OtpRevealResponse.parse((await t.reveal()).json());
    const results = await Promise.all(Array.from({ length: 8 }, () => t.verify(wrongCode(code))));
    expect(results.filter((r) => r.statusCode === 400)).toHaveLength(5);
    expect(results.filter((r) => r.statusCode === 429)).toHaveLength(3);
  });

  it("each reveal replaces the previous code; at most 5 reveals per 10 minutes", async () => {
    const t = await fundedOrder();
    const first = OtpRevealResponse.parse((await t.reveal()).json()).code;
    const second = OtpRevealResponse.parse((await t.reveal()).json()).code;
    if (first !== second) expect((await t.verify(first)).statusCode).toBe(400);
    for (let i = 0; i < 3; i++) expect((await t.reveal()).statusCode).toBe(200);
    const sixth = await t.reveal();
    expect(sixth.statusCode).toBe(429);
    t.clock.advance(10 * MIN + 1);
    expect((await t.reveal()).statusCode).toBe(200);
  });
});
