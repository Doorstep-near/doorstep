// In-browser implementation of the Doorstep HTTP contract, persisted in
// localStorage. It validates requests with the shared schemas, verifies buyer
// signatures for real, and moves payments along on a timer, so the whole flow
// can be clicked through without a backend.
import {
  CreateOrderRequest,
  DepositSubmitRequest,
  OtpRevealRequest,
  OtpVerifyRequest,
  Order,
  QuoteRequest,
  RegisterBuyerRequest,
  ShipQuoteRequest,
  ShipRequest,
  SignatureRequest,
  messages,
  unitsToUsdc,
  type AppConfig,
  type Courier,
  type Payment,
  type QuoteResponse,
  type SellerOrder,
  type SellerSummary,
  type Stats,
  type Token,
  type TxKind,
} from "@doorstep/shared";
import type { z } from "zod";
import type { Transport, TransportRequest, TransportResponse } from "../api";
import { base58Encode } from "../base58";
import { generateKey, saveKey, verifyMessage } from "../buyerKey";
import { chainInfo } from "../chains";
import { MOCK_TOKENS } from "./tokens";

// ------------------------------------------------------------------ constants

const STORE_KEY = "doorstep:mock:v1";
export const MOCK_SELLER_TOKEN = "demo";
export const MOCK_ESCROW = "escrow.doorstep-demo.near";
const SHOP = { name: "Eraya Foods (demo)", account: "erayafoods.near" };
const COMPLAINT_WINDOW_MS = 10 * 60_000;
const INR_PER_USD = 84.2;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Tests set delayScale to 0. */
export const mockSettings = { delayScale: 1 };

interface Priv {
  depositSubmittedAt?: number;
  otp?: { code: string; expiresAt: number };
  otpTriesLeft: number;
}
interface Entry {
  order: SellerOrder;
  priv: Priv;
}
interface Store {
  version: 1;
  seededAt: number;
  nextChainId: number;
  entries: Entry[];
}

class MockError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ helpers

