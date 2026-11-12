import { describe, expect, it } from "vitest";
import { ApiError, Order, QuoteResponse, USDC_NEAR_ASSET } from "@doorstep/shared";
import { BASE_USDC, ESCROW, SHOP, fixedKey, makeLive, sellerAuth } from "./helpers";

const HOUR = 3600_000;

async function setup(deliverInMs = 48 * HOUR) {
  const t = await makeLive();
  const res = await t.app.inject({
    method: "POST",
    url: "/seller/orders",
    headers: sellerAuth,
    payload: {
      item: "Roasted makhana",
      priceUnits: "2000000",
      buyerPhone: "+91 98765 43210",
      deliveryMethod: "hand",
      deliveryArea: "Noida",
      deliverBy: new Date(t.clock.t + deliverInMs).toISOString(),
    },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  const reg = await t.app.inject({ method: "POST", url: `/orders/${id}/buyer`, payload: { buyerPk: fixedKey().publicKey, refundAccount: "buyer.test.near" } });
  expect(reg.statusCode).toBe(200);
  expect(Order.parse(reg.json()).status).toBe("Created");
  return { ...t, id };
}

const quote = (t: Awaited<ReturnType<typeof setup>>, dry: boolean, originAsset = BASE_USDC) =>
  t.app.inject({ method: "POST", url: `/orders/${t.id}/quote`, payload: { originAsset, refundTo: "0x1111111111111111111111111111111111111111", dry } });

const refusal = (res: { statusCode: number; json: () => unknown }) => ApiError.parse(res.json()).error;

describe("real quote: the same safety checks as scripts/oneclick-test.mjs", () => {
  it("passes when everything is right and sends the exact 1Click request", async () => {
    const t = await setup();
    const res = await quote(t, false);
    expect(res.statusCode).toBe(200);
    const body = QuoteResponse.parse(res.json());
    expect(body.depositAddress).toBe("0xb60A43d045364febb27F3e13E13a25e6Eb10348F");
    expect(body.order.payment?.status).toBe("PENDING_DEPOSIT");
    // We asked for 30 minutes; 1Click allowed longer. We show the earlier deadline.
    expect(body.deadline).toBe(new Date(t.clock.t + 30 * 60_000).toISOString());

    const q = t.apis.requests.find((r) => r.url.endsWith("/v0/quote"))!;
    expect(q.headers["x-api-key"]).toBe("oneclick-test-key");
    expect(q.body).toEqual({
      dry: false,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: BASE_USDC,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: USDC_NEAR_ASSET,
      amount: "2000000",
      refundTo: "0x1111111111111111111111111111111111111111",
      refundType: "ORIGIN_CHAIN",
      recipient: ESCROW,
      recipientType: "DESTINATION_CHAIN",
      customRecipientMsg: "1",
      deadline: new Date(t.clock.t + 30 * 60_000).toISOString(),
      referral: "doorstep",
    });
    // Checked on chain first: get_order and USDC registration.
    expect(t.chain.viewCount.get_order).toBeGreaterThan(0);
    expect(t.chain.viewCount.storage_balance_of).toBe(1);
  });

  it("refuses when the order is not on chain", async () => {
    const t = await setup();
    t.chain.orders.clear();
    const res = await quote(t, false);
    expect(res.statusCode).toBe(409);
    expect(refusal(res).message).toMatch(/does not exist/);
    expect(t.apis.requests.some((r) => r.url.endsWith("/v0/quote"))).toBe(false);
  });

  it("refuses when the chain order is not Created (already paid)", async () => {
    const t = await setup();
    t.chain.set("1", { status: "Funded", paid: "2000000", funded_ms: String(t.clock.t) });
    const res = await quote(t, false);
    expect(res.statusCode).toBe(409);
    expect(refusal(res).code).toBe("invalid_state");
    expect(t.apis.requests.some((r) => r.url.endsWith("/v0/quote"))).toBe(false);
  });

  it("refuses when the deadline is under 40 minutes away", async () => {
    const t = await setup();
    t.chain.set("1", { deadline_ms: String(t.clock.t + 39 * 60_000) });
    const res = await quote(t, false);
    expect(res.statusCode).toBe(409);
    expect(refusal(res).message).toMatch(/40 minutes/);
  });

  it("refuses when the escrow is not registered with USDC", async () => {
    const t = await setup();
    t.chain.usdcRegistered = false;
    const res = await quote(t, false);
    expect(res.statusCode).toBe(409);
    expect(refusal(res).message).toMatch(/not registered with the USDC/);
    expect(t.apis.requests.some((r) => r.url.endsWith("/v0/quote"))).toBe(false);
  });

  it("refuses when USDC on NEAR is missing from 1Click's token list", async () => {
    const t = await setup();
    t.apis.state.tokens = [{ assetId: BASE_USDC, decimals: 6, blockchain: "base", symbol: "USDC" }];
    const res = await quote(t, false);
    expect(res.statusCode).toBe(502);
    expect(refusal(res).code).toBe("oneclick_error");
  });

  it("refuses an unknown origin token", async () => {
    const t = await setup();
    const res = await quote(t, false, "nep141:nope.near");
    expect(res.statusCode).toBe(400);
  });

  it("refuses when the on-chain order doesn't match ours (price or seller)", async () => {
    const t = await setup();
    t.chain.set("1", { price: "1000000" });
    expect((await quote(t, false)).statusCode).toBe(409);
    t.chain.set("1", { price: "2000000", seller: "evil.near" });
    expect((await quote(t, false)).statusCode).toBe(409);
    t.chain.set("1", { seller: SHOP });
    expect((await quote(t, false)).statusCode).toBe(200);
  });

  it("refuses if 1Click's signed quote does not echo our recipient and order id", async () => {
    const t = await setup();
    t.apis.state.quoteOverride = (req) => ({
      quoteRequest: { ...req, recipient: "someone-else.near" },
      quote: { amountIn: "1", amountInFormatted: "1", minAmountIn: "1", amountOut: "2000000", amountOutFormatted: "2", depositAddress: "0xabc" },
    });
    const res = await quote(t, false);
    expect(res.statusCode).toBe(502);
    const order = await t.app.inject({ method: "GET", url: `/orders/${t.id}` });
    expect(Order.parse(order.json()).payment).toBeNull();
  });

  it("refuses a second real quote once a deposit is on its way", async () => {
    const t = await setup();
    expect((await quote(t, false)).statusCode).toBe(200);
    t.apis.state.status = "PROCESSING";
    t.clock.advance(6_000);
    await t.app.inject({ method: "GET", url: `/orders/${t.id}` }); // polls 1Click
    const res = await quote(t, false);
    expect(res.statusCode).toBe(409);
    expect(refusal(res).message).toMatch(/already on its way/);
  });

  it("refuses a real quote for a Draft, but allows a dry one", async () => {
    const t = await makeLive();
    const res = await t.app.inject({
      method: "POST",
      url: "/seller/orders",
      headers: sellerAuth,
      payload: { item: "x", priceUnits: "2000000", buyerPhone: "+91 98765 43210", deliveryMethod: "hand", deliverBy: new Date(t.clock.t + 48 * HOUR).toISOString() },
    });
    const id = res.json().id;
    const body = { originAsset: BASE_USDC, refundTo: "0x1111111111111111111111111111111111111111" };
    expect((await t.app.inject({ method: "POST", url: `/orders/${id}/quote`, payload: { ...body, dry: false } })).statusCode).toBe(409);
    const dry = await t.app.inject({ method: "POST", url: `/orders/${id}/quote`, payload: { ...body, dry: true } });
    expect(dry.statusCode).toBe(200);
    const parsed = QuoteResponse.parse(dry.json());
    expect(parsed.depositAddress).toBeNull();
    expect(parsed.order.payment).toBeNull();
    const sent = t.apis.requests.find((r) => r.url.endsWith("/v0/quote"))!.body as Record<string, unknown>;
    expect(sent.dry).toBe(true);
    expect(sent.customRecipientMsg).toBeUndefined(); // no chain order yet
  });
});

describe("payment status → Funded", () => {
  it("on SUCCESS reads get_order; Funded updates the order and records the fund tx (last NEAR tx)", async () => {
    const t = await setup();
    await quote(t, false);
    t.chain.set("1", { status: "Funded", paid: "2000000", funded_ms: String(t.clock.t) });
    t.apis.state.status = "SUCCESS";
    t.apis.state.nearTxHashes = ["a1", "b2", "c3", "d4"];
    t.clock.advance(6_000);
    const order = Order.parse((await t.app.inject({ method: "GET", url: `/orders/${t.id}` })).json());
    expect(order.status).toBe("Funded");
    expect(order.paidUnits).toBe("2000000");
    expect(order.payment?.status).toBe("SUCCESS");
    expect(order.txs.find((x) => x.kind === "fund")).toMatchObject({ hash: "d4", url: "https://nearblocks.io/txns/d4" });
  });

  it("SUCCESS but not Funded: surfaces a parked (unmatched) payment", async () => {
    const t = await setup();
    await quote(t, false);
    t.chain.unmatched = [{ id: "1", from: "intents.near", amount: "1900000", msg: "1", order_id: "1", refund_to: "buyer.test.near", reason: "less than the price", at_ms: "0" }];
    t.apis.state.status = "SUCCESS";
    t.clock.advance(6_000);
    const order = Order.parse((await t.app.inject({ method: "GET", url: `/orders/${t.id}` })).json()) as Order & { payment: { issue?: string } };
    expect(order.status).toBe("Created");
    expect(order.payment.issue).toMatch(/parked \(less than the price\)/);
  });

  it("forwards the buyer's deposit tx hash to 1Click", async () => {
    const t = await setup();
    await quote(t, false);
    const res = await t.app.inject({ method: "POST", url: `/orders/${t.id}/deposit`, payload: { txHash: "0xdeadbeefdeadbeef" } });
    expect(res.statusCode).toBe(200);
    const sub = t.apis.requests.find((r) => r.url.endsWith("/v0/deposit/submit"))!;
    expect(sub.body).toEqual({ txHash: "0xdeadbeefdeadbeef", depositAddress: "0xb60A43d045364febb27F3e13E13a25e6Eb10348F" });
    expect(Order.parse(res.json()).payment?.originTxHash).toBe("0xdeadbeefdeadbeef");
  });
});
