// Business logic shared by live and demo mode. Chain, 1Click and Borzo are
// injected, so demo mode and tests swap them for fakes.
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import {
  INTENTS_APP_URL,
  PaymentStatus as PaymentStatusSchema,
  USDC_NEAR_ASSET,
  links,
  messages,
  type CreateOrderRequest,
  type DepositSubmitRequest,
  type Order,
  type OrderStatus,
  type OtpRevealRequest,
  type OtpRevealResponse,
  type Payment,
  type QuoteRequest,
  type QuoteResponse,
  type RegisterBuyerRequest,
  type SellerOrder,
  type SellerSummary,
  type ShipQuote,
  type ShipRequest,
  type Stats,
  type Token,
  type TxKind,
} from "@doorstep/shared";
import { borzoStage, deliveryStatus, dropPoint, type Borzo, type BorzoOrder, type BorzoOrderRequest } from "./borzo/client";
import { CHECKER_REF_RE, type Checker } from "./checker";
import { allMerchants, type Config, type Merchant } from "./config";
import type { Db, OrderRow, PaymentRow } from "./db";
import { verifyEd25519 } from "./ed25519";
import { ChainError, fail } from "./errors";
import type { ChainOrder, Escrow, TxResult } from "./near/escrow";
import type { OneClick, OneClickQuoteRequest, OneClickToken } from "./oneclick/client";
import { iso, maskPhone, randomId } from "./util";

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Optional Ship24 tracker registration (so /webhooks/ship24 gets updates for a tracking number). */
export interface Trackers {
  register(trackingNumber: string, orderRef: string): Promise<void>;
}

export interface Deps {
  trackers?: Trackers;
  config: Config;
  db: Db;
  escrow: Escrow;
  oneclick: OneClick;
  borzo: Borzo;
  checker: Checker;
  now: () => number;
  log: Logger;
}

export const MIN = 60_000;
const REFRESH_MS = 5_000;
const TOKENS_TTL_MS = 10 * MIN;
const QUOTE_MIN_DEADLINE_MS = 40 * MIN;
const OTP_TTL_MS = 10 * MIN;
const OTP_MAX_TRIES = 5;
const OTP_MAX_REVEALS = 5;
const OTP_CLOCK_SKEW_S = 5 * 60;

const AWAITING_DELIVERY: OrderStatus[] = ["Funded", "Shipped"];
const ON_CHAIN_ACTIVE: OrderStatus[] = ["Created", "Funded", "Shipped", "Delivered", "Disputed"];
const POPULAR_STABLE_CHAINS = new Set(["eth", "base", "arb", "sol", "tron", "bsc", "pol"]);

export function isPopular(t: { symbol: string; blockchain: string }): boolean {
  const s = t.symbol.toUpperCase();
  const c = t.blockchain.toLowerCase();
  if ((s === "USDC" || s === "USDT") && POPULAR_STABLE_CHAINS.has(c)) return true;
  if (s === "ETH" && ["eth", "base", "arb"].includes(c)) return true;
  if (s === "SOL" && c === "sol") return true;
  if (s === "BTC" && c === "btc") return true;
  if ((s === "NEAR" || s === "WNEAR") && c === "near") return true;
  return false;
}

/** Poll until 1Click is final, and keep watching a SUCCESS that hasn't funded the order yet. */
export function needsPoll(p: PaymentRow, orderStatus: OrderStatus): boolean {
  if (!["Created", "Funded"].includes(orderStatus)) return false;
  if (p.status === "REFUNDED" || p.status === "FAILED") return false;
  return p.status !== "SUCCESS" || orderStatus === "Created";
}

const httpUrl = (u: string | null | undefined) => (u && /^https?:\/\/\S+$/.test(u) ? u : null);

const hashCode = (code: string, salt: string) => scryptSync(code, salt, 32).toString("hex");
const num = (v: string | null | undefined) => (v == null ? null : Number(v));

export class OrderService {
  windowMs: number;
  private tokenCache: { at: number; raw: OneClickToken[] } | null = null;
  private registering = new Map<string, Promise<void>>();

  constructor(private d: Deps) {
    this.windowMs = d.config.complaintWindowMs;
  }

  private get now() {
    return this.d.now();
  }
  private get escrow() {
    return this.d.escrow;
  }

  // ================================================================== views

  txUrl(hash: string) {
    return this.d.config.demoMode ? "#demo" : links.explorerTx(hash, this.d.config.explorerTxUrl);
  }

  private paymentView(p: PaymentRow | undefined): Payment | null {
    if (!p) return null;
    const view: Payment & { issue?: string | null } = {
      status: p.status,
      originAsset: p.originAsset,
      originSymbol: p.originSymbol,
      originChain: p.originChain,
      amountIn: p.amountIn,
      amountInFormatted: p.amountInFormatted,
      depositAddress: p.depositAddress,
      depositMemo: p.depositMemo,
      deadline: iso(p.deadline)!,
      refundTo: p.refundTo,
      quotedAt: iso(p.quotedAt)!,
      originTxHash: p.originTxHash,
      nearTxHashes: JSON.parse(p.nearTxHashes) as string[],
      issue: p.issue,
    };
    return view;
  }