const iso = (ms: number) => new Date(ms).toISOString();
const webUrl = () => (typeof window !== "undefined" ? window.location.origin : "http://localhost:5173");

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}
const B62 = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
function randomId(len = 12): string {
  return Array.from(randomBytes(len), (b) => B62[b % B62.length]).join("");
}
const randomHash = () => base58Encode(randomBytes(32));
const randomHex = (bytes: number) => Array.from(randomBytes(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const randomDigits = (n: number) => Array.from(randomBytes(n), (b) => String(b % 10)).join("");

function tx(kind: TxKind, at: number) {
  return { kind, hash: randomHash(), at: iso(at), url: "#demo" };
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "•••";
  const hasCc = phone.trim().startsWith("+") && digits.length > 10;
  const cc = hasCc ? digits.slice(0, digits.length - 10) : "";
  const national = hasCc ? digits.slice(-10) : digits;
  return `${cc ? `+${cc} ` : ""}${national.slice(0, 2)}${"•".repeat(Math.max(1, national.length - 5))}${national.slice(-3)}`;
}

/** "1.5" with 18 decimals -> "1500000000000000000". */
function decimalToUnits(amount: string, decimals: number): string {
  const [whole = "0", frac = ""] = amount.split(".");
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}

function depositAddressFor(chain: string): string {
  const info = chainInfo(chain);
  if (info.family === "evm") return `0x${randomHex(20)}`;
  switch (chain) {
    case "near":
      return randomHex(32);
    case "btc":
      return `bc1q${Array.from(randomBytes(38), (b) => "qpzry9x8gf2tvdw0s3jn54khce6mua7l"[b % 32]).join("")}`;
    case "tron":
      return `T${base58Encode(randomBytes(25)).slice(0, 33).padEnd(33, "x")}`;
    case "xrp":
      return `r${base58Encode(randomBytes(24)).slice(0, 33)}`;
    default:
      return base58Encode(randomBytes(32));
  }
}

function etaFor(chain: string): number {
  if (chain === "near") return 15;
  if (chain === "eth") return 90;
  if (chain === "btc") return 1500;
  if (chain === "sol") return 30;
  if (chain === "tron") return 60;
  return 35;
}

function quoteAmounts(token: Token, priceUnits: string) {
  const usd = (Number(BigInt(priceUnits)) / 1e6) * 1.0103;
  const price = token.priceUsd ?? 1;
  const dp = Math.min(token.decimals, price >= 1000 ? 8 : 6);
  const factor = 10 ** dp;
  const amount = Math.ceil((usd / price) * factor) / factor;
  const formatted = amount.toFixed(dp).replace(/0+$/, "").replace(/\.$/, "");
  const min = Math.floor(amount * 0.99 * factor) / factor;
  return {
    amountIn: decimalToUnits(formatted, token.decimals),
    amountInFormatted: formatted,
    minAmountIn: decimalToUnits(min.toFixed(dp), token.decimals),
    amountOutFormatted: unitsToUsdc(priceUnits, 6),
    timeEstimateSec: etaFor(token.chain),
  };
}

function findToken(assetId: string): Token {
  const token = MOCK_TOKENS.find((t) => t.assetId === assetId);
  if (!token) throw new MockError(400, "invalid_input", "That token isn't supported. Pick another one.");
  return token;
}

function demoRefundAddress(chain: string): string {
  const info = chainInfo(chain);
  if (info.family === "evm") return "0x5e2f1a4b7c9d3e8f0a1b2c3d4e5f6a7b8c9d0e1f";
  if (chain === "near") return "mom-gifts.near";
  if (chain === "tron") return "TQ7mDemoRefundAddr1111111111111111";
  return "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
}

function makePayment(token: Token, priceUnits: string, refundTo: string, at: number): Payment {
  const q = quoteAmounts(token, priceUnits);
  return {
    status: "PENDING_DEPOSIT",
    originAsset: token.assetId,
    originSymbol: token.symbol,
    originChain: token.chain,
    amountIn: q.amountIn,
    amountInFormatted: q.amountInFormatted,
    depositAddress: depositAddressFor(token.chain),
    depositMemo: token.chain === "xrp" || token.chain === "stellar" ? randomDigits(9) : null,
    deadline: iso(at + HOUR),
    refundTo,
    quotedAt: iso(at),
    originTxHash: null,
    nearTxHashes: [],
  };
}

const tokenBy = (symbol: string, chain: string) => MOCK_TOKENS.find((t) => t.symbol === symbol && t.chain === chain)!;

// ------------------------------------------------------------------ state changes

function newEntry(input: {
  id?: string;
  item: string;
  note?: string | null;
  priceUnits: string;
  method: SellerOrder["delivery"]["method"];
  area?: string | null;
  address?: string | null;
  phone: string;
  createdAt: number;
  deliverBy: number;
}): Entry {
  const id = input.id ?? randomId();
  return {
    priv: { otpTriesLeft: 5 },
    order: {
      id,
      chainOrderId: null,
      status: "Draft",
      item: input.item,
      note: input.note ?? null,
      priceUnits: input.priceUnits,
      paidUnits: "0",
      shop: { ...SHOP },
      escrow: MOCK_ESCROW,
      delivery: { method: input.method, area: input.area ?? null, courier: null },
      buyer: { phoneMasked: maskPhone(input.phone), refundAccount: null, publicKey: null },
      deliverBy: iso(input.deliverBy),
      createdAt: iso(input.createdAt),
      fundedAt: null,
      shippedAt: null,
      deliveredAt: null,
      complaintEndsAt: null,
      closedAt: null,
      proof: null,
      payment: null,
      txs: [],
      demo: true,
      buyerPhone: input.phone,
      deliveryAddress: input.address ?? null,
      payLink: `${webUrl()}/pay/${id}`,
    },
  };
}

function register(store: Store, e: Entry, at: number, publicKey: string, refundAccount: string) {
  const o = e.order;
  o.status = "Created";
  o.chainOrderId = String(store.nextChainId++);
  o.buyer.publicKey = publicKey;
  o.buyer.refundAccount = refundAccount;
  o.txs.push(tx("create", at));
}

/** Registers a throwaway buyer key and keeps it in this browser, so the buyer pages work for demo orders. */
function registerDemoBuyer(store: Store, e: Entry, at: number, refundAccount = "0x5e2f1a4b7c9d3e8f0a1b2c3d4e5f6a7b8c9d0e1f") {
  const key = generateKey();
  saveKey(e.order.id, key);
  register(store, e, at, key.publicKey, refundAccount);
}

function fund(e: Entry, at: number, token: Token = tokenBy("USDC", "base")) {
  const o = e.order;
  if (!o.payment) {
    o.payment = makePayment(token, o.priceUnits, demoRefundAddress(token.chain), at - 90 * SECOND);
    o.payment.originTxHash = `0x${randomHex(32)}`;
  }
  o.payment.status = "SUCCESS";
  o.payment.nearTxHashes = [randomHash(), randomHash(), randomHash()];
  o.status = "Funded";
  o.paidUnits = o.priceUnits;
  o.fundedAt = iso(at);
  o.txs.push(tx("fund", at));
  e.priv.depositSubmittedAt = undefined;
}

function courierFor(o: SellerOrder, at: number, req: z.infer<typeof ShipRequest>): Courier {
  const base = { trackingUrl: null, riderName: null, riderPhone: null, priceInr: null, updatedAt: iso(at) };
  if (req.method === "hand") return { ...base, provider: "hand", ref: "hand", stage: "picked_up", rawStatus: null };
  if (req.method === "tracking") {
    return {
      ...base,
      provider: "tracking",
      ref: `track:${req.carrier.toLowerCase()}:${req.trackingNumber}`,
      stage: "booked",
      rawStatus: "InfoReceived",
      trackingUrl: `https://parcelsapp.com/en/tracking/${encodeURIComponent(req.trackingNumber)}`,
    };
  }
  return {
    ...base,
    provider: "borzo",
    ref: `borzo:${randomDigits(7)}`,
    stage: "booked",
    rawStatus: "courier_assigned",
    riderName: "Ravi Kumar",
    riderPhone: "+91 98100 22451",
    priceInr: borzoPrice(o.id),
  };
}

function borzoPrice(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997;
  return String(95 + (h % 86));
}

function ship(e: Entry, at: number, req: z.infer<typeof ShipRequest>) {
  const o = e.order;
  o.delivery.courier = courierFor(o, at, req);
  o.status = "Shipped";
  o.shippedAt = iso(at);
  o.txs.push(tx("ship", at));
}

function defaultShipRequest(o: SellerOrder): z.infer<typeof ShipRequest> {
  if (o.delivery.method === "tracking") return { method: "tracking", carrier: "indiapost", trackingNumber: `EE${randomDigits(9)}IN` };
  return { method: o.delivery.method };
}

function deliver(e: Entry, at: number, proof: "buyer" | "checker") {
  const o = e.order;
  o.status = "Delivered";
  o.deliveredAt = iso(at);
  o.complaintEndsAt = iso(at + COMPLAINT_WINDOW_MS);
  o.proof = proof;
  if (o.delivery.courier) {
    o.delivery.courier.stage = "delivered";
    o.delivery.courier.rawStatus = o.delivery.courier.provider === "borzo" ? "finished" : o.delivery.courier.rawStatus;
    o.delivery.courier.updatedAt = iso(at);
  }
  o.txs.push(tx("deliver", at));
  e.priv.otp = undefined;
}

function release(e: Entry, at: number) {
  e.order.status = "Released";
  e.order.closedAt = iso(at);
  e.order.txs.push(tx("release", at));
}

function refund(e: Entry, at: number) {
  e.order.status = "Refunded";
  e.order.closedAt = iso(at);
  e.order.txs.push(tx("refund", at));
}

/** Time-based changes: payment progress, courier pickup, auto-release, deadlines. */
function tick(e: Entry, now: number) {
  const o = e.order;
  if (o.status === "Created" && o.payment && e.priv.depositSubmittedAt) {
    const elapsed = now - e.priv.depositSubmittedAt;
    if (elapsed >= 8 * SECOND) fund(e, e.priv.depositSubmittedAt + 8 * SECOND);
    else if (elapsed >= 3 * SECOND) o.payment.status = "PROCESSING";
    else o.payment.status = "KNOWN_DEPOSIT_TX";
  }
  const c = o.delivery.courier;
  if (o.status === "Shipped" && c?.provider === "borzo" && c.stage === "booked" && now - Date.parse(c.updatedAt) > 20 * SECOND) {
    c.stage = "picked_up";
    c.rawStatus = "parcel_picked_up";
    c.updatedAt = iso(now);
  }
  if (o.status === "Delivered" && o.complaintEndsAt && now >= Date.parse(o.complaintEndsAt)) {
    release(e, Math.min(now, Date.parse(o.complaintEndsAt) + 4 * SECOND));
  }
  const deadline = Date.parse(o.deliverBy);
  if (now >= deadline) {
    if (o.status === "Draft" || o.status === "Created") {
      o.status = "Expired";
      o.closedAt = iso(deadline);
    } else if (o.status === "Funded" || o.status === "Shipped") {
      refund(e, deadline + 5 * SECOND);
    }
  }
}

// ------------------------------------------------------------------ seed data

function seed(): Store {
  const now = Date.now();
  const store: Store = { version: 1, seededAt: now, nextChainId: 41, entries: [] };
  const add = (e: Entry) => {
    store.entries.push(e);
    return e;
  };

  // 1. Draft: the demo pay link ("send something to Mom").
  add(
    newEntry({
      id: "demo-mom-gift",
      item: "Makhana gift box · 4 flavours",
      note: "For Mom — Happy Diwali! Please deliver before evening.",
      priceUnits: "12000000",
      method: "borzo",
      area: "Noida",
      address: "B-42, Sector 50, Noida, Uttar Pradesh 201301",
      phone: "+91 98765 43210",
      createdAt: now - 12 * MINUTE,
      deliverBy: now + 3 * DAY,
    }),
  );

  // 2. Created: buyer opened the link, hasn't paid yet.
  const created = add(
    newEntry({
      id: "demo-awaiting1",
      item: "Peri-peri makhana 250 g × 2",
      priceUnits: "6400000",
      method: "hand",
      area: "Saket, Delhi",
      phone: "+91 99110 34567",
      createdAt: now - 3 * HOUR,
      deliverBy: now + 2 * DAY,
    }),
  );
  registerDemoBuyer(store, created, now - 2 * HOUR);

  // 3. Funded: paid with USDT on Tron, needs shipping.
  const toShip = add(
    newEntry({
      id: "demo-to-ship1",
      item: "Himalayan pink salt makhana 500 g",
      note: "Gift wrap please",
      priceUnits: "7500000",
      method: "borzo",
      area: "Gurugram",
      address: "Tower 3, Flat 1104, DLF Phase 2, Gurugram 122002",
      phone: "+91 98111 20987",
      createdAt: now - 2 * HOUR,
      deliverBy: now + 2 * DAY,
    }),
  );
  registerDemoBuyer(store, toShip, now - 100 * MINUTE, "dad-in-gurgaon.near");
  toShip.order.payment = makePayment(tokenBy("USDT", "tron"), toShip.order.priceUnits, "TQ7mDemoRefundAddr1111111111111111", now - 40 * MINUTE);
  toShip.order.payment.originTxHash = randomHex(32);
  fund(toShip, now - 25 * MINUTE);

  // 4. Shipped with Borzo: rider on the way.
  const onWay = add(
    newEntry({
      id: "demo-on-way01",
      item: "Jaggery makhana 200 g × 3",
      priceUnits: "5400000",
      method: "borzo",
      area: "Dwarka, Delhi",
      address: "C-7/214, Sector 6, Dwarka, New Delhi 110075",
      phone: "+91 97170 55123",
      createdAt: now - 5 * HOUR,
      deliverBy: now + 1 * DAY,
    }),
  );
  registerDemoBuyer(store, onWay, now - 4 * HOUR - 50 * MINUTE);
  fund(onWay, now - 4 * HOUR - 30 * MINUTE, tokenBy("USDC", "arb"));
  ship(onWay, now - 50 * MINUTE, { method: "borzo" });
  onWay.order.delivery.courier!.stage = "picked_up";
  onWay.order.delivery.courier!.rawStatus = "parcel_picked_up";
  onWay.order.delivery.courier!.updatedAt = iso(now - 32 * MINUTE);

  // 5. Delivered: protection window running.
  const inWindow = add(
    newEntry({
      id: "demo-window01",
      item: "Mint & lime makhana 250 g",
      priceUnits: "3200000",
      method: "hand",
      area: "Indirapuram",
      phone: "+91 98990 11223",
      createdAt: now - 26 * HOUR,
      deliverBy: now + 1 * DAY,
    }),
  );
  registerDemoBuyer(store, inWindow, now - 25 * HOUR);
  fund(inWindow, now - 24 * HOUR, tokenBy("SOL", "sol"));
  ship(inWindow, now - 40 * MINUTE, { method: "hand" });
  deliver(inWindow, now - 3 * MINUTE, "buyer");

  // 6. Released: the happy path, end to end.
  const paid = add(
    newEntry({
      id: "demo-paid-out1",
      item: "Classic salted makhana 1 kg",
      priceUnits: "9000000",
      method: "tracking",
      area: "Bengaluru",
      address: "No. 18, 4th Cross, Indiranagar, Bengaluru 560038",
      phone: "+91 96320 44871",
      createdAt: now - 4 * DAY,
      deliverBy: now - 1 * DAY + 6 * HOUR,
    }),
  );
  registerDemoBuyer(store, paid, now - 4 * DAY + 20 * MINUTE);
  fund(paid, now - 4 * DAY + 45 * MINUTE, tokenBy("ETH", "base"));
  ship(paid, now - 3 * DAY, { method: "tracking", carrier: "indiapost", trackingNumber: "EE482913065IN" });
  deliver(paid, now - 1 * DAY - 2 * HOUR, "checker");
  release(paid, now - 1 * DAY - 2 * HOUR + COMPLAINT_WINDOW_MS + 30 * SECOND);

  // 7. Disputed: buyer reported a problem inside the window.
  const disputed = add(
    newEntry({
      id: "demo-dispute1",
      item: "Cheese makhana 500 g",
      priceUnits: "7000000",
      method: "tracking",
      area: "Pune",
      address: "Flat 12, Koregaon Park, Pune 411001",
      phone: "+91 98220 76543",
      createdAt: now - 3 * DAY,
      deliverBy: now + 1 * DAY,
    }),
  );
  registerDemoBuyer(store, disputed, now - 3 * DAY + 10 * MINUTE);
  fund(disputed, now - 3 * DAY + 30 * MINUTE);
  ship(disputed, now - 2 * DAY, { method: "tracking", carrier: "delhivery", trackingNumber: "1490821133570" });
  deliver(disputed, now - 2 * HOUR - 6 * MINUTE, "checker");
  disputed.order.status = "Disputed";
  disputed.order.txs.push(tx("complaint", now - 2 * HOUR));

  // 8. Refunded: never delivered by the deadline.
  const refunded = add(
    newEntry({
      id: "demo-refund01",
      item: "Makhana trail mix 400 g",
      priceUnits: "4500000",
      method: "borzo",
      area: "Faridabad",
      address: "House 221, Sector 15, Faridabad 121007",
      phone: "+91 98914 66789",
      createdAt: now - 6 * DAY,
      deliverBy: now - 2 * DAY,
    }),
  );
  registerDemoBuyer(store, refunded, now - 6 * DAY + 15 * MINUTE, "priya-k.near");
  fund(refunded, now - 6 * DAY + 40 * MINUTE, tokenBy("USDC", "near"));
  refund(refunded, now - 2 * DAY + 5 * SECOND);

  // 9. Expired: never paid.
  const expired = add(
    newEntry({
      id: "demo-expired1",
      item: "Caramel makhana 200 g",
      priceUnits: "2800000",
      method: "hand",
      area: "Lajpat Nagar, Delhi",
      phone: "+91 99999 01234",
      createdAt: now - 8 * DAY,
      deliverBy: now - 5 * DAY,
    }),
  );
  expired.order.status = "Expired";
  expired.order.closedAt = iso(now - 5 * DAY);

  return store;
}

// ------------------------------------------------------------------ persistence

let memoryStore: Store | null = null;

function load(): Store {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (s.version === 1 && Array.isArray(s.entries) && Date.now() - s.seededAt < 2 * DAY) return s;
    }
  } catch {
    /* fall through */
  }
  if (memoryStore && Date.now() - memoryStore.seededAt < 2 * DAY) return memoryStore;
  return seed();
}

