// Demo mode: the escrow contract's state machine in memory, with the same
// checks and the same panic messages (contracts/escrow/src/lib.rs). Buyer and
// checker signatures are verified with real ed25519 over the shared messages.
import { messages } from "@doorstep/shared";
import { ChainError } from "../errors";
import { verifyEd25519 } from "../ed25519";
import { b58decode, fakeTxHash } from "../util";
import type { ChainOrder, CreateOrderArgs, Escrow, EscrowConfig, TxResult, Unmatched } from "./escrow";

const event = (name: string, data: Record<string, unknown>) =>
  `EVENT_JSON:${JSON.stringify({ standard: "doorstep", version: "1.0.0", event: name, data: [data] })}`;

export class FakeEscrow implements Escrow {
  private orders = new Map<string, ChainOrder>();
  private unmatched: Unmatched[] = [];
  private nextOrderId = 1;
  private nextUnmatchedId = 1;
  private intents = new Map<string, bigint>();
  /** Every change call, for tests. */
  readonly calls: { method: string; args: Record<string, unknown> }[] = [];

  constructor(
    readonly account: string,
    private checkerPk: string,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}

  private panic(msg: string): never {
    throw new ChainError(msg, fakeTxHash());
  }
  private ok(logs: string[] = [], value: unknown = null): TxResult {
    return { hash: fakeTxHash(), value, logs };
  }
  private order(id: string): ChainOrder {
    const o = this.orders.get(id);
    if (!o) this.panic("No such order");
    return o;
  }
  private park(from: string, amount: bigint, msg: string, orderId: string | null, refundTo: string | null, reason: string) {
    this.unmatched.push({
      id: String(this.nextUnmatchedId++),
      from,
      amount: amount.toString(),
      msg: msg.slice(0, 128),
      order_id: orderId,
      refund_to: refundTo,
      reason,
      at_ms: String(this.now()),
    });
  }

  async getOrder(orderId: string) {
    const o = this.orders.get(orderId);
    return o ? structuredClone(o) : null;
  }
  async getConfig(): Promise<EscrowConfig> {
    return {
      owner: "owner.doorstep-demo.near",
      relayer: "relayer.doorstep-demo.near",
      usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      intents: "intents.near",
      checker_pk: this.checkerPk,
      complaint_window_ms: String(this.windowMs),
      payout_mode: "Intents",
      next_order_id: String(this.nextOrderId),
      unmatched_count: this.unmatched.length,
    };
  }
  async getUnmatched() {
    return structuredClone(this.unmatched);
  }
  async usdcRegistered() {
    return true;
  }
  async intentsBalance(account: string) {
    return (this.intents.get(account) ?? 0n).toString();
  }

  async createOrder(a: CreateOrderArgs) {
    this.calls.push({ method: "create_order", args: { ...a } });
    if (!(BigInt(a.price) > 0n)) this.panic("Price must be above zero");
    if (!(Number(a.deadline_ms) > this.now())) this.panic("Deadline must be in the future");
    if (!a.buyer_pk.startsWith("ed25519:") || b58decode(a.buyer_pk.slice(8)).length !== 32) this.panic("Key must be ed25519");
    const id = String(this.nextOrderId++);
    this.orders.set(id, {
      id,
      seller: a.seller,
      buyer_pk: a.buyer_pk,
      buyer_refund: a.buyer_refund,
      price: a.price,
      paid: "0",
      deadline_ms: a.deadline_ms,
      courier_ref: null,
      status: "Created",
      proof: null,
      created_ms: String(this.now()),
      funded_ms: null,
      delivered_ms: null,
      closed_ms: null,
    });
    const logs = [event("order_created", { order_id: id, seller: a.seller, price: a.price, deadline_ms: a.deadline_ms })];
    return { ...this.ok(logs, id), orderId: id };
  }

  /** What USDC's ft_transfer_call into the escrow does (1Click delivery). Never refunds; parks instead. */
  ftOnTransfer(senderId: string, amount: string, msg: string): TxResult {
    const now = this.now();
    const id = /^\s*\d+\s*$/.test(msg) ? msg.trim() : null;
    const o = id ? this.orders.get(id) : undefined;
    const amt = BigInt(amount);
    if (!id) this.park(senderId, amt, msg, null, null, "msg is not an order id");
    else if (!o) this.park(senderId, amt, msg, id, null, "unknown order");
    else if (o.status !== "Created") this.park(senderId, amt, msg, id, o.buyer_refund, "order already paid or closed");
    else if (now > Number(o.deadline_ms)) this.park(senderId, amt, msg, id, o.buyer_refund, "order expired");
    else if (amt < BigInt(o.price)) this.park(senderId, amt, msg, id, o.buyer_refund, "less than the price");
    else {
      o.status = "Funded";
      o.paid = o.price;
      o.funded_ms = String(now);
      const extra = amt - BigInt(o.price);
      if (extra > 0n) this.park(senderId, extra, msg, id, o.buyer_refund, "paid more than the price");
      return this.ok([event("order_funded", { order_id: id, amount, sender_id: senderId })]);
    }
    return this.ok([event("payment_unmatched", { amount, order_id: id })]);
  }