  view(row: OrderRow): Order {
    const courier =
      row.courierProvider && row.courierStage
        ? {
            provider: row.courierProvider,
            ref: row.courierRef,
            stage: row.courierStage,
            rawStatus: row.courierRaw,
            trackingUrl: row.courierTrackingUrl,
            riderName: row.riderName,
            riderPhone: row.riderPhone,
            priceInr: row.courierPriceInr,
            updatedAt: iso(row.courierUpdatedAt ?? row.createdAt)!,
          }
        : null;
    return {
      id: row.id,
      chainOrderId: row.chainOrderId,
      status: row.status,
      item: row.item,
      note: row.note,
      priceUnits: row.priceUnits,
      paidUnits: row.paidUnits,
      shop: { name: row.shopName, account: row.shopAccount },
      escrow: row.escrow,
      delivery: { method: row.deliveryMethod, area: row.deliveryArea, courier },
      buyer: { phoneMasked: maskPhone(row.buyerPhone), refundAccount: row.buyerRefund, publicKey: row.buyerPk },
      deliverBy: iso(row.deliverBy)!,
      createdAt: iso(row.createdAt)!,
      fundedAt: iso(row.fundedAt),
      shippedAt: iso(row.shippedAt),
      deliveredAt: iso(row.deliveredAt),
      complaintEndsAt: iso(row.complaintEndsAt),
      closedAt: iso(row.closedAt),
      proof: row.proof,
      payment: this.paymentView(this.d.db.latestPayment(row.id)),
      txs: this.d.db.txs(row.id).map((t) => ({ kind: t.kind, hash: t.hash, at: iso(t.at)!, url: t.url })),
      demo: row.demo === 1,
    };
  }

  sellerView(row: OrderRow): SellerOrder {
    return {
      ...this.view(row),
      buyerPhone: row.buyerPhone,
      deliveryAddress: row.deliveryAddress,
      payLink: links.pay(this.d.config.webUrl, row.id),
    };
  }

  // ================================================================ helpers

  must(id: string): OrderRow {
    return this.d.db.getOrder(id) ?? fail("not_found", "No such order");
  }

  /** The shop from the SHOP_* settings: the default for internal callers such as demo seeding. */
  get mainMerchant(): Merchant {
    const c = this.d.config;
    return allMerchants(c)[0] ?? { id: "main", name: c.shopName, account: c.shopAccount, token: "", address: c.shopAddress, phone: c.shopPhone };
  }

  merchantByAccount(account: string): Merchant | undefined {
    return allMerchants(this.d.config).find((m) => m.account === account);
  }

  /** Like must(), but another shop's order looks exactly like a missing one. */
  mustOwn(id: string, m: Merchant): OrderRow {
    const row = this.must(id);
    if (row.shopAccount !== m.account) fail("not_found", "No such order");
    return row;
  }

  private reload(id: string): OrderRow {
    return this.must(id);
  }

  recordTx(orderId: string, kind: TxKind, hash: string) {
    if (!hash) return;
    this.d.db.addTx({ orderId, kind, hash, at: this.now, url: this.txUrl(hash) });
  }

  /** Copies the contract's view of an order into our row. The chain is the source of truth. */
  applyChain(row: OrderRow, c: ChainOrder | null): OrderRow {
    if (!c) return row;
    const deliveredAt = num(c.delivered_ms);
    const patch: Partial<OrderRow> = {
      status: c.status,
      paidUnits: c.paid,
      fundedAt: num(c.funded_ms),
      deliveredAt,
      complaintEndsAt: deliveredAt == null ? null : deliveredAt + this.windowMs,
      closedAt: num(c.closed_ms),
      proof: c.proof === "Buyer" ? "buyer" : c.proof ? "checker" : null,
      chainSyncedAt: Math.max(this.now, row.chainSyncedAt ?? 0),
    };
    if (c.courier_ref && c.courier_ref !== row.courierRef) patch.courierRef = c.courier_ref;
    if (c.status === "Shipped" && !row.shippedAt) patch.shippedAt = this.now;
    if ((c.status === "Delivered" || c.status === "Released") && row.courierStage && !["delivered", "canceled", "failed"].includes(row.courierStage)) {
      patch.courierStage = "delivered";
      patch.courierUpdatedAt = this.now;
    }
    this.d.db.updateOrder(row.id, patch);
    return this.reload(row.id);
  }

  async syncChain(row: OrderRow, force = false): Promise<OrderRow> {
    if (!row.chainOrderId) return row;
    if (!force && row.chainSyncedAt != null && this.now - row.chainSyncedAt < REFRESH_MS) return row;
    return this.applyChain(row, await this.escrow.getOrder(row.chainOrderId));
  }

