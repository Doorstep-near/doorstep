import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Order, SellerMe, SellerOrder, SellerOrdersResponse, SellerSummary } from "@doorstep/shared";
import { describe, expect, it } from "vitest";
import { allMerchants, loadMerchants, merchantProblems, type Merchant } from "../src/config";
import { SELLER_TOKEN, SHOP, StubChain, makeLive, sellerAuth, testConfig } from "./helpers";

const HOUR = 3600_000;
const SECOND: Merchant = { id: "spice", name: "Spice Route", account: "0x5e2f1a4b7c9d3e8f0a1b2c3d4e5f6a7b8c9d0e1f", token: "spice-route-token-123", address: "", phone: "" };
const secondAuth = { authorization: `Bearer ${SECOND.token}` };

function tmpFile(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "doorstep-merchants-"));
  const path = join(dir, "merchants.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
}

async function create(t: Awaited<ReturnType<typeof makeLive>>, headers: Record<string, string>, item: string) {
  const res = await t.app.inject({
    method: "POST",
    url: "/seller/orders",
    headers,
    payload: { item, priceUnits: "2000000", buyerPhone: "+91 99110 22334", deliveryMethod: "hand", deliverBy: new Date(t.clock.t + 48 * HOUR).toISOString() },
  });
  expect(res.statusCode).toBe(201);
  return SellerOrder.parse(res.json());
}

describe("shops file", () => {
  it("loads valid shops and fills optional fields", () => {
    const path = tmpFile([{ id: "spice", name: "Spice Route", account: SECOND.account, token: SECOND.token }]);
    expect(loadMerchants(path)).toEqual([SECOND]);
    expect(loadMerchants("")).toEqual([]);
  });

  it("rejects a bad account, a short token, a bad id and a missing file", () => {
    expect(() => loadMerchants(tmpFile([{ id: "x1", name: "X", account: "Not Valid", token: "a-long-enough-token" }]))).toThrow(/account/);
    expect(() => loadMerchants(tmpFile([{ id: "x1", name: "X", account: "x.near", token: "short" }]))).toThrow(/token/);
    expect(() => loadMerchants(tmpFile([{ id: "Bad Id", name: "X", account: "x.near", token: "a-long-enough-token" }]))).toThrow(/id/);
    expect(() => loadMerchants("/nope/merchants.json")).toThrow(/not found/);
  });

  it("puts the SHOP_* shop first and flags duplicates", () => {
    const list = allMerchants(testConfig({ merchants: [SECOND] }));
    expect(list.map((m) => m.id)).toEqual(["main", "spice"]);
    expect(list[0]).toMatchObject({ account: SHOP, token: SELLER_TOKEN });
    expect(merchantProblems(list)).toEqual([]);
    expect(merchantProblems([...list, { ...SECOND, id: "spice2" }])).toEqual(expect.arrayContaining(["two shops share a seller token (spice2)", `duplicate account: ${SECOND.account}`]));
  });

  it("refuses to start with two shops sharing a token", async () => {
    await expect(makeLive({ config: { merchants: [{ ...SECOND, token: SELLER_TOKEN }] } })).rejects.toThrow(/Shop settings: two shops share a seller token/);
  });
});

describe("two shops on one Doorstep", () => {
  it("each token signs in as its own shop", async () => {
    const t = await makeLive({ config: { merchants: [SECOND] } });
    expect(SellerMe.parse((await t.app.inject({ url: "/seller/me", headers: sellerAuth })).json())).toEqual({ id: "main", name: "Test Shop", account: SHOP });
    expect(SellerMe.parse((await t.app.inject({ url: "/seller/me", headers: secondAuth })).json())).toEqual({ id: "spice", name: "Spice Route", account: SECOND.account });
    expect((await t.app.inject({ url: "/seller/me", headers: { authorization: "Bearer nope-nope-nope-nope" } })).statusCode).toBe(401);
    expect((await t.app.inject({ url: "/seller/me" })).statusCode).toBe(401);
  });

  it("stamps the shop's name and payout account on its orders, and buyers see them", async () => {
    const t = await makeLive({ config: { merchants: [SECOND] } });
    const o = await create(t, secondAuth, "Kashmiri saffron");
    expect(o.shop).toEqual({ name: "Spice Route", account: SECOND.account });
    const pub = Order.parse((await t.app.inject(`/orders/${o.id}`)).json());
    expect(pub.shop).toEqual({ name: "Spice Route", account: SECOND.account });
  });

  it("keeps each shop's orders, summary and actions to itself", async () => {
    const t = await makeLive({ config: { merchants: [SECOND] } });
    const mine = await create(t, sellerAuth, "Mango pickle");
    const theirs = await create(t, secondAuth, "Kashmiri saffron");

    const listMain = SellerOrdersResponse.parse((await t.app.inject({ url: "/seller/orders", headers: sellerAuth })).json()).orders.map((o) => o.id);
    const listSecond = SellerOrdersResponse.parse((await t.app.inject({ url: "/seller/orders", headers: secondAuth })).json()).orders.map((o) => o.id);
    expect(listMain).toEqual([mine.id]);
    expect(listSecond).toEqual([theirs.id]);

    const sumSecond = SellerSummary.parse((await t.app.inject({ url: "/seller/summary", headers: secondAuth })).json());
    expect(sumSecond.counts.awaitingPayment).toBe(1);

    // Another shop's order looks exactly like a missing one, for reads and for every action.
    for (const [method, url, payload] of [
      ["GET", `/seller/orders/${theirs.id}`, undefined],
      ["POST", `/seller/orders/${theirs.id}/ship`, { method: "hand" }],
      ["POST", `/seller/orders/${theirs.id}/ship/quote`, {}],
      ["POST", `/seller/orders/${theirs.id}/otp/verify`, { code: "123456" }],
    ] as const) {
      const res = await t.app.inject({ method, url, headers: sellerAuth, payload });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().error.code).toBe("not_found");
    }
    expect((await t.app.inject({ url: `/seller/orders/${theirs.id}`, headers: secondAuth })).statusCode).toBe(200);
  });

  it("asks NEAR Intents for the signed-in shop's own payout balance", async () => {
    const chain = new StubChain();
    const asked: string[] = [];
    const orig = chain.viewer;
    chain.viewer = (async (contract: string, method: string, args: Record<string, unknown>) => {
      if (method === "mt_balance_of") asked.push(String(args.account_id));
      return orig(contract, method, args);
    }) as typeof chain.viewer;
    const t = await makeLive({ chain, config: { merchants: [SECOND] } });
    await t.app.inject({ url: "/seller/summary", headers: secondAuth });
    await t.app.inject({ url: "/seller/summary", headers: sellerAuth });
    expect(asked).toEqual([SECOND.account, SHOP]);
  });
});
