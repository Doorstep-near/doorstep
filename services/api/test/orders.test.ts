import { describe, expect, it } from "vitest";
import { ApiError, AppConfig, Order, SellerOrder, SellerOrdersResponse, SellerSummary, Stats, TokensResponse } from "@doorstep/shared";
import { maskPhone } from "../src/util";
import { SHOP, fixedKey, makeLive, sellerAuth } from "./helpers";

const HOUR = 3600_000;

async function createOrder(t: Awaited<ReturnType<typeof makeLive>>, extra: Record<string, unknown> = {}) {
  const res = await t.app.inject({
    method: "POST",
    url: "/seller/orders",
    headers: sellerAuth,
    payload: {
      item: "Mango pickle",
      priceUnits: "6500000",
      buyerPhone: "+91 99110 22334",
      deliveryMethod: "borzo",
      deliveryAddress: "B-42, Sector 50, Noida",
      deliveryArea: "Noida",
      deliverBy: new Date(t.clock.t + 48 * HOUR).toISOString(),
      ...extra,
    },
  });
  return res;
}

describe("meta routes", () => {
  it("health, config, stats, tokens", async () => {
    const t = await makeLive();
    expect((await t.app.inject("/health")).json()).toEqual({ ok: true });
    const cfg = AppConfig.parse((await t.app.inject("/config")).json());
    expect(cfg).toMatchObject({ demoMode: false, escrow: "escrow.test.near", network: "mainnet", webUrl: "http://localhost:5173" });
    Stats.parse((await t.app.inject("/stats")).json());
    const tokens = TokensResponse.parse((await t.app.inject("/tokens")).json()).tokens;
    expect(tokens[0]!.popular).toBe(true);
    expect(tokens.find((x) => x.symbol === "DOGE")!.popular).toBe(false);
    expect(tokens.find((x) => x.symbol === "ETH" && x.chain === "eth")!.popular).toBe(true);
    // cached for 10 minutes
    await t.app.inject("/tokens");
    expect(t.apis.requests.filter((r) => r.url.endsWith("/v0/tokens"))).toHaveLength(1);
  });

  it("errors use the shared ApiError shape", async () => {
    const t = await makeLive();
    const nf = await t.app.inject("/nope");
    expect(nf.statusCode).toBe(404);
    expect(ApiError.parse(nf.json()).error.code).toBe("not_found");
    const bad = await t.app.inject({ method: "POST", url: "/seller/orders", headers: { ...sellerAuth, "content-type": "application/json" }, payload: "{nope" });
    expect(bad.statusCode).toBe(400);
    expect(ApiError.parse(bad.json()).error.code).toBe("invalid_input");
    const missing = await t.app.inject("/orders/AAAAAAAAAAAA");
    expect(ApiError.parse(missing.json()).error.code).toBe("not_found");
  });
});

describe("seller auth", () => {
  it("rejects a missing or wrong token on every /seller route", async () => {
    const t = await makeLive();
    for (const [method, url] of [
      ["GET", "/seller/orders"],
      ["GET", "/seller/summary"],
      ["POST", "/seller/orders"],
      ["GET", "/seller/orders/AAAAAAAAAAAA"],
      ["POST", "/seller/orders/AAAAAAAAAAAA/otp/verify"],
    ] as const) {
      const none = await t.app.inject({ method, url });
      expect(none.statusCode).toBe(401);
      const wrong = await t.app.inject({ method, url, headers: { authorization: "Bearer wrong" } });
      expect(ApiError.parse(wrong.json()).error.code).toBe("unauthorized");
    }
  });
});