  /** GET-time refresh: chain state and 1Click status, each at most every 5 s. Never throws. */
  async refresh(row: OrderRow): Promise<OrderRow> {
    try {
      row = await this.syncChain(row);
    } catch (e) {
      this.d.log.warn({ order: row.id, err: (e as Error).message }, "chain sync failed");
    }
    const p = this.d.db.latestPayment(row.id);
    if (p && needsPoll(p, row.status) && (p.polledAt == null || this.now - p.polledAt >= REFRESH_MS)) {
      try {
        await this.pollPayment(p);
      } catch (e) {
        this.d.log.warn({ order: row.id, err: (e as Error).message }, "1Click poll failed");
      }
    }
    return this.reload(row.id);
  }

  /**
   * Runs one relayer transaction. On success it records the tx and applies the
   * expected state at once (RPC views can lag a block or two). On a contract
   * error it re-reads the order: if it already reached a `done` status (e.g. a
   * concurrent request won), that counts as success.
   */
  private async chainStep(row: OrderRow, kind: TxKind, run: () => Promise<TxResult>, expected: Partial<OrderRow>, done: OrderStatus[]): Promise<OrderRow> {
    try {
      const r = await run();
      this.recordTx(row.id, kind, r.hash);
      this.d.db.updateOrder(row.id, { ...expected, chainSyncedAt: this.now + REFRESH_MS });
      return this.reload(row.id);
    } catch (e) {
      if (!(e instanceof ChainError)) throw e;
      const fresh = await this.syncChain(this.reload(row.id), true).catch(() => row);
      if (done.includes(fresh.status)) return fresh;
      throw e;
    }
  }

  // ================================================================= seller

  createOrder(req: CreateOrderRequest, m: Merchant = this.mainMerchant): SellerOrder {
    const deliverBy = Date.parse(req.deliverBy);
    const now = this.now;
    if (deliverBy < now + 2 * 60 * MIN - MIN) fail("invalid_input", "deliverBy must be at least 2 hours from now");
    if (deliverBy > now + 30 * 24 * 60 * MIN) fail("invalid_input", "deliverBy must be at most 30 days from now");
    const row: OrderRow = {
      id: randomId(12),
      chainOrderId: null,
      status: "Draft",
      item: req.item,
      note: req.note || null,
      priceUnits: BigInt(req.priceUnits).toString(),
      paidUnits: "0",
      shopName: m.name,
      shopAccount: m.account,
      escrow: this.escrow.account,
      deliveryMethod: req.deliveryMethod,
      deliveryArea: req.deliveryArea || null,
      deliveryAddress: req.deliveryAddress || null,
      buyerPhone: req.buyerPhone,
      buyerPk: null,
      buyerRefund: null,
      deliverBy,
      createdAt: now,
      fundedAt: null,
      shippedAt: null,
      deliveredAt: null,
      complaintEndsAt: null,
      closedAt: null,
      proof: null,
      courierProvider: null,
      courierRef: null,
      courierStage: null,
      courierRaw: null,
      courierTrackingUrl: null,
      riderName: null,
      riderPhone: null,
      courierPriceInr: null,
      courierUpdatedAt: null,
      borzoOrderId: null,
      chainSyncedAt: null,
      demo: this.d.config.demoMode ? 1 : 0,
    };
    this.d.db.insertOrder(row);
    return this.sellerView(row);
  }

  async getForSeller(id: string, m?: Merchant): Promise<SellerOrder> {
    return this.sellerView(await this.refresh(m ? this.mustOwn(id, m) : this.must(id)));
  }

  async list(statuses?: OrderStatus[], m?: Merchant): Promise<SellerOrder[]> {
    const mine = (r: OrderRow) => !m || r.shopAccount === m.account;
    // Refresh a bounded number of stale active orders, so the dashboard doesn't wait for the scheduler.
    const stale = this.activeOnChain()
      .filter(mine)
      .filter((r) => r.chainSyncedAt == null || this.now - r.chainSyncedAt > 15_000)
      .slice(0, 20);
    await Promise.all(stale.map((r) => this.syncChain(r, true).catch(() => r)));
    return this.d.db
      .listOrders(statuses)
      .filter(mine)
      .map((r) => this.sellerView(r));
  }

  async summary(m: Merchant = this.mainMerchant): Promise<SellerSummary> {
    const rows = this.d.db.listOrders().filter((r) => r.shopAccount === m.account);
    const sum = (ss: OrderStatus[]) => rows.filter((r) => ss.includes(r.status)).reduce((a, r) => a + BigInt(r.paidUnits), 0n).toString();
    const count = (ss: OrderStatus[]) => rows.filter((r) => ss.includes(r.status)).length;
    let intentsBalanceUnits = "0";
    try {
      intentsBalanceUnits = await this.escrow.intentsBalance(m.account);
    } catch (e) {
      this.d.log.warn({ err: (e as Error).message }, "intents balance read failed");
    }
    return {
      heldUnits: sum(["Funded", "Shipped", "Delivered", "Disputed"]),
      releasedUnits: sum(["Released"]),
      intentsBalanceUnits,
      counts: {
        awaitingPayment: count(["Draft", "Created"]),
        toShip: count(["Funded"]),
        inTransit: count(["Shipped"]),
        inWindow: count(["Delivered"]),
        disputed: count(["Disputed"]),
        completed: count(["Released", "Refunded", "Expired"]),
      },
      intentsAppUrl: INTENTS_APP_URL,
    };
  }

