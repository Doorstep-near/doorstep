// Status -> words, chip tone and timeline. One source of truth for every screen.
import type { Order, OrderStatus, PaymentStatus, TxKind } from "@doorstep/shared";
import {
  BadgeCheck,
  CircleCheck,
  CircleExclamationPoint,
  CircleSlash,
  Hourglass,
  Link2,
  Package,
  PackageCheck,
  ShieldCheck,
  Timer,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { formatDate, formatDateTime, usdc } from "./format";

export type Tone = "waiting" | "transit" | "success" | "danger" | "neutral";
export type Audience = "buyer" | "seller";

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

export const ORDER_STATUSES: OrderStatus[] = ["Draft", "Created", "Funded", "Shipped", "Delivered", "Disputed", "Released", "Refunded", "Expired"];
export const FINAL_STATUSES: OrderStatus[] = ["Released", "Refunded", "Expired"];
export const isFinal = (s: OrderStatus) => FINAL_STATUSES.includes(s);

const BUYER_META: Record<OrderStatus, StatusMeta> = {
  Draft: { label: "Awaiting payment", tone: "waiting", icon: Hourglass },
  Created: { label: "Awaiting payment", tone: "waiting", icon: Hourglass },
  Funded: { label: "Paid · held safely", tone: "success", icon: ShieldCheck },
  Shipped: { label: "On the way", tone: "transit", icon: Truck },
  Delivered: { label: "Delivered", tone: "success", icon: PackageCheck },
  Disputed: { label: "Problem reported", tone: "danger", icon: CircleExclamationPoint },
  Released: { label: "Complete", tone: "success", icon: CircleCheck },
  Refunded: { label: "Refunded", tone: "neutral", icon: Undo2 },
  Expired: { label: "Expired", tone: "neutral", icon: CircleSlash },
};

const SELLER_META: Record<OrderStatus, StatusMeta> = {
  Draft: { label: "Link not opened", tone: "neutral", icon: Link2 },
  Created: { label: "Awaiting payment", tone: "waiting", icon: Hourglass },
  Funded: { label: "Ready to ship", tone: "waiting", icon: Package },
  Shipped: { label: "On the way", tone: "transit", icon: Truck },
  Delivered: { label: "Payout pending", tone: "transit", icon: Timer },
  Disputed: { label: "Disputed", tone: "danger", icon: CircleExclamationPoint },
  Released: { label: "Paid out", tone: "success", icon: BadgeCheck },
  Refunded: { label: "Refunded", tone: "neutral", icon: Undo2 },
  Expired: { label: "Expired", tone: "neutral", icon: CircleSlash },
};

export function statusMeta(status: OrderStatus, audience: Audience = "buyer"): StatusMeta {
  return (audience === "seller" ? SELLER_META : BUYER_META)[status];
}

export const isHand = (o: Pick<Order, "delivery">) => o.delivery.method === "hand";

export interface StatusCopy {
  headline: string;
  sub: string;
}

/** Plain-language headline for the buyer's order page. */
export function buyerCopy(o: Order): StatusCopy {
  const shop = o.shop.name;
  const amount = `${usdc(o.priceUnits)} USDC`;
  switch (o.status) {
    case "Draft":
    case "Created":
      return { headline: "Waiting for your payment", sub: `Pay to place your order. Your money is held safely until it reaches you.` };
    case "Funded":
      return { headline: "Your payment is held safely", sub: `${shop} is preparing your order. They get paid only after it reaches you.` };
    case "Shipped":
      return isHand(o)
        ? { headline: "Your order is out for delivery", sub: `${shop} has handed it over. When it's in your hands, show your delivery pass or tap “I received it”.` }
        : { headline: "Your order is on its way", sub: `When it's in your hands, show your delivery pass or tap “I received it”.` };
    case "Delivered":
      return {
        headline: "Delivered",
        sub: o.complaintEndsAt
          ? `Something wrong? You can report it until ${formatDateTime(o.complaintEndsAt)}. After that ${shop} gets paid.`
          : `Something wrong? You can report it during the protection window.`,
      };
    case "Disputed":
      return { headline: "Problem reported — under review", sub: `Your ${amount} stays locked while it's reviewed. It goes to you or ${shop} based on the review.` };
    case "Released":
      return { headline: "Order complete", sub: `${shop} has been paid ${amount}. Thanks for paying with Doorstep.` };
    case "Refunded":
      return {
        headline: "You've been refunded",
        sub: o.buyer.refundAccount
          ? `${amount} went back to ${o.buyer.refundAccount} inside NEAR Intents. You can withdraw it to any chain.`
          : `${amount} went back to your refund account inside NEAR Intents.`,
      };
    case "Expired":
      return { headline: "This order expired", sub: `It wasn't paid before ${formatDate(o.deliverBy)}, so no money moved.` };
  }
}

/** Headline for the seller's order detail. */
export function sellerCopy(o: Order): StatusCopy {
  const amount = `${usdc(o.priceUnits)} USDC`;
  switch (o.status) {
    case "Draft":
      return { headline: "Waiting for the buyer", sub: "Share the pay link. Nothing happens on chain until the buyer opens it." };
    case "Created":
      return { headline: "Waiting for payment", sub: "The buyer opened the link. You'll see the payment here the moment it lands." };
    case "Funded":
      return { headline: "Paid — ready to ship", sub: `${amount} is locked in the escrow contract. Ship it; you're paid after delivery is proven.` };
    case "Shipped":
      return { headline: isHand(o) ? "Handed over — confirm at the door" : "On the way — confirm at the door", sub: "Scan the buyer's delivery pass, or enter their 6-digit code, when you hand it over." };
    case "Delivered":
      return { headline: "Delivered — payout after the protection window", sub: "The buyer can report a problem until the window ends. Then the contract pays you." };
    case "Disputed":
      return { headline: "Under review", sub: "The buyer reported a problem. The money stays locked until the dispute is resolved." };
    case "Released":
      return { headline: "Paid out", sub: `${amount} is in your NEAR Intents balance. Withdraw it to any chain.` };
    case "Refunded":
      return { headline: "Refunded to the buyer", sub: "Delivery wasn't proven in time, so the contract returned the money." };
    case "Expired":
      return { headline: "Expired", sub: "The buyer never paid before the deadline. No money moved." };
  }
}

// ------------------------------------------------------------------ timeline

export type StepKey = "paid" | "shipped" | "delivered" | "window" | "payout";
export type StepState = "done" | "current" | "upcoming" | "failed" | "stopped" | "skipped";

export interface TimelineStep {
  key: StepKey;
  label: string;
  state: StepState;
  at: string | null;
  detail?: string;
}

const txAt = (o: Order, kind: TxKind) => o.txs.find((t) => t.kind === kind)?.at ?? null;

export function buildTimeline(o: Order): TimelineStep[] {
  const shippedLabel = isHand(o) ? "Handed over" : "Shipped";
  const steps: TimelineStep[] = [
    { key: "paid", label: "Paid", state: "upcoming", at: o.fundedAt },
    { key: "shipped", label: shippedLabel, state: "upcoming", at: o.shippedAt },
    { key: "delivered", label: "Delivered", state: "upcoming", at: o.deliveredAt },
    { key: "window", label: "Protection window", state: "upcoming", at: null },
    { key: "payout", label: "Paid out", state: "upcoming", at: null },
  ];
  const [paid, shipped, delivered, window, payout] = steps as [TimelineStep, TimelineStep, TimelineStep, TimelineStep, TimelineStep];
  const shippedState = (): StepState => (o.shippedAt ? "done" : "skipped");

  switch (o.status) {
    case "Draft":
    case "Created":
      paid.state = "current";
      paid.detail = "Waiting for payment";
      break;
    case "Funded":
      paid.state = "done";
      shipped.state = "current";
      shipped.detail = isHand(o) ? "Preparing for hand delivery" : "Preparing your order";
      break;
    case "Shipped":
      paid.state = "done";
      shipped.state = "done";
      delivered.state = "current";
      delivered.detail = "Confirm when it's in your hands";
      break;
    case "Delivered":
      paid.state = "done";
      shipped.state = shippedState();
      delivered.state = "done";
      window.state = "current";
      window.detail = o.complaintEndsAt ? `Ends ${formatDateTime(o.complaintEndsAt)}` : undefined;
      break;
    case "Disputed":
      paid.state = "done";
      shipped.state = shippedState();
      delivered.state = "done";
      window.state = "failed";
      window.label = "Problem reported";
      window.at = txAt(o, "complaint");
      payout.state = "current";
      payout.label = "Under review";
      break;
    case "Released": {
      paid.state = "done";
      shipped.state = shippedState();
      delivered.state = "done";
      window.state = "done";
      window.at = o.complaintEndsAt;
      if (txAt(o, "complaint")) {
        window.label = "Problem reviewed";
        window.at = txAt(o, "resolve") ?? o.closedAt;
      }
      payout.state = "done";
      payout.at = o.closedAt;
      break;
    }
    case "Refunded": {
      paid.state = "done";
      payout.label = "Refunded";
      payout.state = "stopped";
      payout.at = o.closedAt;
      if (o.deliveredAt) {
        shipped.state = shippedState();
        delivered.state = "done";
        window.state = "failed";
        window.label = "Problem reported";
        window.at = txAt(o, "complaint");
      } else {
        const stop = o.shippedAt ? delivered : shipped;
        if (o.shippedAt) shipped.state = "done";
        stop.state = "stopped";
        stop.label = "Not delivered in time";
        stop.at = o.deliverBy;
        if (stop === shipped) delivered.state = "skipped";
        window.state = "skipped";
      }
      break;
    }
    case "Expired":
      paid.state = "stopped";
      paid.label = "Not paid in time";
      paid.at = o.closedAt ?? o.deliverBy;
      shipped.state = "skipped";
      delivered.state = "skipped";
      window.state = "skipped";
      payout.state = "skipped";
      payout.label = "No money moved";
      break;
  }
  return steps;
}

// ------------------------------------------------------------------ payment progress (pay page)

export type ProgressState = "done" | "current" | "upcoming";
export interface ProgressStep {
  label: string;
  state: ProgressState;
}

export const PAYMENT_STEPS = ["Waiting for your payment", "Payment seen", "Converting to USDC", "Held safely"] as const;

export function paymentProgress(status: PaymentStatus, orderStatus: OrderStatus): ProgressStep[] {
  const secured = !["Draft", "Created", "Expired"].includes(orderStatus);
  const active = secured ? 4 : status === "SUCCESS" ? 3 : status === "PROCESSING" ? 2 : status === "KNOWN_DEPOSIT_TX" ? 1 : 0;
  return PAYMENT_STEPS.map((label, i) => ({ label, state: i < active ? "done" : i === active ? "current" : "upcoming" }));
}

export const PAYMENT_PROBLEMS: PaymentStatus[] = ["INCOMPLETE_DEPOSIT", "REFUNDED", "FAILED"];

// ------------------------------------------------------------------ transactions

export const TX_LABEL: Record<TxKind, string> = {
  create: "Order placed on NEAR",
  fund: "Payment locked in escrow",
  ship: "Marked as shipped",
  deliver: "Delivery confirmed",
  complaint: "Problem reported",
  resolve: "Dispute resolved",
  release: "Paid out to the shop",
  refund: "Refunded to the buyer",
};

export const TX_METHOD: Record<TxKind, string> = {
  create: "create_order",
  fund: "ft_on_transfer",
  ship: "mark_shipped",
  deliver: "confirm_by_buyer / confirm_by_checker",
  complaint: "raise_complaint",
  resolve: "resolve",
  release: "release",
  refund: "refund",
};

/** Most recent time anything happened to the order. */
export function lastActivity(o: Order): string {
  const times = [o.createdAt, o.fundedAt, o.shippedAt, o.deliveredAt, o.closedAt, o.delivery.courier?.updatedAt, ...o.txs.map((t) => t.at)].filter(
    (x): x is string => !!x,
  );
  return times.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a), o.createdAt);
}