function save(store: Store) {
  memoryStore = store;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* private mode: keep it in memory */
  }
}

/** Wipes demo data; the next request re-seeds it. */
export function resetMock() {
  memoryStore = null;
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ views

function config(): AppConfig {
  return {
    network: "mainnet",
    escrow: MOCK_ESCROW,
    demoMode: true,
    shopName: SHOP.name,
    complaintWindowMs: COMPLAINT_WINDOW_MS,
    inrPerUsd: INR_PER_USD,
    explorerTxUrl: "https://nearblocks.io/txns/",
    intentsAppUrl: "https://app.near-intents.org",
    webUrl: webUrl(),
  };
}

function publicView(o: SellerOrder) {
  return Order.parse(o);
}

function lastUpdate(o: SellerOrder): number {
  return Math.max(
    ...[o.createdAt, o.fundedAt, o.shippedAt, o.deliveredAt, o.closedAt, o.delivery.courier?.updatedAt, ...o.txs.map((t) => t.at)]
      .filter((x): x is string => !!x)
      .map((x) => Date.parse(x)),
  );
}

function summary(store: Store): SellerSummary {
  const by = (...s: SellerOrder["status"][]) => store.entries.filter((e) => s.includes(e.order.status));
  const sum = (list: Entry[], f: (o: SellerOrder) => string) => list.reduce((acc, e) => acc + BigInt(f(e.order)), 0n).toString();
  const released = sum(by("Released"), (o) => o.priceUnits);
  return {
    heldUnits: sum(by("Funded", "Shipped", "Delivered", "Disputed"), (o) => o.paidUnits),
    releasedUnits: released,
    intentsBalanceUnits: released,
    counts: {
      awaitingPayment: by("Draft", "Created").length,
      toShip: by("Funded").length,
      inTransit: by("Shipped").length,
      inWindow: by("Delivered").length,
      disputed: by("Disputed").length,
      completed: by("Released", "Refunded", "Expired").length,
    },
    intentsAppUrl: "https://app.near-intents.org",
  };
}

function stats(store: Store): Stats {
  const funded = store.entries.filter((e) => e.order.fundedAt);
  return {
    orders: store.entries.filter((e) => e.order.status !== "Draft").length,
    protectedUnits: funded.reduce((a, e) => a + BigInt(e.order.paidUnits), 0n).toString(),
    releasedUnits: store.entries.filter((e) => e.order.status === "Released").reduce((a, e) => a + BigInt(e.order.priceUnits), 0n).toString(),
  };
}

// ------------------------------------------------------------------ routing

interface Ctx {
  store: Store;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  token: string | null;
  now: number;
}
type Handler = (ctx: Ctx) => unknown;
interface Route {
  method: "GET" | "POST";
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  delay: number;
  seller?: boolean;
}

const routes: Route[] = [];
function route(method: Route["method"], path: string, handler: Handler, opts: { delay?: number } = {}) {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" +
      path.replace(/:(\w+)/g, (_, k: string) => {
        keys.push(k);
        return "([^/]+)";
      }) +
      "$",
  );
  routes.push({ method, pattern, keys, handler, delay: opts.delay ?? 220, seller: path.startsWith("/seller/") });
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new MockError(400, "invalid_input", issue?.message ?? "Invalid input", { field: issue?.path.join(".") ?? null });
  }
  return r.data;
}