  stats(): Stats {
    const rows = this.d.db.listOrders();
    return {
      orders: rows.filter((r) => r.status !== "Draft").length,
      protectedUnits: rows.reduce((a, r) => a + BigInt(r.paidUnits), 0n).toString(),
      releasedUnits: rows.filter((r) => r.status === "Released").reduce((a, r) => a + BigInt(r.paidUnits), 0n).toString(),
    };
  }

  // ------------------------------------------------------------- shipping

  private borzoRequest(row: OrderRow): BorzoOrderRequest {
    const shop = this.merchantByAccount(row.shopAccount) ?? this.mainMerchant;
    const { address: shopAddress, phone: shopPhone, name: shopName } = shop;
    if (!shopAddress || !shopPhone) fail("courier_error", "Set this shop's pickup address and phone to book Borzo");
    if (!row.deliveryAddress || !row.buyerPhone) fail("invalid_input", "Borzo delivery needs the buyer's address and phone");
    return {
      matter: row.item.slice(0, 5000),
      vehicle_type_id: 8,
      points: [
        { address: shopAddress, contact_person: { phone: shopPhone.replace(/\D/g, ""), name: shopName } },
        { address: row.deliveryAddress!, contact_person: { phone: row.buyerPhone!.replace(/\D/g, "") }, note: row.note },
      ],
    };
  }

  async shipQuote(id: string): Promise<ShipQuote> {
    const row = await this.syncChain(this.must(id));
    if (!AWAITING_DELIVERY.includes(row.status)) fail("invalid_state", `Order is ${row.status}; a courier quote needs a paid order`);
    const o = await this.d.borzo.calculate(this.borzoRequest(row));
    const arrival = dropPoint(o) as { arrival_finish_datetime?: string | null } | undefined;
    const eta = arrival?.arrival_finish_datetime ? Math.round((Date.parse(arrival.arrival_finish_datetime) - this.now) / MIN) : null;
    return { provider: "borzo", priceInr: String(o.payment_amount ?? "0"), etaMinutes: eta != null && eta > 0 ? eta : null };
  }

  private courierPatch(o: BorzoOrder): Partial<OrderRow> {
    const c = o.courier;
    return {
      courierStage: borzoStage(o),
      courierRaw: deliveryStatus(o) ?? o.status,
      courierTrackingUrl: httpUrl(dropPoint(o)?.tracking_url),
      riderName: c ? [c.name, c.surname].filter(Boolean).join(" ") || null : null,
      riderPhone: c?.phone ?? null,
      courierPriceInr: o.payment_amount ?? null,
      courierUpdatedAt: this.now,
    };
  }

  /** Runs `fn` while holding a short SQLite lease on `key`, so double clicks and duplicate webhooks act once. */
  private async exclusive<T>(key: string, busy: () => T | Promise<T>, fn: () => Promise<T>): Promise<T> {
    if (!this.d.db.claim(key, this.now, 2 * MIN)) return busy();
    try {
      return await fn();
    } finally {
      this.d.db.unclaim(key);
    }
  }

  async ship(id: string, req: ShipRequest): Promise<SellerOrder> {
    this.must(id);
    return this.exclusive(`ship:${id}`, () => fail("invalid_state", "Shipping is already in progress"), () => this.shipLocked(id, req));
  }

