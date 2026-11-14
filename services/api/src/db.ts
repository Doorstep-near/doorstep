// SQLite storage with node:sqlite (built into Node >= 22.13; no native build step).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { CourierStage, DeliveryMethod, OrderStatus, PaymentStatus, TxKind } from "@doorstep/shared";

export interface OrderRow {
  id: string;
  chainOrderId: string | null;
  status: OrderStatus;
  item: string;
  note: string | null;
  priceUnits: string;
  paidUnits: string;
  shopName: string;
  shopAccount: string;
  escrow: string;
  deliveryMethod: DeliveryMethod;
  deliveryArea: string | null;
  deliveryAddress: string | null;
  buyerPhone: string | null;
  buyerPk: string | null;
  buyerRefund: string | null;
  deliverBy: number;
  createdAt: number;
  fundedAt: number | null;
  shippedAt: number | null;
  deliveredAt: number | null;
  complaintEndsAt: number | null;
  closedAt: number | null;
  proof: "buyer" | "checker" | null;
  courierProvider: DeliveryMethod | null;
  courierRef: string | null;
  courierStage: CourierStage | null;
  courierRaw: string | null;
  courierTrackingUrl: string | null;
  riderName: string | null;
  riderPhone: string | null;
  courierPriceInr: string | null;
  courierUpdatedAt: number | null;
  borzoOrderId: string | null;
  chainSyncedAt: number | null;
  demo: number;
}

export interface PaymentRow {
  id: number;
  orderId: string;
  status: PaymentStatus;
  originAsset: string;
  originSymbol: string;
  originChain: string;
  amountIn: string;
  amountInFormatted: string;
  depositAddress: string;
  depositMemo: string | null;
  deadline: number;
  refundTo: string;
  quotedAt: number;
  originTxHash: string | null;
  nearTxHashes: string; // JSON array
  quoteJson: string;
  issue: string | null;
  polledAt: number | null;
}

export interface TxRow {
  orderId: string;
  kind: TxKind;
  hash: string;
  at: number;
  url: string;
}

export interface OtpRow {
  orderId: string;
  salt: string;
  hash: string;
  expiresAt: number;
  tries: number;
  createdAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  chain_order_id TEXT UNIQUE,
  status TEXT NOT NULL,
  item TEXT NOT NULL,
  note TEXT,
  price_units TEXT NOT NULL,
  paid_units TEXT NOT NULL DEFAULT '0',
  shop_name TEXT NOT NULL,
  shop_account TEXT NOT NULL,
  escrow TEXT NOT NULL,
  delivery_method TEXT NOT NULL,
  delivery_area TEXT,
  delivery_address TEXT,
  buyer_phone TEXT,
  buyer_pk TEXT,
  buyer_refund TEXT,
  deliver_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  funded_at INTEGER,
  shipped_at INTEGER,
  delivered_at INTEGER,
  complaint_ends_at INTEGER,
  closed_at INTEGER,
  proof TEXT,
  courier_provider TEXT,
  courier_ref TEXT,
  courier_stage TEXT,
  courier_raw TEXT,
  courier_tracking_url TEXT,
  rider_name TEXT,
  rider_phone TEXT,
  courier_price_inr TEXT,
  courier_updated_at INTEGER,
  borzo_order_id TEXT,
  chain_synced_at INTEGER,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS orders_borzo ON orders(borzo_order_id);
CREATE INDEX IF NOT EXISTS orders_courier_ref ON orders(courier_ref);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL,
  origin_asset TEXT NOT NULL,
  origin_symbol TEXT NOT NULL,
  origin_chain TEXT NOT NULL,
  amount_in TEXT NOT NULL,
  amount_in_formatted TEXT NOT NULL,
  deposit_address TEXT NOT NULL,
  deposit_memo TEXT,
  deadline INTEGER NOT NULL,
  refund_to TEXT NOT NULL,
  quoted_at INTEGER NOT NULL,
  origin_tx_hash TEXT,
  near_tx_hashes TEXT NOT NULL DEFAULT '[]',
  quote_json TEXT NOT NULL,
  issue TEXT,
  polled_at INTEGER
);
CREATE INDEX IF NOT EXISTS payments_order ON payments(order_id);

CREATE TABLE IF NOT EXISTS txs (
  order_id TEXT NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL,
  hash TEXT NOT NULL,
  at INTEGER NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY (order_id, kind, hash)
);

