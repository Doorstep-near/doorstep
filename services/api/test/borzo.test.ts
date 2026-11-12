import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SellerOrder, ShipQuote } from "@doorstep/shared";
import { borzoStage, verifyBorzoSignature } from "../src/borzo/client";
import { fixedKey, makeLive, sellerAuth } from "./helpers";

const SECRET = "borzo-callback-secret";
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("hex");

describe("Borzo X-DV-Signature (hex HMAC-SHA256 of the raw body with the callback secret)", () => {
  const body = '{"event_datetime":"2026-11-12T18:20:54+05:30","event_type":"order_changed","order":{"order_id":1250032,"status":"completed"}}';

  it("accepts the right signature (any hex case)", () => {
    expect(verifyBorzoSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyBorzoSignature(body, sign(body).toUpperCase(), SECRET)).toBe(true);
    expect(verifyBorzoSignature(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });

  it("rejects a wrong secret, a changed body, a missing header, junk, or no configured secret", () => {
    expect(verifyBorzoSignature(body, sign(body, "other"), SECRET)).toBe(false);
    expect(verifyBorzoSignature(body.replace("completed", "active"), sign(body), SECRET)).toBe(false);
    expect(verifyBorzoSignature(body + " ", sign(body), SECRET)).toBe(false); // exact bytes, not re-serialised JSON
    expect(verifyBorzoSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyBorzoSignature(body, "zz" + sign(body).slice(2), SECRET)).toBe(false);
    expect(verifyBorzoSignature(body, sign(body).slice(0, 20), SECRET)).toBe(false);
    expect(verifyBorzoSignature(body, sign(body, ""), "")).toBe(false);
  });

  it("maps Borzo statuses to courier stages", () => {
    const o = (s: string) => ({ order_id: 1, status: "active", points: [{ address: "a", contact_person: { phone: "1" } }, { address: "b", contact_person: { phone: "2" }, delivery: { status: s } }] });
    expect(borzoStage(o("planned"))).toBe("booked");
    expect(borzoStage(o("courier_assigned"))).toBe("booked");
    expect(borzoStage(o("parcel_picked_up"))).toBe("picked_up");
    expect(borzoStage(o("finished"))).toBe("delivered");
    expect(borzoStage(o("canceled"))).toBe("canceled");
    expect(borzoStage(o("return_finished"))).toBe("failed");
  });
});

async function shippedByBorzo() {
  const t = await makeLive();
  const res = await t.app.inject({
    method: "POST",
    url: "/seller/orders",
    headers: sellerAuth,
    payload: {
      item: "Mango pickle",
      priceUnits: "2000000",
      buyerPhone: "+91 99110 22334",
      deliveryMethod: "borzo",
      deliveryAddress: "B-42, Sector 50, Noida",
      deliverBy: new Date(t.clock.t + 48 * 3600_000).toISOString(),
    },
  });
  const id = res.json().id as string;
  await t.app.inject({ method: "POST", url: `/orders/${id}/buyer`, payload: { buyerPk: fixedKey().publicKey, refundAccount: "buyer.test.near" } });
  t.chain.set("1", { status: "Funded", paid: "2000000", funded_ms: String(t.clock.t) });
  t.chain.onCall.mark_shipped = (a) => t.chain.set("1", { status: "Shipped", courier_ref: String(a.courier_ref) });
  t.chain.onCall.confirm_by_checker = (a) => {
    const o = t.chain.orders.get("1")!;
    if (o.courier_ref && o.courier_ref !== a.courier_ref) throw new Error("Courier reference does not match");
    t.chain.set("1", { status: "Delivered", delivered_ms: String(t.clock.t), proof: { Checker: { courier_ref: String(a.courier_ref) } } });
  };
  t.clock.advance(6_000);
  return { ...t, id };
}

const webhook = (t: Awaited<ReturnType<typeof shippedByBorzo>>, body: object, signature?: string) => {
  const raw = JSON.stringify(body);
  return t.app.inject({
    method: "POST",
    url: "/webhooks/borzo",
    headers: { "content-type": "application/json", "x-dv-signature": signature ?? sign(raw) },
    payload: raw,
  });
};

const borzoOrder = (deliveryStatus: string) => ({
  order_id: 1250032,
  status: deliveryStatus === "finished" ? "completed" : "active",
  payment_amount: "89.00",
  points: [
    { address: "1 Market Road, Noida", contact_person: { phone: "919810000000" } },
    { address: "B-42", contact_person: { phone: "919911022334" }, tracking_url: "https://track.example/1", delivery: { status: deliveryStatus } },
  ],
  courier: { name: "Ravi", surname: "Kumar", phone: "918880000001" },
});

describe("Borzo shipping and webhook", () => {
  it("quotes and books from SHOP_ADDRESS/SHOP_PHONE to the buyer, then mark_shipped with borzo:<id>", async () => {
    const t = await shippedByBorzo();
    const q = await t.app.inject({ method: "POST", url: `/seller/orders/${t.id}/ship/quote`, headers: sellerAuth, payload: { method: "borzo" } });
    expect(ShipQuote.parse(q.json())).toMatchObject({ provider: "borzo", priceInr: "89.00" });

    const r = await t.app.inject({ method: "POST", url: `/seller/orders/${t.id}/ship`, headers: sellerAuth, payload: { method: "borzo" } });
    expect(r.statusCode).toBe(200);
    const o = SellerOrder.parse(r.json());
    expect(o.status).toBe("Shipped");
    expect(o.delivery.courier).toMatchObject({ provider: "borzo", ref: "borzo:1250032", stage: "booked", priceInr: "89.00", trackingUrl: "https://track.example/1" });

    const create = t.apis.requests.find((x) => x.url.endsWith("/create-order"))!;
    expect(create.headers["x-dv-auth-token"]).toBe("borzo-test-token");
    expect(create.body).toMatchObject({
      matter: "Mango pickle",
      points: [
        { address: "1 Market Road, Noida", contact_person: { phone: "919810000000" } },
        { address: "B-42, Sector 50, Noida", contact_person: { phone: "919911022334" } },
      ],
    });
    expect(t.chain.calls.find((c) => c.method === "mark_shipped")!.args).toEqual({ order_id: "1", courier_ref: "borzo:1250032" });
  });

  it("a double click books Borzo once", async () => {
    const t = await shippedByBorzo();
    const req = () => t.app.inject({ method: "POST", url: `/seller/orders/${t.id}/ship`, headers: sellerAuth, payload: { method: "borzo" } });
    const [a, b] = await Promise.all([req(), req()]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(t.apis.requests.filter((x) => x.url.endsWith("/create-order"))).toHaveLength(1);
    expect(t.chain.calls.filter((c) => c.method === "mark_shipped")).toHaveLength(1);
  });

  it("refuses to ship an unpaid order", async () => {
    const t = await shippedByBorzo();
    t.chain.set("1", { status: "Created", paid: "0", funded_ms: null });
    const r = await t.app.inject({ method: "POST", url: `/seller/orders/${t.id}/ship`, headers: sellerAuth, payload: { method: "hand" } });
    expect(r.statusCode).toBe(409);
    expect(t.apis.requests.some((x) => x.url.endsWith("/create-order"))).toBe(false);
  });

  it("acts only when Borzo's API (re-fetched) says the drop point is finished", async () => {
    const t = await shippedByBorzo();
    await t.app.inject({ method: "POST", url: `/seller/orders/${t.id}/ship`, headers: sellerAuth, payload: { method: "borzo" } });

    // The callback claims "finished", but the API says the parcel was only picked up: no confirmation.
    t.apis.state.borzoOrder = borzoOrder("parcel_picked_up");
    const claim = { event_type: "delivery_changed", delivery: { order_id: 1250032, status: "finished" } };
    const r1 = await webhook(t, claim);
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ matched: true, confirmed: false });
    expect(t.chain.calls.some((c) => c.method === "confirm_by_checker")).toBe(false);
    const mid = SellerOrder.parse((await t.app.inject({ url: `/seller/orders/${t.id}`, headers: sellerAuth })).json());
    expect(mid.delivery.courier).toMatchObject({ stage: "picked_up", rawStatus: "parcel_picked_up", riderName: "Ravi Kumar" });

    t.apis.state.borzoOrder = borzoOrder("finished");
    const r2 = await webhook(t, { event_type: "order_changed", order: { order_id: 1250032, status: "completed" } });
    expect(r2.json()).toMatchObject({ matched: true, confirmed: true });
    const call = t.chain.calls.find((c) => c.method === "confirm_by_checker")!;
    expect(call.args).toMatchObject({ order_id: "1", courier_ref: "borzo:1250032" });
    const done = SellerOrder.parse((await t.app.inject({ url: `/seller/orders/${t.id}`, headers: sellerAuth })).json());
    expect(done).toMatchObject({ status: "Delivered", proof: "checker" });

    // A retried callback does nothing more.
    await webhook(t, { event_type: "order_changed", order: { order_id: 1250032 } });
    expect(t.chain.calls.filter((c) => c.method === "confirm_by_checker")).toHaveLength(1);
  });

  it("rejects a bad signature without calling Borzo or the chain", async () => {
    const t = await shippedByBorzo();
    await t.app.inject({ method: "POST", url: `/seller/orders/${t.id}/ship`, headers: sellerAuth, payload: { method: "borzo" } });
    t.apis.state.borzoOrder = borzoOrder("finished");
    const before = t.apis.requests.length;
    const r = await webhook(t, { event_type: "order_changed", order: { order_id: 1250032 } }, sign("{}"));
    expect(r.statusCode).toBe(401);
    expect(t.apis.requests.length).toBe(before);
    expect(t.chain.calls.some((c) => c.method === "confirm_by_checker")).toBe(false);
    const unsigned = await t.app.inject({ method: "POST", url: "/webhooks/borzo", headers: { "content-type": "application/json" }, payload: "{}" });
    expect(unsigned.statusCode).toBe(401);
  });

  it("verifies the raw bytes whatever the content type says", async () => {
    const t = await shippedByBorzo();
    await t.app.inject({ method: "POST", url: `/seller/orders/${t.id}/ship`, headers: sellerAuth, payload: { method: "borzo" } });
    t.apis.state.borzoOrder = borzoOrder("finished");
    const raw = '{ "event_type": "order_changed",  "order": { "order_id": 1250032 } }';
    for (const ct of ["application/json; charset=utf-8", "text/plain"]) {
      const r = await t.app.inject({ method: "POST", url: "/webhooks/borzo", headers: { "content-type": ct, "x-dv-signature": sign(raw) }, payload: raw });
      expect(r.statusCode).toBe(200);
      expect(r.json().matched).toBe(true);
    }
    expect(t.chain.calls.filter((c) => c.method === "confirm_by_checker")).toHaveLength(1);
  });

  it("acknowledges callbacks for orders we don't know", async () => {
    const t = await shippedByBorzo();
    const r = await webhook(t, { event_type: "order_changed", order: { order_id: 999 } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, matched: false });
  });
});

describe("Ship24 webhook", () => {
  it("needs the Bearer secret and confirms only on statusMilestone delivered", async () => {
    const t = await shippedByBorzo();
    await t.app.inject({ method: "POST", url: `/seller/orders/${t.id}/ship`, headers: sellerAuth, payload: { method: "tracking", carrier: "delhivery", trackingNumber: "DL1234567890" } });
    const payload = (milestone: string) => ({ trackings: [{ tracker: { trackingNumber: "DL1234567890" }, shipment: { statusMilestone: milestone } }] });
    expect((await t.app.inject({ method: "POST", url: "/webhooks/ship24", payload: payload("delivered") })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: "/webhooks/ship24", headers: { authorization: "Bearer nope" }, payload: payload("delivered") })).statusCode).toBe(401);
    const auth = { authorization: "Bearer ship24-secret" };
    expect((await t.app.inject({ method: "POST", url: "/webhooks/ship24", headers: auth, payload: payload("in_transit") })).json()).toMatchObject({ confirmed: 0 });
    expect((await t.app.inject({ method: "POST", url: "/webhooks/ship24", headers: auth, payload: payload("delivered") })).json()).toMatchObject({ confirmed: 1 });
    expect(t.chain.calls.find((c) => c.method === "confirm_by_checker")!.args.courier_ref).toBe("track:delhivery:DL1234567890");
  });
});