  private async shipLocked(id: string, req: ShipRequest): Promise<SellerOrder> {
    let row = await this.syncChain(this.must(id), true);
    if (row.status !== "Funded") fail("invalid_state", row.status === "Shipped" ? "Order is already shipped" : `Order is ${row.status}; only paid orders can be shipped`);
    let ref: string;
    if (req.method === "borzo") {
      if (!row.borzoOrderId) {
        // Booked once only: if mark_shipped fails afterwards, a retry reuses this booking.
        const o = await this.d.borzo.create(this.borzoRequest(row));
        this.d.db.updateOrder(id, { borzoOrderId: String(o.order_id), courierProvider: "borzo", ...this.courierPatch(o), courierStage: "booked" });
        row = this.reload(id);
      }
      ref = `borzo:${row.borzoOrderId}`;
    } else if (req.method === "tracking") {
      const carrier = req.carrier.toLowerCase().replace(/\s+/g, "-");
      ref = `track:${carrier}:${req.trackingNumber.replace(/\s+/g, "")}`;
      if (!CHECKER_REF_RE.test(ref)) fail("invalid_input", "Carrier and tracking number cannot contain | and must fit in 128 characters");
    } else {
      ref = "hand";
    }
    const courier: Partial<OrderRow> =
      req.method === "borzo" ? {} : { courierProvider: req.method, courierStage: "booked", courierRaw: null, courierUpdatedAt: this.now, courierTrackingUrl: null };
    row = await this.chainStep(
      row,
      "ship",
      () => this.escrow.markShipped(row.chainOrderId!, ref),
      { status: "Shipped", shippedAt: this.now, courierRef: ref, ...courier },
      ["Shipped", "Delivered", "Released"],
    );
    if (req.method !== "borzo" && row.courierRef === ref) this.d.db.updateOrder(id, { courierProvider: req.method, ...courier });
    if (req.method === "tracking" && this.d.trackers) {
      // Ship24 gets the chain order id, never our public id (that one is the order's access capability).
      await this.d.trackers.register(req.trackingNumber.replace(/\s+/g, ""), `doorstep-${row.chainOrderId}`).catch((e) => this.d.log.warn({ order: id, err: (e as Error).message }, "Ship24 tracker registration failed"));
    }
    return this.sellerView(this.reload(id));
  }

  /** Re-fetches a Borzo order and acts only on the drop point's delivery status "finished". */
  async handleBorzoUpdate(borzoOrderId: string): Promise<{ matched: boolean; confirmed: boolean }> {
    let row = this.d.db.getOrderByBorzoId(borzoOrderId);
    if (!row) return { matched: false, confirmed: false };
    const o = await this.d.borzo.getOrder(borzoOrderId);
    if (!o) return { matched: true, confirmed: false };
    this.d.db.updateOrder(row.id, this.courierPatch(o));
    if (deliveryStatus(o) !== "finished") return { matched: true, confirmed: false };
    row = await this.syncChain(this.reload(row.id), true);
    if (!AWAITING_DELIVERY.includes(row.status)) return { matched: true, confirmed: false };
    await this.checkerConfirm(row, row.courierRef ?? `borzo:${borzoOrderId}`);
    return { matched: true, confirmed: true };
  }

  /** Ship24 says a tracked parcel was delivered. */
  async handleTrackingDelivered(trackingNumber: string): Promise<number> {
    const number = trackingNumber.replace(/\s+/g, "");
    let confirmed = 0;
    for (const r of this.d.db.getOrdersByCourierRefSuffix(number)) {
      if (!r.courierRef?.startsWith("track:")) continue;
      const row = await this.syncChain(r, true);
      if (!AWAITING_DELIVERY.includes(row.status)) continue;
      this.d.db.updateOrder(row.id, { courierStage: "delivered", courierRaw: "delivered", courierUpdatedAt: this.now });
      await this.checkerConfirm(row, row.courierRef!);
      confirmed++;
    }
    return confirmed;
  }

  /** Once delivery is proven, a courier still shown as booked/picked up is shown as delivered. */
  private deliveredPatch(row: OrderRow, proof: "buyer" | "checker"): Partial<OrderRow> {
    const now = this.now;
    const patch: Partial<OrderRow> = { status: "Delivered", proof, deliveredAt: now, complaintEndsAt: now + this.windowMs };
    if (row.courierStage === "booked" || row.courierStage === "picked_up") {
      Object.assign(patch, { courierStage: "delivered", courierUpdatedAt: now }, row.courierProvider === "borzo" ? {} : { courierRaw: null });
    }
    return patch;
  }

  async checkerConfirm(row: OrderRow, courierRef: string): Promise<OrderRow> {
    return this.exclusive(
      `deliver:${row.id}`,
      () => this.reload(row.id),
      () =>
        this.chainStep(
          row,
          "deliver",
          () => this.d.checker.confirm(row.chainOrderId!, courierRef),
          this.deliveredPatch(row, "checker"),
          ["Delivered", "Disputed", "Released"],
        ),
    );
  }

  // --------------------------------------------------------- delivery code

  async revealOtp(id: string, req: OtpRevealRequest): Promise<OtpRevealResponse> {
    const row = await this.syncChain(this.must(id));
    if (!row.chainOrderId || !row.buyerPk) fail("invalid_state", "Order has no buyer yet");
    if (!AWAITING_DELIVERY.includes(row.status)) fail("invalid_state", `Order is ${row.status}; delivery codes are for paid orders awaiting delivery`);
    if (Math.abs(Math.floor(this.now / 1000) - req.signedAt) > OTP_CLOCK_SKEW_S) fail("invalid_signature", "Signature is too old or from the future; check your device clock");
    if (!verifyEd25519(row.buyerPk!, messages.otpReveal(row.chainOrderId!, row.escrow, req.signedAt), req.signature)) {
      fail("invalid_signature", "Signature does not match this order's buyer key");
    }
    if (this.d.db.countOtpReveals(id, this.now - OTP_TTL_MS) >= OTP_MAX_REVEALS) fail("rate_limited", "Too many codes requested; try again in a few minutes");
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const salt = randomBytes(16).toString("hex");
    const expiresAt = this.now + OTP_TTL_MS;
    this.d.db.putOtp({ orderId: id, salt, hash: hashCode(code, salt), expiresAt, tries: 0, createdAt: this.now });
    this.d.db.addOtpReveal(id, this.now);
    return { code, expiresAt: iso(expiresAt)! };
  }

