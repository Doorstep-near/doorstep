import { describe, expect, it } from "vitest";
import {
  ApiError,
  AppConfig,
  Order,
  OtpRevealResponse,
  QuoteResponse,
  SellerOrder,
  SellerOrdersResponse,
  SellerSummary,
  TokensResponse,
  messages,
} from "@doorstep/shared";
import { buildApp } from "../src/app";
import { readConfig } from "../src/config";
import { newSigner } from "../src/ed25519";
import { createDemo, silentLogger } from "../src/setup";
import { Clock } from "./helpers";

const auth = { authorization: "Bearer demo" };
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

async function demoApp(seed = false) {
  const clock = new Clock();
  const config = readConfig({ DEMO_MODE: "true" });
  const wired = await createDemo(config, { now: clock.now, seed, log: silentLogger });
  return { app: buildApp(wired), clock, wired, config };
}

describe("demo mode end to end over HTTP", () => {
  it("create -> buyer (real ed25519 key) -> quote -> deposit -> advance ... -> Released", async () => {
    const { app, clock, config } = await demoApp();
    expect(config.sellerToken).toBe("demo");
    expect(AppConfig.parse((await app.inject("/config")).json())).toMatchObject({ demoMode: true, complaintWindowMs: 120000 });
    expect(TokensResponse.parse((await app.inject("/tokens")).json()).tokens.length).toBeGreaterThan(5);

    const created = await app.inject({
      method: "POST",
      url: "/seller/orders",
      headers: auth,
      payload: {
        item: "Kaju katli, 500 g",
        priceUnits: "2000000",
        buyerPhone: "+91 98765 43210",
        deliveryMethod: "borzo",
        deliveryAddress: "C-12, Sector 62, Noida",
        deliveryArea: "Noida",
        deliverBy: new Date(clock.t + 24 * 3600_000).toISOString(),
      },
    });
    expect(created.statusCode).toBe(201);
    const draft = SellerOrder.parse(created.json());
    expect(draft).toMatchObject({ status: "Draft", demo: true });
    const id = draft.id;

    const buyer = newSigner();
    const reg = Order.parse((await app.inject({ method: "POST", url: `/orders/${id}/buyer`, payload: { buyerPk: buyer.publicKey, refundAccount: "0x8ba1f109551bd432803012645ac136ddd64dba72" } })).json());
    expect(reg.status).toBe("Created");
    expect(reg.chainOrderId).toBe("1");

    const dry = QuoteResponse.parse((await app.inject({ method: "POST", url: `/orders/${id}/quote`, payload: { originAsset: BASE_USDC, refundTo: "0x8ba1f109551bd432803012645ac136ddd64dba72", dry: true } })).json());
    expect(dry.amountInFormatted).toBe("2.0206"); // ≈ price × 1.0103
    expect(dry.depositAddress).toBeNull();

    const real = QuoteResponse.parse((await app.inject({ method: "POST", url: `/orders/${id}/quote`, payload: { originAsset: BASE_USDC, refundTo: "0x8ba1f109551bd432803012645ac136ddd64dba72", dry: false } })).json());
    expect(real.depositAddress).toMatch(/^0x[0-9a-f]{40}$/);
    expect(real.order.payment?.status).toBe("PENDING_DEPOSIT");

    const dep = Order.parse((await app.inject({ method: "POST", url: `/orders/${id}/deposit`, payload: { txHash: "0xabc123abc123abc123" } })).json());
    expect(dep.payment?.status).toBe("KNOWN_DEPOSIT_TX");
    clock.advance(6_000);
    expect(Order.parse((await app.inject(`/orders/${id}`)).json()).payment?.status).toBe("PROCESSING");
    clock.advance(6_000);
    const funded = Order.parse((await app.inject(`/orders/${id}`)).json());
    expect(funded.status).toBe("Funded");
    expect(funded.paidUnits).toBe("2000000");
    expect(funded.payment?.status).toBe("SUCCESS");

    const advance = async () => {
      const r = await app.inject({ method: "POST", url: `/demo/orders/${id}/advance` });
      expect(r.statusCode).toBe(200);
      return Order.parse(r.json());
    };
    const shipped = await advance();
    expect(shipped.status).toBe("Shipped");
    expect(shipped.delivery.courier).toMatchObject({ provider: "borzo", stage: "booked", rawStatus: "planned" });
    expect(shipped.delivery.courier?.ref).toMatch(/^borzo:\d+$/);

    const picked = await advance();
    expect(picked.delivery.courier).toMatchObject({ stage: "picked_up", rawStatus: "parcel_picked_up" });

    const delivered = await advance();
    expect(delivered).toMatchObject({ status: "Delivered", proof: "checker" });
    expect(delivered.delivery.courier?.rawStatus).toBe("finished");
    expect(Date.parse(delivered.complaintEndsAt!) - Date.parse(delivered.deliveredAt!)).toBe(120_000);

    const released = await advance();
    expect(released.status).toBe("Released");
    expect(released.txs.map((t) => t.kind)).toEqual(["create", "fund", "ship", "deliver", "release"]);
    expect(released.txs.every((t) => t.url === "#demo")).toBe(true);

    const final = await app.inject({ method: "POST", url: `/demo/orders/${id}/advance` });
    expect(final.statusCode).toBe(409);
    ApiError.parse(final.json());

    const sum = SellerSummary.parse((await app.inject({ url: "/seller/summary", headers: auth })).json());
    expect(sum).toMatchObject({ releasedUnits: "2000000", intentsBalanceUnits: "2000000" });
  });

  it("advance alone walks a Draft all the way to Released", async () => {
    const { app, clock } = await demoApp();
    const draft = SellerOrder.parse(
      (
        await app.inject({
          method: "POST",
          url: "/seller/orders",
          headers: auth,
          payload: { item: "Ghee", priceUnits: "12000000", buyerPhone: "+91 98111 45678", deliveryMethod: "hand", deliverBy: new Date(clock.t + 48 * 3600_000).toISOString() },
        })
      ).json(),
    );
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const o = Order.parse((await app.inject({ method: "POST", url: `/demo/orders/${draft.id}/advance` })).json());
      seen.push(`${o.status}${o.delivery.courier ? `:${o.delivery.courier.stage}` : ""}`);
    }
    expect(seen).toEqual(["Created", "Funded", "Shipped:booked", "Shipped:picked_up", "Delivered:delivered", "Released:delivered"]);
    expect((await app.inject({ method: "POST", url: `/demo/orders/${draft.id}/advance` })).statusCode).toBe(409);
  });

  it("buyer confirm and complaint use real signatures; a wrong key is refused", async () => {
    const { app, clock } = await demoApp();
    const draft = SellerOrder.parse(
      (
        await app.inject({
          method: "POST",
          url: "/seller/orders",
          headers: auth,
          payload: { item: "Pickle", priceUnits: "3000000", buyerPhone: "+91 98111 45678", deliveryMethod: "hand", deliverBy: new Date(clock.t + 48 * 3600_000).toISOString() },
        })
      ).json(),
    );
    const buyer = newSigner();
    const reg = Order.parse((await app.inject({ method: "POST", url: `/orders/${draft.id}/buyer`, payload: { buyerPk: buyer.publicKey, refundAccount: "buyer.near" } })).json());
    await app.inject({ method: "POST", url: `/demo/orders/${draft.id}/advance` }); // Funded
    const chainId = reg.chainOrderId!;
    const escrow = reg.escrow;

    const wrong = await app.inject({ method: "POST", url: `/orders/${draft.id}/confirm`, payload: { signature: newSigner().sign(messages.delivered(chainId, escrow)) } });
    expect(wrong.statusCode).toBe(400);
    expect(ApiError.parse(wrong.json()).error.code).toBe("invalid_signature");

    const ok = Order.parse((await app.inject({ method: "POST", url: `/orders/${draft.id}/confirm`, payload: { signature: buyer.sign(messages.delivered(chainId, escrow)) } })).json());
    expect(ok).toMatchObject({ status: "Delivered", proof: "buyer" });
    // Idempotent: confirming again just returns the order.
    expect((await app.inject({ method: "POST", url: `/orders/${draft.id}/confirm`, payload: { signature: buyer.sign(messages.delivered(chainId, escrow)) } })).statusCode).toBe(200);

    const disputed = Order.parse((await app.inject({ method: "POST", url: `/orders/${draft.id}/complaint`, payload: { signature: buyer.sign(messages.complaint(chainId, escrow)) } })).json());
    expect(disputed.status).toBe("Disputed");
    expect((await app.inject({ method: "POST", url: `/demo/orders/${draft.id}/advance` })).statusCode).toBe(409);
  });

  it("complaints after the window are refused", async () => {
    const { app, clock } = await demoApp();
    const draft = SellerOrder.parse(
      (
        await app.inject({
          method: "POST",
          url: "/seller/orders",
          headers: auth,
          payload: { item: "Pickle", priceUnits: "3000000", buyerPhone: "+91 98111 45678", deliveryMethod: "hand", deliverBy: new Date(clock.t + 48 * 3600_000).toISOString() },
        })
      ).json(),
    );
    const buyer = newSigner();
    const reg = Order.parse((await app.inject({ method: "POST", url: `/orders/${draft.id}/buyer`, payload: { buyerPk: buyer.publicKey, refundAccount: "buyer.near" } })).json());
    await app.inject({ method: "POST", url: `/demo/orders/${draft.id}/advance` });
    await app.inject({ method: "POST", url: `/orders/${draft.id}/confirm`, payload: { signature: buyer.sign(messages.delivered(reg.chainOrderId!, reg.escrow)) } });
    clock.advance(121_000);
    const late = await app.inject({ method: "POST", url: `/orders/${draft.id}/complaint`, payload: { signature: buyer.sign(messages.complaint(reg.chainOrderId!, reg.escrow)) } });
    expect(late.statusCode).toBe(409);
  });

  it("seeds a demo shop with orders in different states, and the buyer OTP flow works", async () => {
    const { app } = await demoApp(true);
    const list = SellerOrdersResponse.parse((await app.inject({ url: "/seller/orders", headers: auth })).json());
    expect(list.orders.map((o) => o.status).sort()).toEqual(["Draft", "Funded", "Released"]);
    expect(list.orders.every((o) => o.shop.name === "Eraya Foods (demo)" && o.demo)).toBe(true);
    const sum = SellerSummary.parse((await app.inject({ url: "/seller/summary", headers: auth })).json());
    expect(sum.counts).toMatchObject({ awaitingPayment: 1, toShip: 1, completed: 1 });
    // The funded seed order's buyer key is server-side only, so a reveal attempt without it fails.
    const funded = list.orders.find((o) => o.status === "Funded")!;
    const r = await app.inject({ method: "POST", url: `/orders/${funded.id}/otp`, payload: { signedAt: Math.floor(Date.now() / 1000), signature: "A".repeat(86) + "==" } });
    expect(r.statusCode).toBe(400);
    expect(OtpRevealResponse.safeParse(r.json()).success).toBe(false);
  });
});
