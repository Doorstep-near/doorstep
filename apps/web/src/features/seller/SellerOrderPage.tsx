import { clsx } from "clsx";
import type { SellerOrder } from "@doorstep/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  Bike,
  CircleExclamationPoint,
  CircleSlash,
  ExternalLink,
  Gavel,
  Hand,
  Hourglass,
  MessageCircle,
  Package,
  PackageCheck,
  Phone,
  QrCode as QrIcon,
  ScanLine,
  Timer,
  Truck,
  Undo2,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useDocumentTitle } from "../../components/layout/Layout";
import { OrderFacts, TxList } from "../../components/order/OrderBits";
import {
  Amount,
  Banner,
  Button,
  ButtonAnchor,
  ButtonLink,
  Card,
  CardHeader,
  CheckAnimation,
  Chip,
  CopyField,
  Countdown,
  DataList,
  Disclosure,
  ErrorState,
  OrderTimeline,
  QrCode,
  Sheet,
  Skeleton,
  StatusChip,
  TokenIcon,
  useNow,
} from "../../components/ui";
import { DemoControls } from "../demo/DemoControls";
import { api, isApiError } from "../../lib/api";
import { chainName } from "../../lib/chains";
import { formatDate, formatDateTime, relativeTime, usdc } from "../../lib/format";
import { qk, useAppSettings } from "../../lib/query";
import { isFinal, sellerCopy } from "../../lib/status";
import { ConfirmDeliverySheet } from "./ConfirmDeliverySheet";
import { ShipPanel } from "./ShipPanel";
import { METHOD_LABEL, PAYMENT_LABEL, carrierLabel, courierStage, whatsappShareUrl } from "./sellerUtils";