describe("orders", () => {
  it("creates a Draft with a pay link and lists/filters it", async () => {
    const t = await makeLive();
    const res = await createOrder(t);
    expect(res.statusCode).toBe(201);
    const o = SellerOrder.parse(res.json());
    expect(o.status).toBe("Draft");
    expect(o.id).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(o.payLink).toBe(`http://localhost:5173/pay/${o.id}`);
    expect(o.buyerPhone).toBe("+91 99110 22334");
    expect(o.shop.account).toBe(SHOP);
    const list = SellerOrdersResponse.parse((await t.app.inject({ url: "/seller/orders?status=Draft,Created", headers: sellerAuth })).json());
    expect(list.orders.map((x) => x.id)).toEqual([o.id]);
    const none = SellerOrdersResponse.parse((await t.app.inject({ url: "/seller/orders?status=Funded", headers: sellerAuth })).json());
    expect(none.orders).toEqual([]);
    expect((await t.app.inject({ url: "/seller/orders?status=Bogus", headers: sellerAuth })).statusCode).toBe(400);
  });

  it("validates the request (shared schema + deadline window)", async () => {
    const t = await makeLive();
    expect((await createOrder(t, { deliveryAddress: undefined })).statusCode).toBe(400);
    expect((await createOrder(t, { deliverBy: new Date(t.clock.t + HOUR).toISOString() })).statusCode).toBe(400);
    expect((await createOrder(t, { deliverBy: new Date(t.clock.t + 31 * 24 * HOUR).toISOString() })).statusCode).toBe(400);
    expect((await createOrder(t, { priceUnits: "99999" })).statusCode).toBe(400);
  });

  it("public view masks the phone and hides the address", async () => {
    const t = await makeLive();
    const o = SellerOrder.parse((await createOrder(t)).json());
    const res = await t.app.inject(`/orders/${o.id}`);
    const pub = Order.parse(res.json());
    expect(pub.buyer.phoneMasked).toBe("+91 99•••••334");
    expect(pub.delivery.area).toBe("Noida");
    expect(res.body).not.toContain("99110");
    expect(res.body).not.toContain("Sector 50");
    expect(res.body).not.toContain("payLink");
    expect(maskPhone("+91 98765 43210")).toBe("+91 98•••••210");
    expect(maskPhone("9876543210")).toBe("98•••••210");
  });

  it("buyer registration: Draft -> create_order on chain, idempotent for the same key, 409 for another", async () => {
    const t = await makeLive();
    const o = SellerOrder.parse((await createOrder(t)).json());
    const body = { buyerPk: fixedKey().publicKey, refundAccount: "0x8ba1f109551bd432803012645ac136ddd64dba72" };
    const [a, b] = await Promise.all([
      t.app.inject({ method: "POST", url: `/orders/${o.id}/buyer`, payload: body }),
      t.app.inject({ method: "POST", url: `/orders/${o.id}/buyer`, payload: body }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const created = Order.parse(a.json());
    expect(created.status).toBe("Created");
    expect(created.chainOrderId).toBe("1");
    expect(created.txs.map((x) => x.kind)).toEqual(["create"]);
    expect(t.chain.calls.filter((c) => c.method === "create_order")).toHaveLength(1);
    expect(t.chain.calls[0]!.args).toEqual({
      seller: SHOP,
      price: "6500000",
      deadline_ms: String(Date.parse(o.deliverBy)),
      buyer_pk: body.buyerPk,
      buyer_refund: body.refundAccount,
    });
    // Same key again: no new chain order.
    expect((await t.app.inject({ method: "POST", url: `/orders/${o.id}/buyer`, payload: body })).statusCode).toBe(200);
    expect(t.chain.calls.filter((c) => c.method === "create_order")).toHaveLength(1);
    // Different key: refused.
    const other = await t.app.inject({ method: "POST", url: `/orders/${o.id}/buyer`, payload: { ...body, buyerPk: fixedKey(Buffer.alloc(32, 9)).publicKey } });
    expect(other.statusCode).toBe(409);
    expect(ApiError.parse(other.json()).error.code).toBe("invalid_state");
  });

  it("a failed create_order frees the Draft for a retry", async () => {
    const t = await makeLive();
    const o = SellerOrder.parse((await createOrder(t)).json());
    const { ChainError } = await import("../src/errors");
    t.chain.onCall.create_order = () => {
      throw new ChainError("Relayer or owner only");
    };
    const body = { buyerPk: fixedKey().publicKey, refundAccount: "buyer.test.near" };
    const r1 = await t.app.inject({ method: "POST", url: `/orders/${o.id}/buyer`, payload: body });
    expect(r1.statusCode).toBe(502);
    expect(ApiError.parse(r1.json()).error).toMatchObject({ code: "chain_error", message: "Relayer or owner only" });
    delete t.chain.onCall.create_order;
    const r2 = await t.app.inject({ method: "POST", url: `/orders/${o.id}/buyer`, payload: { ...body, buyerPk: fixedKey(Buffer.alloc(32, 3)).publicKey } });
    expect(Order.parse(r2.json()).status).toBe("Created");
  });

  it("GET merges the chain state; summary includes the intents balance", async () => {
    const t = await makeLive();
    const o = SellerOrder.parse((await createOrder(t)).json());
    await t.app.inject({ method: "POST", url: `/orders/${o.id}/buyer`, payload: { buyerPk: fixedKey().publicKey, refundAccount: "buyer.test.near" } });
    t.chain.set("1", { status: "Funded", paid: "6500000", funded_ms: String(t.clock.t) });
    t.chain.intents = "2000000";
    t.clock.advance(6_000);
    const so = SellerOrder.parse((await t.app.inject({ url: `/seller/orders/${o.id}`, headers: sellerAuth })).json());
    expect(so.status).toBe("Funded");
    expect(so.fundedAt).toBe(new Date(t.clock.t - 6_000).toISOString());
    const sum = SellerSummary.parse((await t.app.inject({ url: "/seller/summary", headers: sellerAuth })).json());
    expect(sum).toMatchObject({ heldUnits: "6500000", intentsBalanceUnits: "2000000", counts: { toShip: 1, awaitingPayment: 0 } });
  });
});
