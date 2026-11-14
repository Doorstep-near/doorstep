// The HTTP contract between services/api and apps/web.
//
// Rules:
// - Every response body the web app reads is parsed with these schemas.
// - Every request body the API accepts is validated with these schemas.
// - Amounts are USDC units (6 decimals) as strings: "2000000" = 2 USDC.
// - Times are ISO 8601 strings in UTC.
// - Errors: HTTP 4xx/5xx with body ApiError.
// - Seller routes (/seller/*) need `Authorization: Bearer <SELLER_TOKEN>`.
// - Buyer routes (/orders/:id/*) are public: knowing the random order id is
//   the capability, and every money-moving buyer action carries the buyer's
//   ed25519 signature, which the contract (or API) verifies.
//
// Routes:
//   GET  /health                          -> { ok: true }
//   GET  /config                          -> AppConfig
//   GET  /tokens                          -> TokensResponse
//   GET  /stats                           -> Stats
//
//   POST /seller/orders                   CreateOrderRequest   -> SellerOrder
//   GET  /seller/orders?status=...        -> SellerOrdersResponse
//   GET  /seller/orders/:id               -> SellerOrder
//   GET  /seller/summary                  -> SellerSummary
//   GET  /seller/me                       -> SellerMe (the shop this seller token belongs to)
//   POST /seller/orders/:id/ship/quote    ShipQuoteRequest     -> ShipQuote      (Borzo price, no booking)
//   POST /seller/orders/:id/ship          ShipRequest          -> SellerOrder    (books Borzo / records tracking / hand; calls mark_shipped)
//   POST /seller/orders/:id/otp/verify    OtpVerifyRequest     -> SellerOrder    (checker signs + confirm_by_checker on success)
//
//   GET  /orders/:id                      -> Order          (public view, buyer phone masked)
//   POST /orders/:id/buyer                RegisterBuyerRequest -> Order    (Draft -> Created: relayer calls create_order)
//   POST /orders/:id/quote                QuoteRequest         -> QuoteResponse (dry: preview; real: deposit address)
//   POST /orders/:id/deposit              DepositSubmitRequest -> Order    (tells 1Click the tx hash; optional speed-up)
//   POST /orders/:id/confirm              SignatureRequest     -> Order    (confirm_by_buyer)
//   POST /orders/:id/complaint            SignatureRequest     -> Order    (raise_complaint)
//   POST /orders/:id/otp                  OtpRevealRequest     -> OtpRevealResponse (buyer-signed; returns a fresh 6-digit code)
//
//   POST /webhooks/borzo                  (Borzo callback, X-DV-Signature)
//   POST /webhooks/ship24                 (Ship24 callback, Bearer secret)
//
//   POST /demo/orders/:id/advance         -> Order   (DEMO_MODE only: moves the order one step forward)

import { z } from "zod";

// ------------------------------------------------------------------ primitives

export const UsdcUnits = z.string().regex(/^\d+$/, "USDC amount in 6-decimal units, as a string");
export const IsoTime = z.iso.datetime();
/** Random public order id, e.g. "q7Xr2kP9mWz4". It is also the pay-link id. */
export const PublicOrderId = z.string().regex(/^[A-Za-z0-9_-]{10,40}$/);
/** On-chain order id (u64 as string). */
export const ChainOrderId = z.string().regex(/^\d+$/);
/** NEAR account id, including eth-implicit "0x…" (lowercase) accounts. */
export const NearAccountId = z
  .string()
  .min(2)
  .max(64)
  .regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/, "Not a valid NEAR account id");
export const Ed25519PublicKey = z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
/** Standard base64 of a 64-byte ed25519 signature. */
export const Signature = z.string().regex(/^[A-Za-z0-9+/]{86}==$/, "Expected a base64 ed25519 signature");

// ------------------------------------------------------------------ enums