  async markShipped(orderId: string, courierRef: string) {
    this.calls.push({ method: "mark_shipped", args: { order_id: orderId, courier_ref: courierRef } });
    if (!courierRef || courierRef.length > 128) this.panic("Courier reference must be 1-128 characters");
    if (courierRef.includes("|")) this.panic("Courier reference cannot contain |");
    const o = this.order(orderId);
    if (o.status !== "Funded" && o.status !== "Shipped") this.panic("Order is not paid or already delivered");
    o.status = "Shipped";
    o.courier_ref = courierRef;
    return this.ok([event("order_shipped", { order_id: orderId, courier_ref: courierRef })]);
  }

  async confirmByBuyer(orderId: string, signature: string) {
    this.calls.push({ method: "confirm_by_buyer", args: { order_id: orderId, signature } });
    const o = this.order(orderId);
    if (o.status !== "Funded" && o.status !== "Shipped") this.panic("Order is not awaiting delivery");
    if (!verifyEd25519(o.buyer_pk, messages.delivered(orderId, this.account), signature)) this.panic("Invalid buyer signature");
    o.status = "Delivered";
    o.proof = "Buyer";
    o.delivered_ms = String(this.now());
    return this.ok([event("order_delivered", { order_id: orderId, proof: "buyer" })]);
  }

  async confirmByChecker(orderId: string, courierRef: string, signedAt: number, signature: string) {
    this.calls.push({ method: "confirm_by_checker", args: { order_id: orderId, courier_ref: courierRef, signed_at: String(signedAt), signature } });
    if (courierRef.includes("|")) this.panic("Courier reference cannot contain |");
    const message = messages.checker(orderId, courierRef, signedAt, this.account);
    const o = this.order(orderId);
    if (o.status !== "Funded" && o.status !== "Shipped") this.panic("Order is not awaiting delivery");
    if (o.courier_ref != null && o.courier_ref !== courierRef) this.panic("Courier reference does not match");
    if (!verifyEd25519(this.checkerPk, message, signature)) this.panic("Invalid checker signature");
    o.status = "Delivered";
    o.proof = { Checker: { courier_ref: courierRef } };
    o.delivered_ms = String(this.now());
    return this.ok([event("order_delivered", { order_id: orderId, proof: "checker", courier_ref: courierRef })]);
  }

  async raiseComplaint(orderId: string, signature: string) {
    this.calls.push({ method: "raise_complaint", args: { order_id: orderId, signature } });
    const o = this.order(orderId);
    if (o.status !== "Delivered") this.panic("Order is not in its complaint window");
    if (!(this.now() < Number(o.delivered_ms ?? 0) + this.windowMs)) this.panic("The complaint window has closed");
    if (!verifyEd25519(o.buyer_pk, messages.complaint(orderId, this.account), signature)) this.panic("Invalid buyer signature");
    o.status = "Disputed";
    return this.ok([event("complaint_raised", { order_id: orderId })]);
  }

  async release(orderId: string) {
    this.calls.push({ method: "release", args: { order_id: orderId } });
    const o = this.order(orderId);
    if (o.status !== "Delivered") this.panic("Order is not delivered");
    if (this.now() < Number(o.delivered_ms ?? Number.MAX_SAFE_INTEGER) + this.windowMs) this.panic("The complaint window is still open");
    return this.payout(o, true);
  }

  async refund(orderId: string) {
    this.calls.push({ method: "refund", args: { order_id: orderId } });
    const o = this.order(orderId);
    if (!(this.now() > Number(o.deadline_ms))) this.panic("The deadline has not passed");
    if (o.status === "Created") {
      o.status = "Expired";
      o.closed_ms = String(this.now());
      return this.ok([event("order_expired", { order_id: orderId })], "0");
    }
    if (o.status === "Funded" || o.status === "Shipped") return this.payout(o, false);
    return this.panic("Order cannot be refunded");
  }

  private payout(o: ChainOrder, toSeller: boolean): TxResult {
    o.status = toSeller ? "Released" : "Refunded";
    o.closed_ms = String(this.now());
    const to = toSeller ? o.seller : o.buyer_refund;
    this.intents.set(to, (this.intents.get(to) ?? 0n) + BigInt(o.paid));
    return this.ok([event(toSeller ? "order_released" : "order_refunded", { order_id: o.id, to, amount: o.paid }), event("payout_done", { to, amount: o.paid })]);
  }

  // ------------------------------------------------------------- demo helpers

  /** Moves delivered_ms back so the complaint window has passed. */
  fastForwardWindow(orderId: string) {
    const o = this.order(orderId);
    if (o.delivered_ms) o.delivered_ms = String(Math.min(Number(o.delivered_ms), this.now() - this.windowMs - 1));
  }

  creditIntents(account: string, units: bigint) {
    this.intents.set(account, (this.intents.get(account) ?? 0n) + units);
  }
}
