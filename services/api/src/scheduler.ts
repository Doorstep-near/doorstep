// Runs every minute (every few seconds in demo mode). Safe to run twice at
// once, in one process or two sharing the database: each order is claimed
// atomically in SQLite before acting, the order is re-read from chain before
// any call, and "already final" contract errors count as success.
import type { OrderRow } from "./db";
import { ChainError } from "./errors";
import type { Deps, OrderService } from "./service";
import { needsPoll } from "./service";

/** Chain clocks and ours can differ by a few seconds; don't call too early. */
const MARGIN_MS = 5_000;
const CLAIM_TTL_MS = 2 * 60_000;
const POLL_MAX_AGE_MS = 24 * 60 * 60_000;

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private svc: OrderService,
    private d: Deps,
  ) {}

  start(intervalMs: number) {
    this.timer = setInterval(() => {
      if (!this.running) this.running = this.tick().finally(() => (this.running = null));
    }, intervalMs);
    this.timer.unref();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  async tick(): Promise<void> {
    await this.step("release", () => this.releaseDue());
    await this.step("refund", () => this.refundDue());
    await this.step("sync", () => this.syncActive());
    await this.step("payments", () => this.pollPayments());
  }

  private async step(name: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      this.d.log.warn({ step: name, err: (e as Error).message }, "scheduler step failed");
    }
  }

  private claim(kind: string, row: OrderRow) {
    return this.d.db.claim(`${kind}:${row.id}`, this.d.now(), CLAIM_TTL_MS);
  }

  /** Delivered orders whose complaint window has passed -> release (pays the seller). */
  async releaseDue() {
    const now = this.d.now();
    const due = this.d.db.listOrders(["Delivered"]).filter((r) => r.chainOrderId && r.complaintEndsAt != null && r.complaintEndsAt + MARGIN_MS <= now);
    for (const r of due) {
      if (!this.claim("release", r)) continue;
      await this.guard(r, async () => {
        const c = await this.d.escrow.getOrder(r.chainOrderId!);
        const row = this.svc.applyChain(r, c);
        if (!c || c.status !== "Delivered") return;
        if (this.d.now() < Number(c.delivered_ms) + this.svc.windowMs + MARGIN_MS) return;
        await this.svc.releaseNow(row);
        this.d.log.info({ order: row.id }, "released to seller");
      });
    }
  }

  /** Past the deadline and not delivered -> refund (Created just expires). */
  async refundDue() {
    const now = this.d.now();
    for (const r of this.d.db.listOrders(["Draft"])) {
      if (r.deliverBy + MARGIN_MS <= now && !r.buyerPk) this.d.db.updateOrderIf(r.id, { status: "Draft", buyerPkNull: true }, { status: "Expired", closedAt: now });
    }
    const due = this.d.db.listOrders(["Created", "Funded", "Shipped"]).filter((r) => r.chainOrderId && r.deliverBy + MARGIN_MS <= now);
    for (const r of due) {
      if (!this.claim("refund", r)) continue;
      await this.guard(r, async () => {
        const c = await this.d.escrow.getOrder(r.chainOrderId!);
        const row = this.svc.applyChain(r, c);
        if (!c || !["Created", "Funded", "Shipped"].includes(c.status)) return;
        if (this.d.now() <= Number(c.deadline_ms) + MARGIN_MS) return;
        await this.svc.refundNow(row);
        this.d.log.info({ order: row.id, from: c.status }, c.status === "Created" ? "expired unpaid order" : "refunded buyer");
      });
    }
  }

  async syncActive() {
    for (const r of this.svc.activeOnChain()) {
      await this.guard(r, () => this.svc.syncChain(r, true).then(() => undefined));
    }
  }

  async pollPayments() {
    const now = this.d.now();
    for (const p of this.d.db.activePayments()) {
      if (now - p.quotedAt > POLL_MAX_AGE_MS && p.status === "PENDING_DEPOSIT") continue;
      const order = this.d.db.getOrder(p.orderId);
      if (!order || !needsPoll(p, order.status)) continue;
      if (this.d.db.latestPayment(p.orderId)?.id !== p.id && p.status === "PENDING_DEPOSIT") continue;
      await this.guard(order, () => this.svc.pollPayment(p));
    }
  }

  private async guard(row: OrderRow, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof ChainError ? `chain: ${e.message}` : (e as Error).message;
      this.d.log.warn({ order: row.id, err: msg }, "scheduler action failed");
    }
  }
}
