import { describe, expect, it } from "vitest";
import { Order } from "@doorstep/shared";
import { ChainError } from "../src/errors";
import { Scheduler } from "../src/scheduler";
import { OrderService } from "../src/service";
import { fixedKey, makeLive, sellerAuth } from "./helpers";

const HOUR = 3600_000;
const MIN = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function orderOnChain(deliverInMs = 48 * HOUR) {
  const t = await makeLive();
  const res = await t.app.inject({
    method: "POST",
    url: "/seller/orders",
    headers: sellerAuth,
    payload: { item: "Ghee", priceUnits: "2000000", buyerPhone: "+91 98765 43210", deliveryMethod: "hand", deliverBy: new Date(t.clock.t + deliverInMs).toISOString() },
  });
  const id = res.json().id as string;
  await t.app.inject({ method: "POST", url: `/orders/${id}/buyer`, payload: { buyerPk: fixedKey().publicKey, refundAccount: "buyer.test.near" } });
  // Slow payouts make the overlap between two ticks real.
  t.chain.onCall.release = async () => {
    await sleep(20);
    if (t.chain.orders.get("1")!.status !== "Delivered") throw new ChainError("Order is not delivered");
    t.chain.set("1", { status: "Released", closed_ms: String(t.clock.t) });
  };
  t.chain.onCall.refund = async () => {
    await sleep(20);
    const o = t.chain.orders.get("1")!;
    if (o.status === "Created") t.chain.set("1", { status: "Expired", closed_ms: String(t.clock.t) });
    else if (o.status === "Funded" || o.status === "Shipped") t.chain.set("1", { status: "Refunded", closed_ms: String(t.clock.t) });
    else throw new ChainError("Order cannot be refunded");
  };
  const get = async () => Order.parse((await t.app.inject(`/orders/${id}`)).json());
  return { ...t, id, get };
}

async function deliveredLongAgo(t: Awaited<ReturnType<typeof orderOnChain>>) {
  t.chain.set("1", { status: "Delivered", paid: "2000000", funded_ms: String(t.clock.t), delivered_ms: String(t.clock.t), proof: "Buyer" });
  await t.scheduler.syncActive();
  t.clock.advance(10 * MIN + 10_000); // complaint window (600000 ms) + margin
}