function entry(ctx: Ctx): Entry {
  const e = ctx.store.entries.find((x) => x.order.id === ctx.params.id);
  if (!e) throw new MockError(404, "not_found", "We couldn't find that order. Check the link and try again.");
  return e;
}

function requireStatus(e: Entry, allowed: SellerOrder["status"][], message: string) {
  if (!allowed.includes(e.order.status)) throw new MockError(409, "invalid_state", message);
}

// meta
route("GET", "/health", () => ({ ok: true }), { delay: 50 });
route("GET", "/config", () => config(), { delay: 120 });
route("GET", "/tokens", () => ({ tokens: MOCK_TOKENS }), { delay: 250 });
route("GET", "/stats", (c) => stats(c.store), { delay: 200 });

// seller
route(
  "POST",
  "/seller/orders",
  (c) => {
    const req = parse(CreateOrderRequest, c.body);
    const deliverBy = Date.parse(req.deliverBy);
    if (deliverBy < c.now + 2 * HOUR) throw new MockError(400, "invalid_input", "Deliver-by must be at least 2 hours from now", { field: "deliverBy" });
    if (deliverBy > c.now + 30 * DAY) throw new MockError(400, "invalid_input", "Deliver-by can be at most 30 days away", { field: "deliverBy" });
    const e = newEntry({
      item: req.item,
      note: req.note || null,
      priceUnits: req.priceUnits,
      method: req.deliveryMethod,
      area: req.deliveryArea || null,
      address: req.deliveryAddress || null,
      phone: req.buyerPhone,
      createdAt: c.now,
      deliverBy,
    });
    c.store.entries.unshift(e);
    return e.order;
  },
  { delay: 500 },
);
route("GET", "/seller/orders", (c) => {
  const filter = c.query.get("status")?.split(",").filter(Boolean);
  const orders = c.store.entries
    .map((e) => e.order)
    .filter((o) => !filter?.length || filter.includes(o.status))
    .sort((a, b) => lastUpdate(b) - lastUpdate(a));
  return { orders };
});
route("GET", "/seller/orders/:id", (c) => entry(c).order);
route("GET", "/seller/summary", (c) => summary(c.store));
route(
  "POST",
  "/seller/orders/:id/ship/quote",
  (c) => {
    parse(ShipQuoteRequest, c.body);
    const e = entry(c);
    requireStatus(e, ["Funded"], "Only paid orders can be shipped.");
    return { provider: "borzo", priceInr: borzoPrice(e.order.id), etaMinutes: 25 + (Number(borzoPrice(e.order.id)) % 30) };
  },
  { delay: 700 },
);
route(
  "POST",
  "/seller/orders/:id/ship",
  (c) => {
    const req = parse(ShipRequest, c.body);
    const e = entry(c);
    requireStatus(e, ["Funded"], "This order can't be shipped right now.");
    if (req.method === "borzo" && !e.order.deliveryAddress) throw new MockError(400, "invalid_input", "Borzo needs a delivery address on the order.");
    ship(e, c.now, req);
    return e.order;
  },
  { delay: 900 },
);
route(
  "POST",
  "/seller/orders/:id/otp/verify",
  (c) => {
    const req = parse(OtpVerifyRequest, c.body);
    const e = entry(c);
    requireStatus(e, ["Funded", "Shipped"], "Delivery can't be confirmed for this order right now.");
    const otp = e.priv.otp;
    if (!otp || otp.expiresAt < c.now) {
      throw new MockError(400, "invalid_input", "There's no active code. Ask the buyer to tap “Show delivery code” on their order page.", { triesLeft: e.priv.otpTriesLeft });
    }
    if (otp.code !== req.code) {
      e.priv.otpTriesLeft -= 1;
      if (e.priv.otpTriesLeft <= 0) {
        e.priv.otp = undefined;
        e.priv.otpTriesLeft = 5;
        throw new MockError(429, "rate_limited", "Too many wrong codes. Ask the buyer to show a new code.", { triesLeft: 0 });
      }
      throw new MockError(400, "invalid_input", "That code doesn't match.", { triesLeft: e.priv.otpTriesLeft });
    }
    deliver(e, c.now, "checker");
    return e.order;
  },
  { delay: 800 },
);