  async verifyOtp(id: string, code: string): Promise<SellerOrder> {
    const row = await this.syncChain(this.must(id), true);
    if (!AWAITING_DELIVERY.includes(row.status)) fail("invalid_state", `Order is ${row.status}; nothing to confirm`);
    const otp = this.d.db.getOtp(id);
    if (!otp) fail("invalid_state", "No delivery code yet: ask the buyer to open their order page");
    if (otp!.expiresAt <= this.now) {
      this.d.db.deleteOtp(id);
      fail("invalid_state", "The code has expired; ask the buyer for a fresh one");
    }
    if (otp!.tries >= OTP_MAX_TRIES) fail("rate_limited", "Too many wrong tries; ask the buyer for a fresh code", { triesLeft: 0 });
    const tries = this.d.db.bumpOtpTries(id); // counted before comparing, so parallel guesses can't exceed the limit
    const ok = timingSafeEqual(Buffer.from(hashCode(code, otp!.salt), "hex"), Buffer.from(otp!.hash, "hex"));
    if (!ok) fail("invalid_input", "Wrong code", { triesLeft: Math.max(0, OTP_MAX_TRIES - tries) });
    const done = await this.checkerConfirm(row, row.courierRef ?? "code");
    this.d.db.deleteOtp(id);
    return this.sellerView(done);
  }

  // ================================================================== buyer

  async getPublic(id: string): Promise<Order> {
    return this.view(await this.refresh(this.must(id)));
  }

  async registerBuyer(id: string, req: RegisterBuyerRequest): Promise<Order> {
    let row = this.must(id);
    if (row.buyerPk && row.buyerPk !== req.buyerPk) fail("invalid_state", "This order is already linked to another buyer");
    const pending = this.registering.get(id);
    if (pending) {
      await pending;
      return this.view(this.reload(id));
    }
    if (row.buyerPk && row.chainOrderId) return this.view(await this.refresh(row)); // same key: idempotent
    if (row.status !== "Draft") fail("invalid_state", `Order is ${row.status}`);
    if (row.deliverBy <= this.now + MIN) fail("invalid_state", "This order's delivery deadline has passed; ask the shop for a new link");
    // Claim the Draft in SQLite first, so two requests can't create two chain orders.
    if (!row.buyerPk) {
      const won = this.d.db.updateOrderIf(id, { status: "Draft", buyerPkNull: true }, { buyerPk: req.buyerPk, buyerRefund: req.refundAccount });
      if (!won) return this.registerBuyer(id, req);
    }
    row = this.reload(id);
    const run = (async () => {
      try {
        const r = await this.escrow.createOrder({
          seller: row.shopAccount,
          price: row.priceUnits,
          deadline_ms: String(row.deliverBy),
          buyer_pk: req.buyerPk,
          buyer_refund: row.buyerRefund ?? req.refundAccount,
        });
        this.d.db.updateOrder(id, { chainOrderId: r.orderId, status: "Created", chainSyncedAt: this.now });
        this.recordTx(id, "create", r.hash);
      } catch (e) {
        this.d.db.updateOrder(id, { buyerPk: null, buyerRefund: null });
        throw e;
      }
    })();
    this.registering.set(id, run);
    try {
      await run;
    } finally {
      this.registering.delete(id);
    }
    return this.view(this.reload(id));
  }

  async rawTokens(): Promise<OneClickToken[]> {
    if (this.tokenCache && this.now - this.tokenCache.at < TOKENS_TTL_MS) return this.tokenCache.raw;
    const raw = await this.d.oneclick.tokens();
    this.tokenCache = { at: this.now, raw };
    return raw;
  }

  async tokens(): Promise<Token[]> {
    const raw = await this.rawTokens();
    return raw
      .filter((t) => t.assetId && t.symbol && t.blockchain)
      .map((t) => {
        const price = t.price == null ? null : Number(t.price);
        return {
          assetId: t.assetId,
          symbol: t.symbol,
          chain: t.blockchain,
          decimals: t.decimals,
          priceUsd: price != null && Number.isFinite(price) ? price : null,
          popular: isPopular(t),
        };
      })
      .sort((a, b) => Number(b.popular) - Number(a.popular) || a.symbol.localeCompare(b.symbol) || a.chain.localeCompare(b.chain));
  }

