// Buyer-facing pieces shared by the pay page and the order page.
import { clsx } from "clsx";
import { links, type Order } from "@doorstep/shared";
import { CalendarClock, KeyRound, Lock, MapPin, PackageCheck, Share2, ShieldCheck, Undo2 } from "lucide-react";
import { useState } from "react";
import { Amount, Button, Card, CopyField, Skeleton, SkeletonText } from "../../components/ui";
import { seedToBase64Url, type BuyerKey } from "../../lib/buyerKey";
import { formatDate } from "../../lib/format";

const METHOD_LABEL: Record<Order["delivery"]["method"], string> = {
  hand: "Hand delivery",
  borzo: "Borzo courier",
  tracking: "Tracked post",
};

export function ShopHeader({ name }: { name: string | undefined }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-text-2 ring-1 ring-border">
        {name ? name.replace(/\(.*\)/, "").trim().slice(0, 1).toUpperCase() : ""}
      </span>
      <div className="min-w-0">
        {name ? <p className="truncate text-[15px] font-semibold text-text">{name}</p> : <Skeleton className="h-4 w-28" />}
        <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-brand">
          <ShieldCheck aria-hidden className="size-3.5" strokeWidth={2.5} />
          Protected by Doorstep
        </p>
      </div>
    </div>
  );
}

/** Item, note, the price (hero) and the deliver-by date. */
export function OrderSummaryCard({ order, inrPerUsd, className }: { order: Order; inrPerUsd: number; className?: string }) {
  return (
    <Card className={className}>
      <p className="text-xs font-medium tracking-wide text-text-3 uppercase">Your order</p>
      <h1 className="mt-1 text-lg leading-snug font-semibold text-text">{order.item}</h1>
      {order.note && <p className="mt-2 border-l-2 border-border pl-3 text-sm text-text-2 italic">“{order.note}”</p>}
      <div className="mt-4 flex items-end justify-between gap-4">
        <Amount units={order.priceUnits} inrPerUsd={inrPerUsd} size="xl" />
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-3.5 text-sm text-text-2">
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock aria-hidden className="size-4 text-text-3" />
          Delivered by <span className="font-medium text-text">{formatDate(order.deliverBy)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MapPin aria-hidden className="size-4 text-text-3" />
          {METHOD_LABEL[order.delivery.method]}
          {order.delivery.area ? ` · ${order.delivery.area}` : ""}
        </span>
      </div>
    </Card>
  );
}

export function OrderSummarySkeleton() {
  return (
    <Card>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-2.5 h-5 w-3/4" />
      <Skeleton className="mt-5 h-11 w-40" />
      <Skeleton className="mt-2 h-3.5 w-16" />
      <div className="mt-4 border-t border-border pt-3.5">
        <SkeletonText lines={1} />
      </div>
    </Card>
  );
}

/** Three short lines on why paying is safe. */
export function ProtectionExplainer({ order, className }: { order: Order; className?: string }) {
  const rows = [
    { icon: Lock, text: <>Your payment is held by a smart contract, not by the shop.</> },
    { icon: PackageCheck, text: <>{order.shop.name} is paid only after it reaches your door.</> },
    { icon: Undo2, text: <>Not delivered by {formatDate(order.deliverBy)}? You're refunded automatically.</> },
  ];
  return (
    <ul className={clsx("flex flex-col gap-2.5 rounded-xl bg-brand-soft/70 px-4 py-3.5", className)} aria-label="How you're protected">
      {rows.map((r, i) => (
        <li key={i} className="flex items-start gap-3 text-sm text-text">
          <r.icon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={2.25} />
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Save your order pass": the private backup link that carries the buyer key in its fragment. */
export function OrderPassCard({ orderId, buyerKey, webUrl, emphasis = false, className }: { orderId: string; buyerKey: BuyerKey; webUrl: string; emphasis?: boolean; className?: string }) {
  const url = links.order(webUrl, orderId, seedToBase64Url(buyerKey));
  const masked = `${url.split("#")[0]}#k=••••••••`;
  const [shared, setShared] = useState(false);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  return (
    <Card className={clsx(emphasis && "border-brand/40 ring-1 ring-brand/15", className)}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <KeyRound aria-hidden className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-text">Save your order pass</h2>
          <p className="mt-0.5 text-sm text-text-2">
            This private link lets you confirm delivery or report a problem from any device. Keep it somewhere only you can see — we can't recover it.
          </p>
        </div>
      </div>
      <CopyField className="mt-4" value={url} display={masked} copyLabel="Copy link" />
      {canShare && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          icon={<Share2 aria-hidden className="size-4" />}
          onClick={async () => {
            try {
              await navigator.share({ title: "My Doorstep order pass", text: "Private link for my order. Don't share it with anyone else.", url });
              setShared(true);
            } catch {
              /* cancelled */
            }
          }}
        >
          {shared ? "Shared" : "Save to notes or send to yourself"}
        </Button>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ pay session (form values per order)

export interface PaySession {
  assetId: string | null;
  originAddress: string;
  nearAccount: string;
}

const SESSION_PREFIX = "doorstep:pay:";

export function loadPaySession(orderId: string): PaySession {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + orderId);
    if (raw) return { assetId: null, originAddress: "", nearAccount: "", ...(JSON.parse(raw) as Partial<PaySession>) };
  } catch {
    /* ignore */
  }
  return { assetId: null, originAddress: "", nearAccount: "" };
}

export function savePaySession(orderId: string, s: PaySession) {
  try {
    localStorage.setItem(SESSION_PREFIX + orderId, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