CREATE TABLE IF NOT EXISTS otps (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_reveals (
  order_id TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  key TEXT PRIMARY KEY,
  until INTEGER NOT NULL
);

-- Shops that signed up themselves with a NEAR wallet (shops from .env or MERCHANTS_FILE aren't stored here).
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account TEXT NOT NULL UNIQUE,
  area TEXT,
  created_at INTEGER NOT NULL
);

-- Seller sessions from wallet sign-in. Only a hash of the token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- One-time sign-in challenges (NEP-413 nonces).
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
`;

export interface MerchantRow {
  id: string;
  name: string;
  account: string;
  area: string | null;
  createdAt: number;
}

export interface SessionRow {
  tokenHash: string;
  account: string;
  createdAt: number;
  expiresAt: number;
}

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function fromRow<T>(row: Record<string, unknown> | undefined): T | undefined {
  if (!row) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out as T;
}

const val = (v: unknown): SQLInputValue => (v === undefined ? null : (v as SQLInputValue));

export class Db {
  readonly sql: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    this.sql.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    if (path !== ":memory:") this.sql.exec("PRAGMA journal_mode = WAL;");
    this.sql.exec(SCHEMA);
  }

  close() {
    this.sql.close();
  }

  /** Runs `fn` inside one SQLite transaction. */
  tx<T>(fn: () => T): T {
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.sql.exec("COMMIT");
      return r;
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    }
  }

  // ------------------------------------------------------------------ orders

  insertOrder(o: OrderRow) {
    const keys = Object.keys(o) as (keyof OrderRow)[];
    this.sql
      .prepare(`INSERT INTO orders (${keys.map(snake).join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
      .run(...keys.map((k) => val(o[k])));
  }

  getOrder(id: string): OrderRow | undefined {
    return fromRow<OrderRow>(this.sql.prepare("SELECT * FROM orders WHERE id = ?").get(id));
  }

  getOrderByChainId(chainId: string): OrderRow | undefined {
    return fromRow<OrderRow>(this.sql.prepare("SELECT * FROM orders WHERE chain_order_id = ?").get(chainId));
  }

  getOrderByBorzoId(borzoId: string): OrderRow | undefined {
    return fromRow<OrderRow>(this.sql.prepare("SELECT * FROM orders WHERE borzo_order_id = ?").get(borzoId));
  }

  getOrdersByCourierRefSuffix(suffix: string): OrderRow[] {
    return this.sql
      .prepare("SELECT * FROM orders WHERE courier_ref LIKE ? ORDER BY created_at DESC")
      .all(`%:${suffix}`)
      .map((r) => fromRow<OrderRow>(r)!);
  }

  listOrders(statuses?: OrderStatus[]): OrderRow[] {
    const rows = statuses?.length
      ? this.sql.prepare(`SELECT * FROM orders WHERE status IN (${statuses.map(() => "?").join(",")}) ORDER BY created_at DESC`).all(...statuses)
      : this.sql.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
    return rows.map((r) => fromRow<OrderRow>(r)!);
  }

  updateOrder(id: string, patch: Partial<OrderRow>) {
    const keys = (Object.keys(patch) as (keyof OrderRow)[]).filter((k) => k !== "id");
    if (!keys.length) return;
    this.sql.prepare(`UPDATE orders SET ${keys.map((k) => `${snake(k)} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => val(patch[k])), id);
  }

  /** Compare-and-set on status; returns true if this caller won. */
  updateOrderIf(id: string, expected: { status?: OrderStatus; buyerPkNull?: boolean }, patch: Partial<OrderRow>): boolean {
    const keys = (Object.keys(patch) as (keyof OrderRow)[]).filter((k) => k !== "id");
    const where = ["id = ?"];
    const params: SQLInputValue[] = [...keys.map((k) => val(patch[k])), id];
    if (expected.status) {
      where.push("status = ?");
      params.push(expected.status);
    }
    if (expected.buyerPkNull) where.push("buyer_pk IS NULL");
    const r = this.sql.prepare(`UPDATE orders SET ${keys.map((k) => `${snake(k)} = ?`).join(", ")} WHERE ${where.join(" AND ")}`).run(...params);
    return Number(r.changes) > 0;
  }

  countOrders(): number {
    const r = this.sql.prepare("SELECT COUNT(*) AS n FROM orders WHERE status != 'Draft'").get() as { n: number };
    return Number(r.n);
  }

  // ---------------------------------------------------------------- payments

  insertPayment(p: Omit<PaymentRow, "id">): number {
    const keys = Object.keys(p) as (keyof typeof p)[];
    const r = this.sql
      .prepare(`INSERT INTO payments (${keys.map(snake).join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
      .run(...keys.map((k) => val(p[k])));
    return Number(r.lastInsertRowid);
  }

  latestPayment(orderId: string): PaymentRow | undefined {
    return fromRow<PaymentRow>(this.sql.prepare("SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1").get(orderId));
  }

  /** Payments still worth polling: not final in 1Click, order not closed. */
  activePayments(): PaymentRow[] {
    return this.sql
      .prepare(
        `SELECT p.* FROM payments p JOIN orders o ON o.id = p.order_id
         WHERE p.status NOT IN ('REFUNDED','FAILED') AND o.status IN ('Created','Funded')
           AND (p.status != 'SUCCESS' OR o.status = 'Created')
         ORDER BY p.id`,
      )
      .all()
      .map((r) => fromRow<PaymentRow>(r)!);
  }

  updatePayment(id: number, patch: Partial<PaymentRow>) {
    const keys = (Object.keys(patch) as (keyof PaymentRow)[]).filter((k) => k !== "id");
    if (!keys.length) return;
    this.sql.prepare(`UPDATE payments SET ${keys.map((k) => `${snake(k)} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => val(patch[k])), id);
  }

  // --------------------------------------------------------------------- txs

  // ------------------------------------------------------------ shops & sign-in

  insertMerchant(m: MerchantRow) {
    this.sql.prepare("INSERT INTO merchants (id, name, account, area, created_at) VALUES (?, ?, ?, ?, ?)").run(m.id, m.name, m.account, m.area, m.createdAt);
  }

  getMerchantByAccount(account: string): MerchantRow | undefined {
    return fromRow<MerchantRow>(this.sql.prepare("SELECT * FROM merchants WHERE account = ?").get(account));
  }

  listMerchants(): MerchantRow[] {
    return this.sql
      .prepare("SELECT * FROM merchants ORDER BY created_at")
      .all()
      .map((r) => fromRow<MerchantRow>(r)!);
  }

  putSession(s: SessionRow) {
    this.sql.prepare("INSERT INTO sessions (token_hash, account, created_at, expires_at) VALUES (?, ?, ?, ?)").run(s.tokenHash, s.account, s.createdAt, s.expiresAt);
  }

  getSession(tokenHash: string): SessionRow | undefined {
    return fromRow<SessionRow>(this.sql.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash));
  }

  deleteSession(tokenHash: string) {
    this.sql.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  putNonce(nonce: string, expiresAt: number) {
    this.sql.prepare("INSERT INTO auth_nonces (nonce, expires_at) VALUES (?, ?)").run(nonce, expiresAt);
    // Housekeeping: drop challenges that expired over a day ago.
    this.sql.prepare("DELETE FROM auth_nonces WHERE expires_at < ?").run(expiresAt - 24 * 3600_000);
  }

  /** True if the nonce was issued, unused and unexpired; marks it used (atomic). */
  useNonce(nonce: string, now: number): boolean {
    return this.sql.prepare("UPDATE auth_nonces SET used = 1 WHERE nonce = ? AND used = 0 AND expires_at > ?").run(nonce, now).changes === 1;
  }

  nonceIssued(nonce: string, now: number): boolean {
    return !!this.sql.prepare("SELECT 1 FROM auth_nonces WHERE nonce = ? AND used = 0 AND expires_at > ?").get(nonce, now);
  }

  countTxsSince(kind: TxKind, since: number): number {
    return (this.sql.prepare("SELECT COUNT(*) AS n FROM txs WHERE kind = ? AND at >= ?").get(kind, since) as { n: number }).n;
  }

  addTx(t: TxRow) {
    this.sql.prepare("INSERT OR IGNORE INTO txs (order_id, kind, hash, at, url) VALUES (?, ?, ?, ?, ?)").run(t.orderId, t.kind, t.hash, t.at, t.url);
  }

  txs(orderId: string): TxRow[] {
    return this.sql
      .prepare("SELECT * FROM txs WHERE order_id = ? ORDER BY at, rowid")
      .all(orderId)
      .map((r) => fromRow<TxRow>(r)!);
  }

  // -------------------------------------------------------------------- otps

  getOtp(orderId: string): OtpRow | undefined {
    return fromRow<OtpRow>(this.sql.prepare("SELECT * FROM otps WHERE order_id = ?").get(orderId));
  }

  putOtp(o: OtpRow) {
    this.sql
      .prepare(
        `INSERT INTO otps (order_id, salt, hash, expires_at, tries, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(order_id) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, expires_at = excluded.expires_at, tries = excluded.tries, created_at = excluded.created_at`,
      )
      .run(o.orderId, o.salt, o.hash, o.expiresAt, o.tries, o.createdAt);
  }

  /** Atomically counts one wrong try; returns the new count. */
  bumpOtpTries(orderId: string): number {
    this.sql.prepare("UPDATE otps SET tries = tries + 1 WHERE order_id = ?").run(orderId);
    return this.getOtp(orderId)?.tries ?? 0;
  }

  deleteOtp(orderId: string) {
    this.sql.prepare("DELETE FROM otps WHERE order_id = ?").run(orderId);
  }

  countOtpReveals(orderId: string, since: number): number {
    const r = this.sql.prepare("SELECT COUNT(*) AS n FROM otp_reveals WHERE order_id = ? AND at > ?").get(orderId, since) as { n: number };
    return Number(r.n);
  }

  addOtpReveal(orderId: string, at: number) {
    this.sql.prepare("INSERT INTO otp_reveals (order_id, at) VALUES (?, ?)").run(orderId, at);
  }

  // ------------------------------------------------------------------ claims

  /**
   * Atomic lease: returns true if the caller now holds `key` until `now + ttlMs`.
   * Safe across concurrent ticks and across processes sharing the same file.
   */
  claim(key: string, now: number, ttlMs: number): boolean {
    const r = this.sql
      .prepare("INSERT INTO claims (key, until) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET until = excluded.until WHERE claims.until <= ?")
      .run(key, now + ttlMs, now);
    return Number(r.changes) > 0;
  }

  unclaim(key: string) {
    this.sql.prepare("DELETE FROM claims WHERE key = ?").run(key);
  }
}