export default function SellerOrderPage() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: qk.sellerOrder(id),
    queryFn: () => api.seller.getOrder(id),
    refetchInterval: (query) => (query.state.data && isFinal(query.state.data.status) ? false : 5_000),
  });
  const order = q.data;
  useDocumentTitle(order ? order.item : "Order");

  return (
    <div className="flex flex-col gap-5">
      <Link to="/seller" className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded text-sm font-medium text-text-2 hover:text-text">
        <ArrowLeft aria-hidden className="size-4" /> All orders
      </Link>

      {q.error && !order ? (
        <ErrorState
          error={q.error}
          onRetry={() => q.refetch()}
          title={isApiError(q.error, "not_found") ? "Order not found" : undefined}
          className="py-14"
        />
      ) : !order ? (
        <DetailSkeleton />
      ) : (
        <OrderDetail order={order} />
      )}
      {isApiError(q.error, "not_found") && (
        <div className="flex justify-center">
          <ButtonLink to="/seller" variant="secondary">
            Back to dashboard
          </ButtonLink>
        </div>
      )}

      <DemoControls orderId={id} status={order?.status} />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading order" className="flex flex-col gap-5">
      <div>
        <Skeleton className="h-8 w-2/3 max-w-md" />
        <Skeleton className="mt-2 h-4 w-48" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-[220px] rounded-xl" />
          <Skeleton className="h-[200px] rounded-xl" />
          <Skeleton className="h-[160px] rounded-xl" />
        </div>
        <div className="flex flex-col gap-5">
          <Skeleton className="h-[180px] rounded-xl" />
          <Skeleton className="h-[160px] rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function OrderDetail({ order }: { order: SellerOrder }) {
  const { inrPerUsd, explorerTxUrl } = useAppSettings();
  return (
    <>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-text sm:text-3xl">{order.item}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-3">
            <span className="mono">{order.id}</span>
            <span aria-hidden>·</span>
            <span>Created {relativeTime(order.createdAt)}</span>
            <span aria-hidden>·</span>
            <span>Deliver by {formatDate(order.deliverBy)}</span>
          </p>
        </div>
        <StatusChip status={order.status} audience="seller" className="self-start" />
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <Card padding="none">
            <div className="flex flex-wrap items-end justify-between gap-4 px-5 pt-5 sm:px-6">
              <div>
                <p className="text-xs font-medium text-text-3">Order total</p>
                <Amount units={order.priceUnits} inrPerUsd={inrPerUsd} size="lg" className="mt-1" />
              </div>
              <p className="text-sm text-text-2">
                {METHOD_LABEL[order.delivery.method]}
                {order.delivery.area ? ` · ${order.delivery.area}` : ""}
              </p>
            </div>
            <div className="mt-5 border-t border-border px-5 py-5 sm:px-6">
              <OrderTimeline order={order} />
            </div>
          </Card>

          <NextAction order={order} />

          <Card>
            <CardHeader title="Activity" description="Every step is a NEAR transaction." />
            <TxList order={order} className="mt-4" />
          </Card>

          <Disclosure summary="Technical details">
            <OrderFacts order={order} explorerTxUrl={explorerTxUrl} />
          </Disclosure>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <PayoutPanel order={order} />
          <BuyerPanel order={order} />
          <CourierPanel order={order} />
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ next action

const ACTION_STYLE: Record<string, { icon: LucideIcon; box: string }> = {
  waiting: { icon: Hourglass, box: "bg-waiting-bg text-waiting" },
  ship: { icon: Package, box: "bg-brand-soft text-brand" },
  confirm: { icon: PackageCheck, box: "bg-transit-bg text-transit" },
  window: { icon: Timer, box: "bg-transit-bg text-transit" },
  done: { icon: Wallet, box: "bg-success-bg text-success" },
  dispute: { icon: Gavel, box: "bg-danger-bg text-danger" },
  closed: { icon: CircleSlash, box: "bg-neutral-bg text-neutral" },
  refund: { icon: Undo2, box: "bg-neutral-bg text-neutral" },
};

function ActionCard({ kind, order, children }: { kind: keyof typeof ACTION_STYLE; order: SellerOrder; children: ReactNode }) {
  const copy = sellerCopy(order);
  const s = ACTION_STYLE[kind]!;
  const Icon = s.icon;
  return (
    <Card as="section" aria-labelledby="next-action" raised className="border-border-strong/60">
      <div className="flex items-start gap-3.5">
        <span className={clsx("flex size-10 shrink-0 items-center justify-center rounded-xl", s.box)}>
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0" aria-live="polite">
          <p className="text-xs font-semibold tracking-wide text-text-3 uppercase">Next step</p>
          <h2 id="next-action" className="mt-0.5 text-lg font-semibold text-text">
            {copy.headline}
          </h2>
          <p className="mt-1 text-sm text-text-2">{copy.sub}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </Card>
  );
}

function NextAction({ order }: { order: SellerOrder }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmSheet = <ConfirmDeliverySheet open={confirmOpen} onClose={() => setConfirmOpen(false)} order={order} />;

  switch (order.status) {
    case "Draft":
    case "Created":
      return (
        <ActionCard kind="waiting" order={order}>
          <ShareLink order={order} />
        </ActionCard>
      );
    case "Funded":
      return (
        <ActionCard kind="ship" order={order}>
          <ShipPanel order={order} />
          <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-2">Handing it over in person right now?</p>
            <Button variant="secondary" icon={<ScanLine aria-hidden className="size-4" />} onClick={() => setConfirmOpen(true)}>
              Confirm delivery
            </Button>
          </div>
          {confirmSheet}
        </ActionCard>
      );
    case "Shipped":
      return (
        <ActionCard kind="confirm" order={order}>
          <ul className="mb-4 grid gap-2 text-sm text-text-2 sm:grid-cols-2">
            <li className="flex items-start gap-2 rounded-lg bg-surface-2/60 p-3">
              <QrIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
              Scan the QR on the buyer's phone — the strongest proof
            </li>
            <li className="flex items-start gap-2 rounded-lg bg-surface-2/60 p-3">
              <Phone aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
              Or enter the 6-digit code the buyer reads out
            </li>
          </ul>
          <Button size="lg" block icon={<ScanLine aria-hidden className="size-4" />} onClick={() => setConfirmOpen(true)}>
            Confirm delivery
          </Button>
          {order.delivery.method === "borzo" && <p className="mt-3 text-center text-xs text-text-3">Using Borzo? Delivery is confirmed automatically when the courier finishes.</p>}
          {confirmSheet}
        </ActionCard>
      );
    case "Delivered":
      return (
        <ActionCard kind="window" order={order}>
          <PayoutCountdown order={order} />
        </ActionCard>
      );
    case "Released":
      return (
        <ActionCard kind="done" order={order}>
          <ReleasedBlock order={order} />
        </ActionCard>
      );
    case "Disputed":
      return (
        <ActionCard kind="dispute" order={order}>
          <Banner tone="danger" icon={CircleExclamationPoint} title="What happens now">
            The {usdc(order.paidUnits)} USDC stays locked in the escrow contract. The Doorstep owner reviews the case and releases it to you or refunds the buyer. Keep your proof
            of delivery ready — courier records, photos, chats.
          </Banner>
        </ActionCard>
      );
    case "Refunded":
      return (
        <ActionCard kind="refund" order={order}>
          <p className="text-sm text-text-2">
            {usdc(order.paidUnits || order.priceUnits)} USDC went back to the buyer{order.closedAt ? ` on ${formatDateTime(order.closedAt)}` : ""}. Delivery wasn't proven before{" "}
            {formatDateTime(order.deliverBy)}.
          </p>
        </ActionCard>
      );
    case "Expired":
      return (
        <ActionCard kind="closed" order={order}>
          <p className="text-sm text-text-2">The buyer didn't pay before {formatDateTime(order.deliverBy)}. You can create a new order any time.</p>
          <ButtonLink to="/seller/new" variant="secondary" className="mt-3">
            Create a new order
          </ButtonLink>
        </ActionCard>
      );
  }
}

function ShareLink({ order }: { order: SellerOrder }) {
  const { config, inrPerUsd } = useAppSettings();
  const [qrOpen, setQrOpen] = useState(false);
  const p = order.payment;
  return (
    <div className="flex flex-col gap-4">
      {order.status === "Created" && p && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/50 p-3.5" aria-live="polite">
          <TokenIcon symbol={p.originSymbol} chain={p.originChain} size={34} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text">
              Buyer is paying <span className="tabular">{p.amountInFormatted}</span> {p.originSymbol} on {chainName(p.originChain)}
            </p>
            <p className="text-xs text-text-2">{PAYMENT_LABEL[p.status]}</p>
          </div>
        </div>
      )}
      {order.status === "Created" && !p && <p className="text-sm text-text-2">The buyer has registered a refund address and is choosing how to pay.</p>}
      <CopyField label="Pay link" value={order.payLink} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <ButtonAnchor href={whatsappShareUrl(order, config?.shopName ?? "our shop", inrPerUsd)} target="_blank" icon={<MessageCircle aria-hidden className="size-4" />} className="sm:flex-1">
          Share on WhatsApp
        </ButtonAnchor>
        <Button variant="secondary" icon={<QrIcon aria-hidden className="size-4" />} onClick={() => setQrOpen(true)}>
          Show QR
        </Button>
        <ButtonAnchor href={order.payLink} target="_blank" variant="ghost" iconRight={<ArrowUpRight aria-hidden className="size-4" />}>
          Buyer view
        </ButtonAnchor>
      </div>
      <Sheet open={qrOpen} onClose={() => setQrOpen(false)} title="Scan to pay" description={order.item} size="sm">
        <div className="flex flex-col items-center gap-3 py-2">
          <QrCode value={order.payLink} label={`QR code of the pay link for ${order.item}`} size={220} />
          <p className="tabular text-sm font-semibold text-text">{usdc(order.priceUnits)} USDC</p>
        </div>
      </Sheet>
    </div>
  );
}

function PayoutCountdown({ order }: { order: SellerOrder }) {
  const now = useNow(1000);
  const qc = useQueryClient();
  if (!order.complaintEndsAt || !order.deliveredAt) return null;
  const start = Date.parse(order.deliveredAt);
  const end = Date.parse(order.complaintEndsAt);
  const pct = Math.min(100, Math.max(0, ((now - start) / Math.max(1, end - start)) * 100));
  const over = now >= end;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-text-2">{over ? "Window closed — paying out" : "Payout in"}</p>
        <Countdown
          to={order.complaintEndsAt}
          className="text-3xl font-semibold tracking-tight text-text"
          onExpire={() => void qc.invalidateQueries({ queryKey: qk.sellerOrder(order.id) })}
        />
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Protection window" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className="h-full rounded-full bg-transit transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-text-3">
        Delivered {formatDateTime(order.deliveredAt)} · the contract pays you automatically after {formatDateTime(order.complaintEndsAt)}.
      </p>
    </div>
  );
}