  /**
   * Dry: a price preview (Draft or Created). Real: a deposit address, only
   * after the same safety checks as scripts/oneclick-test.mjs, because 1Click
   * says funds sent with customRecipientMsg are lost if the recipient can't
   * accept them.
   */
  async quote(id: string, req: QuoteRequest): Promise<QuoteResponse> {
    let row = await this.syncChain(this.must(id), !req.dry);
    if (req.dry && !["Draft", "Created"].includes(row.status)) fail("invalid_state", `Order is ${row.status}; nothing to pay`);
    if (!req.dry && row.status !== "Created") fail("invalid_state", row.status === "Draft" ? "Open the order as the buyer first" : `Order is ${row.status}; nothing to pay`);

    const tokens = await this.rawTokens();
    const origin = tokens.find((t) => t.assetId === req.originAsset);
    if (!origin) fail("invalid_input", "1Click does not support this token");
    let amount = row.priceUnits;

    if (!req.dry) {
      if (!tokens.some((t) => t.assetId === USDC_NEAR_ASSET)) fail("oneclick_error", "USDC on NEAR is missing from 1Click's token list");
      const c = await this.escrow.getOrder(row.chainOrderId!);
      if (!c) fail("invalid_state", `Order ${row.chainOrderId} does not exist on ${row.escrow}`);
      row = this.applyChain(row, c);
      if (c!.status !== "Created") fail("invalid_state", `Order is ${c!.status} on chain, not waiting for payment`);
      if (Number(c!.deadline_ms) < this.now + QUOTE_MIN_DEADLINE_MS) fail("invalid_state", "The delivery deadline is under 40 minutes away; ask the shop for a new link");
      if (c!.price !== row.priceUnits || c!.seller !== row.shopAccount) fail("invalid_state", "On-chain order does not match this order");
      if (!(await this.escrow.usdcRegistered())) fail("invalid_state", "The escrow is not registered with the USDC contract; payments are paused");
      const prev = this.d.db.latestPayment(id);
      if (prev && ["KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"].includes(prev.status)) fail("invalid_state", "A payment for this order is already on its way");
      amount = c!.price;
    }

    const request: OneClickQuoteRequest = {
      dry: req.dry,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: origin!.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: USDC_NEAR_ASSET,
      amount,
      refundTo: req.refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: row.escrow,
      recipientType: "DESTINATION_CHAIN",
      ...(row.chainOrderId ? { customRecipientMsg: row.chainOrderId } : {}),
      deadline: new Date(this.now + 30 * MIN).toISOString(),
      referral: "doorstep",
    };
    const res = await this.d.oneclick.quote(request);
    const q = res.quote;
    let deadline: number | null = null;

    if (!req.dry) {
      if (!q?.depositAddress) fail("oneclick_error", "1Click returned no deposit address");
      const echoed = res.quoteRequest;
      if (echoed && (echoed.recipient !== row.escrow || echoed.customRecipientMsg !== row.chainOrderId || echoed.destinationAsset !== USDC_NEAR_ASSET)) {
        fail("oneclick_error", "1Click's quote does not match the request; refusing to show a deposit address");
      }
      if (BigInt(q.amountOut) < BigInt(amount)) fail("oneclick_error", "1Click's quote delivers less than the price");
      // We asked for 30 minutes; 1Click may allow longer. Show the earlier one.
      const theirs = q.deadline ? Date.parse(q.deadline) : NaN;
      deadline = Math.min(Number.isFinite(theirs) ? theirs : Infinity, Date.parse(request.deadline));
      this.d.db.insertPayment({
        orderId: id,
        status: "PENDING_DEPOSIT",
        originAsset: origin!.assetId,
        originSymbol: origin!.symbol,
        originChain: origin!.blockchain,
        amountIn: q.amountIn,
        amountInFormatted: q.amountInFormatted,
        depositAddress: q.depositAddress!,
        depositMemo: q.depositMemo ?? null,
        deadline,
        refundTo: req.refundTo,
        quotedAt: this.now,
        originTxHash: null,
        nearTxHashes: "[]",
        quoteJson: JSON.stringify(res), // the signed quote: keep it in case of a dispute
        issue: null,
        polledAt: null,
      });
    }

    return {
      dry: req.dry,
      amountIn: q.amountIn,
      amountInFormatted: q.amountInFormatted,
      minAmountIn: q.minAmountIn,
      amountOutFormatted: q.amountOutFormatted,
      timeEstimateSec: q.timeEstimate ?? null,
      depositAddress: req.dry ? null : q.depositAddress!,
      depositMemo: req.dry ? null : (q.depositMemo ?? null),
      deadline: deadline == null ? null : iso(deadline),
      order: this.view(this.reload(id)),
    };
  }

  async submitDeposit(id: string, req: DepositSubmitRequest): Promise<Order> {
    const row = this.must(id);
    const p = this.d.db.latestPayment(id);
    if (!p) fail("invalid_state", "Get a deposit address first");
    if (!["Created", "Funded"].includes(row.status)) fail("invalid_state", `Order is ${row.status}`);
    await this.d.oneclick.submitDeposit(req.txHash, p!.depositAddress, p!.depositMemo);
    this.d.db.updatePayment(p!.id, { originTxHash: req.txHash, polledAt: null });
    return this.getPublic(id);
  }