// buyer
route("GET", "/orders/:id", (c) => publicView(entry(c).order), { delay: 160 });
route(
  "POST",
  "/orders/:id/buyer",
  (c) => {
    const req = parse(RegisterBuyerRequest, c.body);
    const e = entry(c);
    if (e.order.status === "Created" && e.order.buyer.publicKey === req.buyerPk) return publicView(e.order);
    requireStatus(e, ["Draft"], "This order was already opened on another device. Use your order pass link to continue there.");
    register(c.store, e, c.now, req.buyerPk, req.refundAccount);
    return publicView(e.order);
  },
  { delay: 700 },
);
route(
  "POST",
  "/orders/:id/quote",
  (c): QuoteResponse => {
    const req = parse(QuoteRequest, c.body);
    const e = entry(c);
    const token = findToken(req.originAsset);
    const q = quoteAmounts(token, e.order.priceUnits);
    if (req.dry) {
      requireStatus(e, ["Draft", "Created"], "This order isn't waiting for payment.");
      return { dry: true, ...q, depositAddress: null, depositMemo: null, deadline: null, order: publicView(e.order) };
    }
    requireStatus(e, ["Created"], e.order.status === "Draft" ? "Register a refund address first." : "This order isn't waiting for payment.");
    const payment = makePayment(token, e.order.priceUnits, req.refundTo, c.now);
    payment.deadline = iso(Math.min(c.now + HOUR, Date.parse(e.order.deliverBy)));
    e.order.payment = payment;
    e.priv.depositSubmittedAt = undefined;
    return {
      dry: false,
      ...q,
      amountIn: payment.amountIn,
      amountInFormatted: payment.amountInFormatted,
      depositAddress: payment.depositAddress,
      depositMemo: payment.depositMemo,
      deadline: payment.deadline,
      order: publicView(e.order),
    };
  },
  { delay: 600 },
);
route(
  "POST",
  "/orders/:id/deposit",
  (c) => {
    const req = parse(DepositSubmitRequest, c.body);
    const e = entry(c);
    if (!e.order.payment) throw new MockError(409, "invalid_state", "Get a deposit address first.");
    if (e.order.status !== "Created") return publicView(e.order);
    e.order.payment.originTxHash = req.txHash.trim();
    e.order.payment.status = "KNOWN_DEPOSIT_TX";
    e.priv.depositSubmittedAt ??= c.now;
    return publicView(e.order);
  },
  { delay: 400 },
);
route(
  "POST",
  "/orders/:id/confirm",
  (c) => {
    const req = parse(SignatureRequest, c.body);
    const e = entry(c);
    requireStatus(e, ["Funded", "Shipped"], e.order.status === "Delivered" ? "Delivery is already confirmed." : "This order can't be confirmed right now.");
    const o = e.order;
    if (!o.buyer.publicKey || !o.chainOrderId || !verifyMessage(o.buyer.publicKey, messages.delivered(o.chainOrderId, o.escrow), req.signature)) {
      throw new MockError(400, "invalid_signature", "This delivery pass doesn't match the order.");
    }
    deliver(e, c.now, "buyer");
    return publicView(o);
  },
  { delay: 900 },
);
route(
  "POST",
  "/orders/:id/complaint",
  (c) => {
    const req = parse(SignatureRequest, c.body);
    const e = entry(c);
    const o = e.order;
    requireStatus(e, ["Delivered"], "A problem can only be reported during the protection window.");
    if (o.complaintEndsAt && Date.parse(o.complaintEndsAt) < c.now) throw new MockError(409, "invalid_state", "The protection window has closed.");
    if (!o.buyer.publicKey || !o.chainOrderId || !verifyMessage(o.buyer.publicKey, messages.complaint(o.chainOrderId, o.escrow), req.signature)) {
      throw new MockError(400, "invalid_signature", "The signature doesn't match this order's buyer key.");
    }
    o.status = "Disputed";
    o.txs.push(tx("complaint", c.now));
    return publicView(o);
  },
  { delay: 900 },
);
route(
  "POST",
  "/orders/:id/otp",
  (c) => {
    const req = parse(OtpRevealRequest, c.body);
    const e = entry(c);
    const o = e.order;
    requireStatus(e, ["Funded", "Shipped"], "A delivery code is only available while the order is on its way.");
    if (Math.abs(c.now / 1000 - req.signedAt) > 300) throw new MockError(400, "invalid_input", "Your device clock looks wrong. Check the time and try again.");
    if (!o.buyer.publicKey || !o.chainOrderId || !verifyMessage(o.buyer.publicKey, messages.otpReveal(o.chainOrderId, o.escrow, req.signedAt), req.signature)) {
      throw new MockError(400, "invalid_signature", "The signature doesn't match this order's buyer key.");
    }
    if (!e.priv.otp || e.priv.otp.expiresAt < c.now + 60 * SECOND) {
      e.priv.otp = { code: randomDigits(6), expiresAt: c.now + 10 * MINUTE };
      e.priv.otpTriesLeft = 5;
    }
    return { code: e.priv.otp.code, expiresAt: iso(e.priv.otp.expiresAt) };
  },
  { delay: 500 },
);

