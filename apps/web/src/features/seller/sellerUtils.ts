// Seller-side helpers: share links, filters, delivery-pass parsing, 401 handling.
import { Signature, base64UrlToBase64, inrEstimate, type Courier, type DeliveryMethod, type Order, type OrderStatus, type PaymentStatus } from "@doorstep/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { useToast } from "../../components/ui";
import { isApiError, sellerToken } from "../../lib/api";
import { usdc } from "../../lib/format";
import type { Tone } from "../../lib/status";

// ------------------------------------------------------------------ sharing

export function whatsappShareUrl(o: { item: string; priceUnits: string; payLink: string }, shopName: string, inrPerUsd?: number): string {
  const rupees = inrPerUsd ? ` (≈ ${inrEstimate(o.priceUnits, inrPerUsd)})` : "";
  const text =
    `Hi! Here's your payment link for ${o.item} from ${shopName} — ${usdc(o.priceUnits)} USDC${rupees}.\n\n` +
    `Pay with any crypto from any chain. Doorstep holds the money safely and only releases it to us once it reaches your door:\n${o.payLink}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// ------------------------------------------------------------------ filters

export type OrderFilter = "all" | "action" | "transit" | "completed";

export const FILTERS: { key: OrderFilter; label: string; statuses: OrderStatus[] | null }[] = [
  { key: "all", label: "All", statuses: null },
  { key: "action", label: "Needs action", statuses: ["Funded", "Disputed"] },
  { key: "transit", label: "In transit", statuses: ["Shipped"] },
  { key: "completed", label: "Completed", statuses: ["Released", "Refunded", "Expired"] },
];

export function matchesFilter(o: Order, f: OrderFilter): boolean {
  const statuses = FILTERS.find((x) => x.key === f)?.statuses;
  return !statuses || statuses.includes(o.status);
}

export function matchesSearch(o: Order & { buyerPhone?: string | null }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  if (o.item.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)) return true;
  if (o.delivery.area?.toLowerCase().includes(q)) return true;
  if (digits.length >= 3 && (o.buyerPhone ?? "").replace(/\D/g, "").includes(digits)) return true;
  return (o.buyer.phoneMasked ?? "").toLowerCase().includes(q);
}

// ------------------------------------------------------------------ delivery pass

export type ParsedPass = { ok: true; id: string; signature: string } | { ok: false; error: string };

/** Reads a delivery-pass link (".../confirm/<id>#sig=<base64url>") from a QR scan or a paste. */
export function parseDeliveryPass(raw: string, expectedId?: string): ParsedPass {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Paste the link from the buyer's delivery pass." };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "That isn't a Doorstep delivery pass link." };
  }
  const m = url.pathname.match(/\/confirm\/([A-Za-z0-9_-]{10,40})\/?$/);
  const sig = new URLSearchParams(url.hash.replace(/^#/, "")).get("sig");
  if (!m || !sig) return { ok: false, error: "That isn't a Doorstep delivery pass link." };
  const signature = base64UrlToBase64(sig);
  if (!Signature.safeParse(signature).success) return { ok: false, error: "The delivery pass looks damaged. Ask the buyer to show it again." };
  if (expectedId && m[1] !== expectedId) return { ok: false, error: "This delivery pass is for a different order." };
  return { ok: true, id: m[1]!, signature };
}

// ------------------------------------------------------------------ labels

export const METHOD_LABEL: Record<DeliveryMethod, string> = {
  hand: "Hand delivery",
  borzo: "Borzo courier",
  tracking: "Tracked parcel",
};

export function courierStage(c: Courier): { label: string; tone: Tone } {
  switch (c.stage) {
    case "booked":
      return { label: c.provider === "borzo" ? "Courier booked" : "Awaiting pickup", tone: "transit" };
    case "picked_up":
      return { label: c.provider === "hand" ? "Out for delivery" : "Picked up", tone: "transit" };
    case "delivered":
      return { label: "Delivered", tone: "success" };
    case "failed":
      return { label: "Delivery failed", tone: "danger" };
    case "canceled":
      return { label: "Canceled", tone: "neutral" };
  }
}

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  NONE: "Not started",
  PENDING_DEPOSIT: "Waiting for the buyer's deposit",
  KNOWN_DEPOSIT_TX: "Deposit sent — confirming",
  PROCESSING: "Converting to USDC",
  SUCCESS: "Received",
  INCOMPLETE_DEPOSIT: "Deposit too small — buyer will be refunded",
  REFUNDED: "Conversion refunded to the buyer",
  FAILED: "Conversion failed",
};

export const CARRIERS: { value: string; label: string }[] = [
  { value: "indiapost", label: "India Post" },
  { value: "delhivery", label: "Delhivery" },
  { value: "bluedart", label: "Blue Dart" },
  { value: "dtdc", label: "DTDC" },
  { value: "ekart", label: "Ekart" },
  { value: "xpressbees", label: "Xpressbees" },
  { value: "other", label: "Other carrier" },
];

export const carrierLabel = (v: string) => CARRIERS.find((c) => c.value === v)?.label ?? v;

// ------------------------------------------------------------------ auth

/** Safe post-login redirect: only paths inside the seller app. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/seller") && !next.startsWith("/seller/login") ? next : "/seller";
}

/** Any seller request that comes back 401 signs the seller out and sends them to the login page. */
export function useUnauthorizedRedirect() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const locRef = useRef(location);
  locRef.current = location;
  const firing = useRef(false);

  useEffect(() => {
    const handle = (err: unknown) => {
      if (!isApiError(err, "unauthorized") || firing.current) return;
      firing.current = true;
      sellerToken.clear();
      qc.removeQueries({ queryKey: ["seller"] });
      toast({ title: "Please sign in again", description: "Your seller session isn't valid any more.", tone: "info" });
      const next = locRef.current.pathname + locRef.current.search;
      navigate(`/seller/login?next=${encodeURIComponent(next)}`, { replace: true });
      setTimeout(() => (firing.current = false), 500);
    };
    const unsubQ = qc.getQueryCache().subscribe((e) => {
      if (e.type === "updated" && e.action.type === "error") handle(e.action.error);
    });
    const unsubM = qc.getMutationCache().subscribe((e) => {
      if (e.type === "updated" && e.action.type === "error") handle(e.action.error);
    });
    return () => {
      unsubQ();
      unsubM();
    };
  }, [qc, navigate, toast]);
}