/** Our order status. "Draft" exists only in our database; the rest mirror the contract. */
export const OrderStatus = z.enum([
  "Draft", // seller made it, buyer hasn't opened the link yet (no on-chain order)
  "Created", // on chain, waiting for payment
  "Funded", // USDC is in the escrow
  "Shipped", // seller handed it to a courier (or recorded a tracking number)
  "Delivered", // buyer or checker proved delivery; complaint window running
  "Disputed", // buyer complained inside the window; owner decides
  "Released", // seller paid inside NEAR Intents (final)
  "Refunded", // buyer refunded inside NEAR Intents (final)
  "Expired", // never paid before the deadline (final)
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const DeliveryMethod = z.enum(["hand", "borzo", "tracking"]);
export type DeliveryMethod = z.infer<typeof DeliveryMethod>;

/** 1Click's status values, plus NONE before any real quote. */
export const PaymentStatus = z.enum([
  "NONE",
  "PENDING_DEPOSIT",
  "KNOWN_DEPOSIT_TX",
  "PROCESSING",
  "SUCCESS",
  "INCOMPLETE_DEPOSIT",
  "REFUNDED",
  "FAILED",
]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

/** Courier progress, normalised across Borzo / tracking / hand delivery. */
export const CourierStage = z.enum(["booked", "picked_up", "delivered", "failed", "canceled"]);
export type CourierStage = z.infer<typeof CourierStage>;

export const TxKind = z.enum(["create", "fund", "ship", "deliver", "complaint", "resolve", "release", "refund"]);
export type TxKind = z.infer<typeof TxKind>;

export const ProofKind = z.enum(["buyer", "checker"]);

// ------------------------------------------------------------------ shared objects

export const Courier = z.object({
  provider: DeliveryMethod,
  /** Stored on chain via mark_shipped, e.g. "borzo:123456", "track:indiapost:EE123456789IN", "hand". */
  ref: z.string().nullable(),
  stage: CourierStage,
  /** Provider's raw status, e.g. Borzo "courier_assigned". For display in details only. */
  rawStatus: z.string().nullable(),
  trackingUrl: z.string().url().nullable(),
  riderName: z.string().nullable(),
  riderPhone: z.string().nullable(),
  /** Borzo price in rupees as a decimal string, when booked. */
  priceInr: z.string().nullable(),
  updatedAt: IsoTime,
});
export type Courier = z.infer<typeof Courier>;

export const Payment = z.object({
  status: PaymentStatus,
  /** 1Click asset id the buyer pays with, e.g. "nep141:base-0x8335…omft.near". */
  originAsset: z.string(),
  originSymbol: z.string(),
  originChain: z.string(),
  /** Exact amount to send, in the origin token's smallest unit and formatted. */
  amountIn: z.string(),
  amountInFormatted: z.string(),
  depositAddress: z.string(),
  depositMemo: z.string().nullable(),
  /** After this the deposit address stops accepting funds. */
  deadline: IsoTime,
  /** Origin-chain address 1Click refunds to if the swap fails. */
  refundTo: z.string(),
  quotedAt: IsoTime,
  originTxHash: z.string().nullable(),
  nearTxHashes: z.array(z.string()),
  /**
   * Set when something needs explaining, e.g. 1Click reports SUCCESS but the
   * escrow parked the money as unmatched (safe; the owner can refund it).
   */
  issue: z.string().nullable().optional(),
});
export type Payment = z.infer<typeof Payment>;

export const TxRecord = z.object({
  kind: TxKind,
  hash: z.string(),
  at: IsoTime,
  /** Ready-made explorer link (demo mode returns "#demo"). */
  url: z.string(),
});
export type TxRecord = z.infer<typeof TxRecord>;

/** Public order view (GET /orders/:id). Safe to show to anyone holding the link. */
export const Order = z.object({
  id: PublicOrderId,
  chainOrderId: ChainOrderId.nullable(),
  status: OrderStatus,
  item: z.string(),
  note: z.string().nullable(),
  priceUnits: UsdcUnits,
  paidUnits: UsdcUnits,
  shop: z.object({ name: z.string(), account: NearAccountId }),
  escrow: NearAccountId,
  delivery: z.object({
    method: DeliveryMethod,
    /** City or area only in the public view, e.g. "Noida". */
    area: z.string().nullable(),
    courier: Courier.nullable(),
  }),
  buyer: z.object({
    /** e.g. "+91 98•••••210" */
    phoneMasked: z.string().nullable(),
    refundAccount: NearAccountId.nullable(),
    publicKey: Ed25519PublicKey.nullable(),
  }),
  /** Contract deadline: not delivered by then -> refundable. */
  deliverBy: IsoTime,
  createdAt: IsoTime,
  fundedAt: IsoTime.nullable(),
  shippedAt: IsoTime.nullable(),
  deliveredAt: IsoTime.nullable(),
  /** deliveredAt + complaint window; release is allowed after this. */
  complaintEndsAt: IsoTime.nullable(),
  closedAt: IsoTime.nullable(),
  proof: ProofKind.nullable(),
  payment: Payment.nullable(),
  txs: z.array(TxRecord),
  demo: z.boolean(),
});
export type Order = z.infer<typeof Order>;

/** Seller's view adds private fields. */
export const SellerOrder = Order.extend({
  buyerPhone: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  payLink: z.string().url(),
});
export type SellerOrder = z.infer<typeof SellerOrder>;

// ------------------------------------------------------------------ meta

export const AppConfig = z.object({
  network: z.enum(["mainnet", "testnet"]),
  escrow: NearAccountId,
  demoMode: z.boolean(),
  shopName: z.string(),
  complaintWindowMs: z.number().int().positive(),
  /** For rupee estimates next to USDC amounts (display only). */
  inrPerUsd: z.number().positive(),
  explorerTxUrl: z.string().url(),
  intentsAppUrl: z.string().url(),
  /** Base URL of the web app, no trailing slash (used to build pay links). */
  webUrl: z.string().url(),
});
export type AppConfig = z.infer<typeof AppConfig>;

export const Token = z.object({
  assetId: z.string(),
  symbol: z.string(),
  /** 1Click blockchain name, e.g. "base", "arb", "eth", "sol", "tron", "btc", "near". */
  chain: z.string(),
  decimals: z.number().int().nonnegative(),
  priceUsd: z.number().nullable(),
  /** Shown first in the picker (USDC/USDT on major chains, ETH, SOL, BTC, NEAR). */
  popular: z.boolean(),
});
export type Token = z.infer<typeof Token>;
export const TokensResponse = z.object({ tokens: z.array(Token) });
export type TokensResponse = z.infer<typeof TokensResponse>;

export const Stats = z.object({
  orders: z.number().int().nonnegative(),
  protectedUnits: UsdcUnits,
  releasedUnits: UsdcUnits,
});
export type Stats = z.infer<typeof Stats>;

export const ApiError = z.object({
  error: z.object({
    code: z.enum([
      "invalid_input",
      "unauthorized",
      "not_found",
      "invalid_state",
      "invalid_signature",
      "rate_limited",
      "chain_error",
      "oneclick_error",
      "courier_error",
      "internal",
    ]),
    message: z.string(),
    /** e.g. { triesLeft: 3 } for a wrong delivery code. */
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

// ------------------------------------------------------------------ seller requests

export const CreateOrderRequest = z
  .object({
    item: z.string().trim().min(1).max(120),
    note: z.string().trim().max(500).optional(),
    priceUnits: UsdcUnits.refine((u) => BigInt(u) >= 100_000n, "Minimum price is 0.10 USDC"),
    buyerPhone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a phone number"),
    deliveryMethod: DeliveryMethod,
    /** Full address; required for Borzo. */
    deliveryAddress: z.string().trim().max(300).optional(),
    /** City/area shown publicly, e.g. "Noida". */
    deliveryArea: z.string().trim().max(60).optional(),
    /** Must be at least 2 hours and at most 30 days from now. */
    deliverBy: IsoTime,
  })
  .refine((r) => r.deliveryMethod !== "borzo" || !!r.deliveryAddress, {
    message: "Borzo delivery needs an address",
    path: ["deliveryAddress"],
  });
export type CreateOrderRequest = z.infer<typeof CreateOrderRequest>;

export const SellerOrdersResponse = z.object({ orders: z.array(SellerOrder) });
export type SellerOrdersResponse = z.infer<typeof SellerOrdersResponse>;

/** The shop a seller token belongs to. Each shop sees only its own orders. */
export const SellerMe = z.object({ id: z.string(), name: z.string(), account: NearAccountId });
export type SellerMe = z.infer<typeof SellerMe>;

export const SellerSummary = z.object({
  /** USDC currently held in escrow for this shop (Funded + Shipped + Delivered + Disputed). */
  heldUnits: UsdcUnits,
  /** All-time released to the shop. */
  releasedUnits: UsdcUnits,
  /** Shop's USDC balance inside NEAR Intents right now (withdrawable). */
  intentsBalanceUnits: UsdcUnits,
  counts: z.object({
    awaitingPayment: z.number().int(), // Draft + Created
    toShip: z.number().int(), // Funded
    inTransit: z.number().int(), // Shipped
    inWindow: z.number().int(), // Delivered
    disputed: z.number().int(),
    completed: z.number().int(), // Released + Refunded + Expired
  }),
  intentsAppUrl: z.string().url(),
});
export type SellerSummary = z.infer<typeof SellerSummary>;

export const ShipQuoteRequest = z.object({ method: z.literal("borzo") });
export type ShipQuoteRequest = z.infer<typeof ShipQuoteRequest>;
export const ShipQuote = z.object({
  provider: z.literal("borzo"),
  priceInr: z.string(),
  etaMinutes: z.number().int().nullable(),
});
export type ShipQuote = z.infer<typeof ShipQuote>;

export const ShipRequest = z.discriminatedUnion("method", [
  z.object({ method: z.literal("borzo") }),
  z.object({
    method: z.literal("tracking"),
    carrier: z.string().trim().min(2).max(40), // e.g. "indiapost", "delhivery"
    trackingNumber: z.string().trim().min(4).max(60),
  }),
  z.object({ method: z.literal("hand") }),
]);
export type ShipRequest = z.infer<typeof ShipRequest>;

export const OtpVerifyRequest = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") });
export type OtpVerifyRequest = z.infer<typeof OtpVerifyRequest>;

// ------------------------------------------------------------------ buyer requests

export const RegisterBuyerRequest = z.object({
  /** Generated in the buyer's browser; the private key never leaves it. */
  buyerPk: Ed25519PublicKey,
  /** NEAR account credited inside NEAR Intents if the order is refunded. For EVM payers, their 0x address in lowercase. */
  refundAccount: NearAccountId,
});
export type RegisterBuyerRequest = z.infer<typeof RegisterBuyerRequest>;

export const QuoteRequest = z.object({
  originAsset: z.string().min(3),
  /** Origin-chain address for 1Click refunds (e.g. the buyer's 0x address on Base, or a NEAR account such as "bob.near"). */
  refundTo: z.string().min(2).max(120),
  /** true: preview price only (allowed in Draft and Created). false: real quote with a deposit address (Created only, after safety checks). */
  dry: z.boolean(),
});
export type QuoteRequest = z.infer<typeof QuoteRequest>;

export const QuoteResponse = z.object({
  dry: z.boolean(),
  amountIn: z.string(),
  amountInFormatted: z.string(),
  minAmountIn: z.string(),
  amountOutFormatted: z.string(),
  timeEstimateSec: z.number().nullable(),
  /** Present when dry=false. */
  depositAddress: z.string().nullable(),
  depositMemo: z.string().nullable(),
  deadline: IsoTime.nullable(),
  /** The updated order (payment filled in when dry=false). */
  order: Order,
});
export type QuoteResponse = z.infer<typeof QuoteResponse>;

export const DepositSubmitRequest = z.object({ txHash: z.string().min(8).max(200) });
export type DepositSubmitRequest = z.infer<typeof DepositSubmitRequest>;

export const SignatureRequest = z.object({ signature: Signature });
export type SignatureRequest = z.infer<typeof SignatureRequest>;

export const OtpRevealRequest = z.object({
  /** Unix seconds; must be within 5 minutes of the server clock. */
  signedAt: z.number().int().positive(),
  /** Buyer's signature over messages.otpReveal(chainOrderId, escrow, signedAt). */
  signature: Signature,
});
export type OtpRevealRequest = z.infer<typeof OtpRevealRequest>;

export const OtpRevealResponse = z.object({
  code: z.string().regex(/^\d{6}$/),
  expiresAt: IsoTime,
});
export type OtpRevealResponse = z.infer<typeof OtpRevealResponse>;