// demo
route(
  "POST",
  "/demo/orders/:id/advance",
  (c) => {
    const e = entry(c);
    const o = e.order;
    switch (o.status) {
      case "Draft": {
        // Like the real API: a buyer key (kept in this browser) plus a real quote.
        registerDemoBuyer(c.store, e, c.now);
        const token = tokenBy("USDC", "base");
        o.payment = makePayment(token, o.priceUnits, demoRefundAddress(token.chain), c.now);
        break;
      }
      case "Created":
        if (o.payment && e.priv.depositSubmittedAt === undefined && o.payment.status === "PENDING_DEPOSIT") {
          o.payment.originTxHash ??= `0x${randomHex(32)}`;
        }
        fund(e, c.now, o.payment ? findToken(o.payment.originAsset) : undefined);
        break;
      case "Funded":
        ship(e, c.now, defaultShipRequest(o));
        break;
      case "Shipped": {
        const courier = o.delivery.courier;
        if (courier && courier.stage !== "picked_up") {
          courier.stage = "picked_up";
          courier.rawStatus = courier.provider === "borzo" ? "parcel_picked_up" : courier.rawStatus;
          courier.updatedAt = iso(c.now);
        } else {
          deliver(e, c.now, "checker");
        }
        break;
      }
      case "Delivered":
        release(e, c.now);
        break;
      case "Disputed":
        throw new MockError(409, "invalid_state", "Disputed orders are decided by the escrow owner.");
      default:
        throw new MockError(409, "invalid_state", "This order is finished — there's nothing left to advance.");
    }
    return publicView(o);
  },
  { delay: 350 },
);