  /** Polls 1Click for one payment; on SUCCESS checks the escrow really marked the order Funded. */
  async pollPayment(p: PaymentRow): Promise<void> {
    const st = await this.d.oneclick.status(p.depositAddress, p.depositMemo);
    const status = PaymentStatusSchema.safeParse(st.status).success ? (st.status as PaymentRow["status"]) : p.status;
    const hashes = st.swapDetails?.nearTxHashes?.length ? st.swapDetails.nearTxHashes : (JSON.parse(p.nearTxHashes) as string[]);
    const originTx = st.swapDetails?.originChainTxHashes?.[0]?.hash ?? p.originTxHash;
    this.d.db.updatePayment(p.id, { status, nearTxHashes: JSON.stringify(hashes), originTxHash: originTx, polledAt: this.now });
    if (status !== "SUCCESS") return;

    let row = this.must(p.orderId);
    if (!row.chainOrderId) return;
    const c = await this.escrow.getOrder(row.chainOrderId);
    row = this.applyChain(row, c);
    if (c && c.status !== "Created" && c.funded_ms) {
      const last = hashes[hashes.length - 1];
      if (last) this.recordTx(row.id, "fund", last);
      this.d.db.updatePayment(p.id, { issue: null });
      return;
    }
    const parked = (await this.escrow.getUnmatched()).filter((u) => u.order_id === row.chainOrderId || u.msg.trim() === row.chainOrderId);
    const issue = parked.length
      ? `The payment reached the escrow but was parked (${[...new Set(parked.map((u) => u.reason))].join(", ")}). It is safe; the escrow owner can refund it.`
      : "1Click reports success; waiting for the escrow to mark the order paid.";
    if (parked.length) this.d.log.warn({ order: row.id, parked: parked.map((u) => u.id) }, "payment parked as unmatched");
    this.d.db.updatePayment(p.id, { issue });
  }

  async confirm(id: string, signature: string): Promise<Order> {
    let row = this.must(id);
    if (!row.chainOrderId || !row.buyerPk) fail("invalid_state", "Order has no buyer yet");
    row = await this.syncChain(row, true);
    if (["Delivered", "Disputed", "Released"].includes(row.status) && row.proof === "buyer") return this.view(row);
    if (!AWAITING_DELIVERY.includes(row.status)) fail("invalid_state", `Order is ${row.status}; nothing to confirm`);
    if (!verifyEd25519(row.buyerPk!, messages.delivered(row.chainOrderId!, row.escrow), signature)) fail("invalid_signature", "Signature does not match this order's buyer key");
    row = await this.chainStep(
      row,
      "deliver",
      () => this.escrow.confirmByBuyer(row.chainOrderId!, signature),
      this.deliveredPatch(row, "buyer"),
      ["Delivered", "Disputed", "Released"],
    );
    return this.view(row);
  }

  async complaint(id: string, signature: string): Promise<Order> {
    let row = this.must(id);
    if (!row.chainOrderId || !row.buyerPk) fail("invalid_state", "Order has no buyer yet");
    row = await this.syncChain(row, true);
    if (row.status === "Disputed") return this.view(row);
    if (row.status !== "Delivered") fail("invalid_state", `Order is ${row.status}; complaints are only possible right after delivery`);
    if (row.complaintEndsAt != null && this.now >= row.complaintEndsAt) fail("invalid_state", "The complaint window has closed");
    if (!verifyEd25519(row.buyerPk!, messages.complaint(row.chainOrderId!, row.escrow), signature)) fail("invalid_signature", "Signature does not match this order's buyer key");
    row = await this.chainStep(row, "complaint", () => this.escrow.raiseComplaint(row.chainOrderId!, signature), { status: "Disputed" }, ["Disputed"]);
    return this.view(row);
  }

  // ============================================================== payouts

  /** release after the window; the caller (scheduler/demo) holds the claim. */
  async releaseNow(row: OrderRow): Promise<OrderRow> {
    return this.chainStep(row, "release", () => this.escrow.release(row.chainOrderId!), { status: "Released", closedAt: this.now }, ["Released"]);
  }

  /** refund after the deadline: Created -> Expired, Funded/Shipped -> Refunded. */
  async refundNow(row: OrderRow): Promise<OrderRow> {
    const expected: Partial<OrderRow> = row.status === "Created" ? { status: "Expired", closedAt: this.now } : { status: "Refunded", closedAt: this.now };
    return this.chainStep(row, "refund", () => this.escrow.refund(row.chainOrderId!), expected, ["Refunded", "Expired"]);
  }

  activeOnChain(): OrderRow[] {
    return this.d.db.listOrders(ON_CHAIN_ACTIVE).filter((r) => r.chainOrderId);
  }
}