function ReleasedBlock({ order }: { order: SellerOrder }) {
  const { intentsAppUrl, inrPerUsd } = useAppSettings();
  return (
    <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <CheckAnimation size={52} />
        <div>
          <Amount units={order.priceUnits} inrPerUsd={inrPerUsd} size="md" inr="row" />
          <p className="mt-0.5 text-xs text-text-3">
            Paid to <span className="mono">{order.shop.account}</span> inside NEAR Intents{order.closedAt ? ` · ${formatDateTime(order.closedAt)}` : ""}
          </p>
        </div>
      </div>
      <ButtonAnchor href={intentsAppUrl} target="_blank" variant="secondary" iconRight={<ArrowUpRight aria-hidden className="size-4" />}>
        Withdraw
      </ButtonAnchor>
    </div>
  );
}

// ------------------------------------------------------------------ side panels

function PayoutPanel({ order }: { order: SellerOrder }) {
  const { intentsAppUrl } = useAppSettings();
  const status =
    order.status === "Released"
      ? "Paid out"
      : order.status === "Refunded"
        ? "Refunded to buyer"
        : order.status === "Expired"
          ? "No payment"
          : order.status === "Disputed"
            ? "Locked — under review"
            : order.status === "Delivered"
              ? "After the protection window"
              : BigInt(order.paidUnits) > 0n
                ? "Locked in escrow"
                : "Waiting for payment";
  return (
    <Card>
      <CardHeader title="Payout" icon={<Wallet aria-hidden className="size-4" />} />
      <DataList
        className="mt-4"
        items={[
          { label: "Price", value: <span className="tabular">{usdc(order.priceUnits)} USDC</span> },
          { label: "In escrow", value: <span className="tabular">{usdc(order.paidUnits)} USDC</span> },
          { label: "Status", value: status },
          { label: "Paid to", value: "Your NEAR Intents balance" },
          { label: "Shop account", value: order.shop.account, mono: true },
        ]}
      />
      {order.status === "Released" && (
        <a href={intentsAppUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-brand hover:underline">
          Withdraw to any chain <ExternalLink aria-hidden className="size-3.5" />
        </a>
      )}
    </Card>
  );
}

function BuyerPanel({ order }: { order: SellerOrder }) {
  return (
    <Card>
      <CardHeader title="Buyer & delivery" icon={<User aria-hidden className="size-4" />} />
      <DataList
        className="mt-4"
        items={[
          {
            label: "Phone",
            value: order.buyerPhone ? (
              <a href={`tel:${order.buyerPhone.replace(/[^\d+]/g, "")}`} className="tabular text-brand hover:underline">
                {order.buyerPhone}
              </a>
            ) : (
              "—"
            ),
          },
          { label: "Address", value: order.deliveryAddress ? <span className="whitespace-pre-line">{order.deliveryAddress}</span> : <span className="text-text-3">Not given</span> },
          { label: "Area (public)", value: order.delivery.area ?? <span className="text-text-3">—</span> },
          { label: "Deliver by", value: formatDateTime(order.deliverBy) },
          ...(order.buyer.refundAccount ? [{ label: "Refunds go to", value: order.buyer.refundAccount, mono: true }] : []),
        ]}
      />
    </Card>
  );
}

function CourierPanel({ order }: { order: SellerOrder }) {
  const c = order.delivery.courier;
  const MethodIcon = order.delivery.method === "borzo" ? Bike : order.delivery.method === "hand" ? Hand : Truck;
  return (
    <Card>
      <CardHeader
        title="Courier"
        description={METHOD_LABEL[c?.provider ?? order.delivery.method]}
        icon={<MethodIcon aria-hidden className="size-4" />}
        action={c ? <Chip tone={courierStage(c).tone} size="sm">{courierStage(c).label}</Chip> : undefined}
      />
      {!c ? (
        <p className="mt-4 text-sm text-text-3">
          {["Draft", "Created", "Funded"].includes(order.status) ? "Not shipped yet." : "No courier was used for this order."}
        </p>
      ) : (
        <>
          <DataList
            className="mt-4"
            items={[
              ...(c.ref && c.provider !== "hand"
                ? [
                    {
                      label: c.provider === "tracking" ? "Tracking" : "Booking",
                      value: c.provider === "tracking" && c.ref.startsWith("track:") ? `${carrierLabel(c.ref.split(":")[1] ?? "")} · ${c.ref.split(":").slice(2).join(":")}` : c.ref,
                      mono: true,
                    },
                  ]
                : []),
              ...(c.riderName ? [{ label: "Rider", value: c.riderName }] : []),
              ...(c.riderPhone
                ? [
                    {
                      label: "Rider phone",
                      value: (
                        <a href={`tel:${c.riderPhone.replace(/[^\d+]/g, "")}`} className="tabular text-brand hover:underline">
                          {c.riderPhone}
                        </a>
                      ),
                    },
                  ]
                : []),
              ...(c.priceInr ? [{ label: "Courier fee", value: <span className="tabular">₹{c.priceInr}</span> }] : []),
              ...(c.rawStatus ? [{ label: "Provider status", value: c.rawStatus, mono: true }] : []),
              { label: "Updated", value: relativeTime(c.updatedAt) },
            ]}
          />
          {c.trackingUrl && (
            <ButtonAnchor href={c.trackingUrl} target="_blank" variant="secondary" size="sm" block className="mt-4" iconRight={<ExternalLink aria-hidden className="size-3.5" />}>
              Track parcel
            </ButtonAnchor>
          )}
        </>
      )}
    </Card>
  );
}
