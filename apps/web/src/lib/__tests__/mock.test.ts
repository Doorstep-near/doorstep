import * as S from "@doorstep/shared";
import { messages } from "@doorstep/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { generateKey, loadKey, signMessage } from "../buyerKey";
import { MOCK_SELLER_TOKEN, mockSettings, mockTransport, resetMock } from "../mock";
import type { HttpMethod } from "../api";

async function call(method: HttpMethod, path: string, body?: unknown, token: string | null = null) {
  return mockTransport.request({ method, path, body, token });
}
async function ok<T>(schema: { parse: (x: unknown) => T }, method: HttpMethod, path: string, body?: unknown, token: string | null = null): Promise<T> {
  const res = await call(method, path, body, token);
  if (res.status !== 200) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
  return schema.parse(res.body);
}
async function fails(method: HttpMethod, path: string, body?: unknown, token: string | null = null) {
  const res = await call(method, path, body, token);
  expect(res.status).toBeGreaterThanOrEqual(400);
  return S.ApiError.parse(res.body);
}
const seller = (method: HttpMethod, path: string, body?: unknown) => call(method, path, body, MOCK_SELLER_TOKEN);

beforeEach(() => {
  mockSettings.delayScale = 0;
  resetMock();
});

describe("mock API conforms to the shared contract", () => {
  it("meta routes", async () => {
    expect(await ok({ parse: (x) => x }, "GET", "/health")).toEqual({ ok: true });
    const config = await ok(S.AppConfig, "GET", "/config");
    expect(config.demoMode).toBe(true);
    const { tokens } = await ok(S.TokensResponse, "GET", "/tokens");
    expect(tokens.filter((t) => t.popular).length).toBeGreaterThanOrEqual(7);
    await ok(S.Stats, "GET", "/stats");
  });

  it("seeded seller data", async () => {
    expect((await fails("GET", "/seller/orders")).error.code).toBe("unauthorized");
    const list = S.SellerOrdersResponse.parse((await seller("GET", "/seller/orders")).body);
    const statuses = new Set(list.orders.map((o) => o.status));
    for (const s of S.OrderStatus.options) expect(statuses.has(s), s).toBe(true);
    S.SellerSummary.parse((await seller("GET", "/seller/summary")).body);
    for (const o of list.orders) {
      const pub = await ok(S.Order, "GET", `/orders/${o.id}`);
      expect(pub).not.toHaveProperty("buyerPhone");
      expect(pub).not.toHaveProperty("deliveryAddress");
    }
    expect((await fails("GET", "/orders/does-not-exist-123")).error.code).toBe("not_found");
  });

  it("a full order lifecycle", async () => {
    // Seller creates an order.
    const req: S.CreateOrderRequest = {
      item: "Roasted makhana 500 g",
      priceUnits: "2000000",
      buyerPhone: "+91 98765 43210",
      deliveryMethod: "borzo",
      deliveryAddress: "B-42, Sector 50, Noida",
      deliveryArea: "Noida",
      deliverBy: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    };
    expect((await fails("POST", "/seller/orders", { ...req, deliveryAddress: undefined }, MOCK_SELLER_TOKEN)).error.code).toBe("invalid_input");
    const created = S.SellerOrder.parse((await seller("POST", "/seller/orders", req)).body);
    expect(created.status).toBe("Draft");
    const id = created.id;

    // Buyer previews, registers, gets a real quote, reports the deposit.
    const asset = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
    const dry = await ok(S.QuoteResponse, "POST", `/orders/${id}/quote`, { originAsset: asset, refundTo: "0x8ba1f109551bD432803012645Ac136ddd64DBA72", dry: true });
    expect(dry.depositAddress).toBeNull();
    expect((await fails("POST", `/orders/${id}/quote`, { originAsset: asset, refundTo: "0x8ba1f109551bD432803012645Ac136ddd64DBA72", dry: false })).error.code).toBe("invalid_state");
    const key = generateKey();
    const registered = await ok(S.Order, "POST", `/orders/${id}/buyer`, { buyerPk: key.publicKey, refundAccount: "0x8ba1f109551bd432803012645ac136ddd64dba72" });
    expect(registered.status).toBe("Created");
    const real = await ok(S.QuoteResponse, "POST", `/orders/${id}/quote`, { originAsset: asset, refundTo: "0x8ba1f109551bD432803012645Ac136ddd64DBA72", dry: false });
    expect(real.depositAddress).toMatch(/^0x[0-9a-f]{40}$/);
    expect(real.order.payment?.status).toBe("PENDING_DEPOSIT");
    const deposited = await ok(S.Order, "POST", `/orders/${id}/deposit`, { txHash: "0xabc123def4567890" });
    expect(deposited.payment?.status).toBe("KNOWN_DEPOSIT_TX");

    // Demo advance funds it.
    const funded = await ok(S.Order, "POST", `/demo/orders/${id}/advance`);
    expect(funded.status).toBe("Funded");
    expect(funded.paidUnits).toBe("2000000");

    // Seller ships with Borzo.
    S.ShipQuote.parse((await seller("POST", `/seller/orders/${id}/ship/quote`, { method: "borzo" })).body);
    const shipped = S.SellerOrder.parse((await seller("POST", `/seller/orders/${id}/ship`, { method: "borzo" })).body);
    expect(shipped.delivery.courier?.riderName).toBeTruthy();

    // Buyer reveals a delivery code (signed); seller enters it.
    const chainId = shipped.chainOrderId!;
    const signedAt = Math.floor(Date.now() / 1000);
    const otp = await ok(S.OtpRevealResponse, "POST", `/orders/${id}/otp`, { signedAt, signature: signMessage(key, messages.otpReveal(chainId, shipped.escrow, signedAt)) });
    const wrong = S.ApiError.parse((await seller("POST", `/seller/orders/${id}/otp/verify`, { code: otp.code === "000000" ? "111111" : "000000" })).body);
    expect(wrong.error.details?.triesLeft).toBe(4);
    const delivered = S.SellerOrder.parse((await seller("POST", `/seller/orders/${id}/otp/verify`, { code: otp.code })).body);
    expect(delivered.status).toBe("Delivered");
    expect(delivered.proof).toBe("checker");

    // Buyer complains inside the window (signature checked for real).
    expect((await fails("POST", `/orders/${id}/complaint`, { signature: signMessage(generateKey(), messages.complaint(chainId, shipped.escrow)) })).error.code).toBe("invalid_signature");
    const disputed = await ok(S.Order, "POST", `/orders/${id}/complaint`, { signature: signMessage(key, messages.complaint(chainId, shipped.escrow)) });
    expect(disputed.status).toBe("Disputed");
    expect(disputed.txs.map((t) => t.kind)).toEqual(["create", "fund", "ship", "deliver", "complaint"]);
  });

  it("buyer confirmation with the delivery-pass signature, then payout", async () => {
    await call("GET", "/config"); // seeds demo data and stores demo buyer keys in this browser
    const id = "demo-on-way01";
    const order = await ok(S.Order, "GET", `/orders/${id}`);
    const key = loadKey(id)!;
    expect(key.publicKey).toBe(order.buyer.publicKey);
    const delivered = await ok(S.Order, "POST", `/orders/${id}/confirm`, { signature: signMessage(key, messages.delivered(order.chainOrderId!, order.escrow)) });
    expect(delivered.status).toBe("Delivered");
    expect(delivered.proof).toBe("buyer");
    const released = await ok(S.Order, "POST", `/demo/orders/${id}/advance`);
    expect(released.status).toBe("Released");
    expect((await fails("POST", `/demo/orders/${id}/advance`)).error.code).toBe("invalid_state");
  });
});