// ------------------------------------------------------------------ transport

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export async function handle(req: TransportRequest): Promise<TransportResponse> {
  const [pathname = "/", search = ""] = req.path.split("?");
  const match = routes
    .filter((r) => r.method === req.method)
    .map((r) => ({ r, m: r.pattern.exec(pathname) }))
    .find((x) => x.m);
  const delay = match ? match.r.delay : 150;
  await sleep(delay * mockSettings.delayScale * (0.85 + Math.random() * 0.3));

  if (!match || !match.m) return { status: 404, body: { error: { code: "not_found", message: `No route for ${req.method} ${pathname}` } } };
  if (match.r.seller && req.token !== MOCK_SELLER_TOKEN) {
    return { status: 401, body: { error: { code: "unauthorized", message: `That seller token isn't right. In the demo it's “${MOCK_SELLER_TOKEN}”.` } } };
  }

  const store = load();
  const now = Date.now();
  for (const e of store.entries) tick(e, now);
  const params: Record<string, string> = {};
  match.r.keys.forEach((k, i) => (params[k] = decodeURIComponent(match.m![i + 1]!)));
  try {
    const body = match.r.handler({ store, params, query: new URLSearchParams(search), body: req.body, token: req.token ?? null, now });
    save(store);
    return { status: 200, body: JSON.parse(JSON.stringify(body)) };
  } catch (err) {
    save(store);
    if (err instanceof MockError) {
      return { status: err.status, body: { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } } };
    }
    console.error("Mock API error", err);
    return { status: 500, body: { error: { code: "internal", message: "Something went wrong in the demo server." } } };
  }
}

export const mockTransport: Transport = { request: handle };
