import type { Order, OrderStatus } from "@doorstep/shared";
import { describe, expect, it } from "vitest";
import { buildTimeline, buyerCopy, ORDER_STATUSES, paymentProgress, sellerCopy, statusMeta } from "../status";

const base: Order = {
  id: "q7Xr2kP9mWz4",
  chainOrderId: "7",
  status: "Draft",
  item: "Roasted makhana 500 g",
  note: null,
  priceUnits: "2000000",
  paidUnits: "0",
  shop: { name: "Eraya Foods", account: "eraya.near" },
  escrow: "escrow.doorstep.near",
  delivery: { method: "borzo", area: "Noida", courier: null },
  buyer: { phoneMasked: "+91 98•••••210", refundAccount: "mom.near", publicKey: null },
  deliverBy: "2026-11-15T12:00:00.000Z",
  createdAt: "2026-11-12T10:00:00.000Z",
  fundedAt: null,
  shippedAt: null,
  deliveredAt: null,
  complaintEndsAt: null,
  closedAt: null,
  proof: null,
  payment: null,
  txs: [],
  demo: true,
};

const T = (h: number) => new Date(Date.UTC(2026, 10, 12, h)).toISOString();

function order(status: OrderStatus, patch: Partial<Order> = {}): Order {
  const funded = !["Draft", "Created", "Expired"].includes(status);
  return {
    ...base,
    status,
    fundedAt: funded ? T(11) : null,
    paidUnits: funded ? base.priceUnits : "0",
    shippedAt: ["Shipped", "Delivered", "Disputed", "Released"].includes(status) ? T(12) : null,
    deliveredAt: ["Delivered", "Disputed", "Released"].includes(status) ? T(13) : null,
    complaintEndsAt: ["Delivered", "Disputed", "Released"].includes(status) ? T(14) : null,
    closedAt: ["Released", "Refunded", "Expired"].includes(status) ? T(15) : null,
    ...patch,
  };
}

const states = (o: Order) => buildTimeline(o).map((s) => s.state);
const labels = (o: Order) => buildTimeline(o).map((s) => s.label);

describe("status → words and chips", () => {
  it.each(ORDER_STATUSES)("%s has buyer and seller copy and an icon+label chip", (status) => {
    const o = order(status);
    for (const audience of ["buyer", "seller"] as const) {
      const meta = statusMeta(status, audience);
      expect(meta.label.length).toBeGreaterThan(2);
      expect(meta.icon).toBeTruthy();
      expect(["waiting", "transit", "success", "danger", "neutral"]).toContain(meta.tone);
    }
    expect(buyerCopy(o).headline.length).toBeGreaterThan(3);
    expect(buyerCopy(o).sub.length).toBeGreaterThan(10);
    expect(sellerCopy(o).headline.length).toBeGreaterThan(3);
    expect(buildTimeline(o)).toHaveLength(5);
  });

  it("uses plain words for the buyer", () => {
    expect(buyerCopy(order("Funded")).headline).toBe("Your payment is held safely");
    expect(statusMeta("Funded").label).toBe("Paid · held safely");
    expect(statusMeta("Funded", "seller").label).toBe("Ready to ship");
    expect(buyerCopy(order("Refunded")).sub).toContain("mom.near");
  });
});

describe("status → timeline", () => {
  it("Draft and Created wait for payment", () => {
    expect(states(order("Draft"))).toEqual(["current", "upcoming", "upcoming", "upcoming", "upcoming"]);
    expect(states(order("Created"))).toEqual(["current", "upcoming", "upcoming", "upcoming", "upcoming"]);
  });

  it("walks the happy path", () => {
    expect(states(order("Funded"))).toEqual(["done", "current", "upcoming", "upcoming", "upcoming"]);
    expect(states(order("Shipped"))).toEqual(["done", "done", "current", "upcoming", "upcoming"]);
    expect(states(order("Delivered"))).toEqual(["done", "done", "done", "current", "upcoming"]);
    expect(states(order("Released"))).toEqual(["done", "done", "done", "done", "done"]);
    expect(labels(order("Released"))).toEqual(["Paid", "Shipped", "Delivered", "Protection window", "Paid out"]);
  });

  it("says “Handed over” for hand delivery", () => {
    expect(labels(order("Funded", { delivery: { ...base.delivery, method: "hand" } }))[1]).toBe("Handed over");
  });

  it("marks shipping as skipped when the buyer confirmed straight from Funded", () => {
    expect(states(order("Delivered", { shippedAt: null }))).toEqual(["done", "skipped", "done", "current", "upcoming"]);
  });

  it("branches for a dispute", () => {
    const o = order("Disputed");
    expect(states(o)).toEqual(["done", "done", "done", "failed", "current"]);
    expect(labels(o).slice(3)).toEqual(["Problem reported", "Under review"]);
  });

  it("branches for a refund after the deadline", () => {
    const shipped = order("Refunded", { shippedAt: T(12) });
    expect(states(shipped)).toEqual(["done", "done", "stopped", "skipped", "stopped"]);
    expect(labels(shipped)[2]).toBe("Not delivered in time");
    expect(labels(shipped)[4]).toBe("Refunded");
    const neverShipped = order("Refunded");
    expect(states(neverShipped)).toEqual(["done", "stopped", "skipped", "skipped", "stopped"]);
  });

  it("branches for a dispute resolved as a refund", () => {
    const o = order("Refunded", { shippedAt: T(12), deliveredAt: T(13), complaintEndsAt: T(14) });
    expect(states(o)).toEqual(["done", "done", "done", "failed", "stopped"]);
  });

  it("branches for an order that was never paid", () => {
    const o = order("Expired");
    expect(states(o)).toEqual(["stopped", "skipped", "skipped", "skipped", "skipped"]);
    expect(labels(o)[0]).toBe("Not paid in time");
  });
});

describe("payment progress", () => {
  it("maps 1Click statuses to the four buyer steps", () => {
    const active = (s: Parameters<typeof paymentProgress>[0], o: OrderStatus = "Created") => paymentProgress(s, o).findIndex((x) => x.state === "current");
    expect(active("PENDING_DEPOSIT")).toBe(0);
    expect(active("KNOWN_DEPOSIT_TX")).toBe(1);
    expect(active("PROCESSING")).toBe(2);
    expect(active("SUCCESS")).toBe(3);
    expect(paymentProgress("SUCCESS", "Funded").every((x) => x.state === "done")).toBe(true);
  });
});
