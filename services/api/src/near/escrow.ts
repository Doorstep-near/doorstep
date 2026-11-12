// The escrow contract as the backend sees it. LiveEscrow talks to NEAR;
// FakeEscrow (demo mode) runs the same state machine in memory.
import { INTENTS_CONTRACT, USDC_NEAR, USDC_NEAR_ASSET } from "@doorstep/shared";
import type { Relayer } from "./relayer";
import type { Viewer } from "./rpc";

export type ChainStatus = "Created" | "Funded" | "Shipped" | "Delivered" | "Disputed" | "Released" | "Refunded" | "Expired";

/** `get_order` exactly as the contract serialises it (u64/u128 as strings). */
export interface ChainOrder {
  id: string;
  seller: string;
  buyer_pk: string;
  buyer_refund: string;
  price: string;
  paid: string;
  deadline_ms: string;
  courier_ref: string | null;
  status: ChainStatus;
  proof: null | "Buyer" | { Checker: { courier_ref: string } };
  created_ms: string;
  funded_ms: string | null;
  delivered_ms: string | null;
  closed_ms: string | null;
}

export interface Unmatched {
  id: string;
  from: string;
  amount: string;
  msg: string;
  order_id: string | null;
  refund_to: string | null;
  reason: string;
  at_ms: string;
}

export interface EscrowConfig {
  owner: string;
  relayer: string;
  usdc: string;
  intents: string;
  checker_pk: string;
  complaint_window_ms: string;
  payout_mode: "Intents" | "Direct";
  next_order_id: string;
  unmatched_count: number;
}

export interface TxResult {
  hash: string;
  /** Decoded JSON return value, if any. */
  value: unknown;
  logs: string[];
}

export interface CreateOrderArgs {
  seller: string;
  price: string;
  deadline_ms: string;
  buyer_pk: string;
  buyer_refund: string;
}

export interface Escrow {
  readonly account: string;
  getOrder(orderId: string): Promise<ChainOrder | null>;
  getConfig(): Promise<EscrowConfig>;
  getUnmatched(): Promise<Unmatched[]>;
  /** storage_balance_of on the USDC contract: without it, 1Click payments are lost. */
  usdcRegistered(): Promise<boolean>;
  /** USDC units credited to `account` inside NEAR Intents. */
  intentsBalance(account: string): Promise<string>;
  createOrder(args: CreateOrderArgs): Promise<TxResult & { orderId: string }>;
  markShipped(orderId: string, courierRef: string): Promise<TxResult>;
  confirmByBuyer(orderId: string, signature: string): Promise<TxResult>;
  confirmByChecker(orderId: string, courierRef: string, signedAt: number, signature: string): Promise<TxResult>;
  raiseComplaint(orderId: string, signature: string): Promise<TxResult>;
  release(orderId: string): Promise<TxResult>;
  refund(orderId: string): Promise<TxResult>;
}

export const GAS_DEFAULT_TGAS = 30;
export const GAS_PAYOUT_TGAS = 100;

/** Reads the order id from create_order's return value, or its order_created event. */
export function orderIdFromResult(r: TxResult): string {
  if (typeof r.value === "string" && /^\d+$/.test(r.value)) return r.value;
  if (typeof r.value === "number") return String(r.value);
  for (const log of r.logs) {
    if (!log.startsWith("EVENT_JSON:")) continue;
    try {
      const ev = JSON.parse(log.slice("EVENT_JSON:".length));
      if (ev.event === "order_created" && ev.data?.[0]?.order_id != null) return String(ev.data[0].order_id);
    } catch {
      /* not our event */
    }
  }
  throw new Error("create_order returned no order id");
}

export class LiveEscrow implements Escrow {
  constructor(
    readonly account: string,
    private view: Viewer,
    private relayer: Relayer,
  ) {}

  getOrder(orderId: string) {
    return this.view<ChainOrder | null>(this.account, "get_order", { order_id: orderId });
  }
  getConfig() {
    return this.view<EscrowConfig>(this.account, "get_config", {});
  }
  async getUnmatched() {
    return (await this.view<Unmatched[]>(this.account, "get_unmatched", { from_index: 0, limit: 100 })) ?? [];
  }
  async usdcRegistered() {
    return (await this.view<unknown>(USDC_NEAR, "storage_balance_of", { account_id: this.account })) != null;
  }
  async intentsBalance(account: string) {
    const v = await this.view<string | null>(INTENTS_CONTRACT, "mt_balance_of", { account_id: account, token_id: USDC_NEAR_ASSET });
    return typeof v === "string" && /^\d+$/.test(v) ? v : "0";
  }

  async createOrder(args: CreateOrderArgs) {
    const r = await this.relayer.call("create_order", { ...args }, GAS_DEFAULT_TGAS);
    return { ...r, orderId: orderIdFromResult(r) };
  }
  markShipped(orderId: string, courierRef: string) {
    return this.relayer.call("mark_shipped", { order_id: orderId, courier_ref: courierRef }, GAS_DEFAULT_TGAS);
  }
  confirmByBuyer(orderId: string, signature: string) {
    return this.relayer.call("confirm_by_buyer", { order_id: orderId, signature }, GAS_DEFAULT_TGAS);
  }
  confirmByChecker(orderId: string, courierRef: string, signedAt: number, signature: string) {
    return this.relayer.call(
      "confirm_by_checker",
      { order_id: orderId, courier_ref: courierRef, signed_at: String(signedAt), signature },
      GAS_DEFAULT_TGAS,
    );
  }
  raiseComplaint(orderId: string, signature: string) {
    return this.relayer.call("raise_complaint", { order_id: orderId, signature }, GAS_DEFAULT_TGAS);
  }
  release(orderId: string) {
    return this.relayer.call("release", { order_id: orderId }, GAS_PAYOUT_TGAS);
  }
  refund(orderId: string) {
    return this.relayer.call("refund", { order_id: orderId }, GAS_PAYOUT_TGAS);
  }
}