describe("scheduler", () => {
  it("two ticks at once make exactly one release call", async () => {
    const t = await orderOnChain();
    await deliveredLongAgo(t);
    await Promise.all([t.scheduler.tick(), t.scheduler.tick()]);
    expect(t.chain.calls.filter((c) => c.method === "release")).toHaveLength(1);
    expect(t.chain.calls.find((c) => c.method === "release")!.gasTgas).toBe(100);
    const o = await t.get();
    expect(o.status).toBe("Released");
    expect(o.txs.map((x) => x.kind)).toContain("release");
  });

  it("two schedulers (like two processes) sharing the database also release once", async () => {
    const t = await orderOnChain();
    await deliveredLongAgo(t);
    const second = new Scheduler(new OrderService(t.deps), t.deps);
    await Promise.all([t.scheduler.releaseDue(), second.releaseDue(), t.scheduler.releaseDue()]);
    expect(t.chain.calls.filter((c) => c.method === "release")).toHaveLength(1);
  });

  it("does not release before the window ends, and re-reads the chain first", async () => {
    const t = await orderOnChain();
    t.chain.set("1", { status: "Delivered", paid: "2000000", delivered_ms: String(t.clock.t), proof: "Buyer" });
    await t.scheduler.syncActive();
    t.clock.advance(5 * MIN);
    await t.scheduler.tick();
    expect(t.chain.calls.some((c) => c.method === "release")).toBe(false);

    // DB thinks it's due, but the buyer complained on chain meanwhile: no call, DB follows the chain.
    t.clock.advance(6 * MIN);
    t.chain.set("1", { status: "Disputed" });
    await t.scheduler.releaseDue();
    expect(t.chain.calls.some((c) => c.method === "release")).toBe(false);
    expect((await t.get()).status).toBe("Disputed");
  });

  it("treats an 'already final' contract error as success", async () => {
    const t = await orderOnChain();
    await deliveredLongAgo(t);
    // Someone else released between our read and our call.
    t.chain.onCall.release = async () => {
      t.chain.set("1", { status: "Released", closed_ms: String(t.clock.t) });
      throw new ChainError("Order is not delivered");
    };
    await t.scheduler.releaseDue();
    expect((await t.get()).status).toBe("Released");
  });

  it("refunds Funded/Shipped orders past the deadline (100 Tgas), once", async () => {
    const t = await orderOnChain(3 * HOUR);
    t.chain.set("1", { status: "Shipped", paid: "2000000", funded_ms: String(t.clock.t), courier_ref: "hand", deadline_ms: String(t.clock.t + 3 * HOUR) });
    await t.scheduler.syncActive();
    t.clock.advance(2 * HOUR);
    await t.scheduler.tick();
    expect(t.chain.calls.some((c) => c.method === "refund")).toBe(false);
    t.clock.advance(HOUR + 10_000);
    await Promise.all([t.scheduler.tick(), t.scheduler.tick()]);
    const refunds = t.chain.calls.filter((c) => c.method === "refund");
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.gasTgas).toBe(100);
    const o = await t.get();
    expect(o.status).toBe("Refunded");
    expect(o.txs.map((x) => x.kind)).toContain("refund");
  });

  it("expires unpaid Created orders past the deadline via refund (the contract marks them Expired)", async () => {
    const t = await orderOnChain(3 * HOUR);
    t.chain.set("1", { deadline_ms: String(t.clock.t + 3 * HOUR) });
    t.clock.advance(3 * HOUR + 10_000);
    await t.scheduler.tick();
    expect(t.chain.calls.filter((c) => c.method === "refund")).toHaveLength(1);
    expect((await t.get()).status).toBe("Expired");
  });

  it("never refunds a Delivered order, even past the deadline", async () => {
    const t = await orderOnChain(3 * HOUR);
    t.chain.set("1", { status: "Delivered", paid: "2000000", delivered_ms: String(t.clock.t), deadline_ms: String(t.clock.t + 3 * HOUR) });
    await t.scheduler.syncActive();
    t.chain.onCall.release = async () => {
      throw new ChainError("The complaint window is still open");
    };
    t.clock.advance(3 * HOUR + 10_000);
    t.chain.set("1", { status: "Disputed" });
    await t.scheduler.tick();
    expect(t.chain.calls.some((c) => c.method === "refund")).toBe(false);
  });

  it("expires a Draft nobody opened before its deadline (no chain call)", async () => {
    const t = await makeLive();
    const res = await t.app.inject({
      method: "POST",
      url: "/seller/orders",
      headers: sellerAuth,
      payload: { item: "x", priceUnits: "2000000", buyerPhone: "+91 98765 43210", deliveryMethod: "hand", deliverBy: new Date(t.clock.t + 3 * HOUR).toISOString() },
    });
    t.clock.advance(3 * HOUR + 10_000);
    await t.scheduler.tick();
    expect(Order.parse((await t.app.inject(`/orders/${res.json().id}`)).json()).status).toBe("Expired");
    expect(t.chain.calls).toHaveLength(0);
  });

  it("polls 1Click for active payments and marks the order Funded", async () => {
    const t = await orderOnChain();
    await t.app.inject({ method: "POST", url: `/orders/${t.id}/quote`, payload: { originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", refundTo: "0x1111111111111111111111111111111111111111", dry: false } });
    t.apis.state.status = "SUCCESS";
    t.apis.state.nearTxHashes = ["x1", "x2"];
    t.chain.set("1", { status: "Funded", paid: "2000000", funded_ms: String(t.clock.t) });
    await t.scheduler.pollPayments();
    const o = t.deps.db.getOrder(t.id)!;
    expect(o.status).toBe("Funded");
    expect(t.deps.db.txs(t.id).find((x) => x.kind === "fund")!.hash).toBe("x2");
    // Final: no more polling.
    const before = t.apis.requests.length;
    await t.scheduler.pollPayments();
    expect(t.apis.requests.length).toBe(before);
  });
});
