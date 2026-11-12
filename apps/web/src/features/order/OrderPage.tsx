import { clsx } from "clsx";
import { links, messages, type Order, type OtpRevealResponse } from "@doorstep/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, Hash, KeyRound, MessageCircleWarning, PackageCheck, Phone, QrCode as QrIcon, RefreshCw, Truck, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { BuyerLayout, useDocumentTitle } from "../../components/layout/Layout";
import { OrderFacts, TxList } from "../../components/order/OrderBits";
import {
  Amount,
  Banner,
  Button,
  ButtonAnchor,
  ButtonLink,
  Card,
  CheckAnimation,
  ConfirmDialog,
  Countdown,
  DataList,
  Disclosure,
  ErrorState,
  OrderTimeline,
  QrCode,
  Sheet,
  Skeleton,
  SkeletonText,
  StatusChip,
  useNow,
  useToast,
} from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { importKeyFromHash, loadKey, signMessage, type BuyerKey } from "../../lib/buyerKey";
import { chainName } from "../../lib/chains";
import { formatDateTime, groupCode, usdc } from "../../lib/format";
import { qk, useAppSettings, useOrder } from "../../lib/query";
import { buyerCopy, isFinal } from "../../lib/status";
import { DemoControls } from "../demo/DemoControls";
import { OrderPassCard, ShopHeader } from "../pay/parts";

export function formatWindow(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}-minute`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}-hour`;
  return `${Math.round(h / 24)}-day`;
}

const COURIER_LABEL = { hand: "Hand delivery", borzo: "Borzo courier", tracking: "Tracked post" } as const;
const STAGE_LABEL = { booked: "Booked", picked_up: "Picked up", delivered: "Delivered", failed: "Delivery failed", canceled: "Cancelled" } as const;

function OrderSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading order">
      <Card>
        <Skeleton className="h-7 w-32 rounded-full" />
        <Skeleton className="mt-4 h-7 w-3/4" />
        <SkeletonText lines={2} className="mt-3" />
        <Skeleton className="mt-5 h-8 w-36" />
      </Card>
      <Card>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-2.5">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </Card>
    </div>
  );
}

function CourierCard({ order }: { order: Order }) {
  const c = order.delivery.courier;
  if (!c) return null;
  const isHand = c.provider === "hand";
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-transit-bg text-transit">
          <Truck aria-hidden className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-text">{COURIER_LABEL[c.provider]}</h2>
          <p className="mt-0.5 text-sm text-text-2">
            {isHand ? `${order.shop.name} is delivering it by hand.` : STAGE_LABEL[c.stage]}
            {!isHand && ` · updated ${formatDateTime(c.updatedAt)}`}
          </p>
        </div>
      </div>
      {(c.riderName || c.trackingUrl || (c.ref && c.provider === "tracking")) && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
          {c.riderName && (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-text-3">Rider</p>
                <p className="text-sm font-medium text-text">{c.riderName}</p>
              </div>
              {c.riderPhone && (
                <ButtonAnchor href={`tel:${c.riderPhone.replace(/\s/g, "")}`} variant="secondary" size="sm" icon={<Phone aria-hidden className="size-4" />}>
                  Call
                </ButtonAnchor>
              )}
            </div>
          )}
          {c.provider === "tracking" && c.ref && (
            <div>
              <p className="text-xs text-text-3">Tracking number</p>
              <p className="mono text-text">{c.ref.split(":").slice(2).join(":") || c.ref}</p>
            </div>
          )}
          {c.trackingUrl && (
            <ButtonAnchor href={c.trackingUrl} target="_blank" variant="secondary" block iconRight={<ExternalLink aria-hidden className="size-4" />}>
              Track parcel
            </ButtonAnchor>
          )}
        </div>
      )}
    </Card>
  );
}

function Receipt({ order }: { order: Order }) {
  const p = order.payment;
  const items = [
    { label: "Item", value: order.item },
    { label: "Price", value: <span className="tabular">{usdc(order.priceUnits)} USDC</span> },
  ];
  if (p && order.fundedAt) items.push({ label: "Paid with", value: <span className="tabular">{`${p.amountInFormatted} ${p.originSymbol} on ${chainName(p.originChain)}`}</span> });
  if (order.fundedAt) items.push({ label: "Paid", value: formatDateTime(order.fundedAt) });
  if (order.deliveredAt) items.push({ label: "Delivered", value: `${formatDateTime(order.deliveredAt)} · ${order.proof === "buyer" ? "confirmed by you" : "confirmed by courier/code"}` });
  if (order.closedAt && order.status === "Released") items.push({ label: "Shop paid", value: formatDateTime(order.closedAt) });
  if (order.closedAt && order.status === "Refunded") items.push({ label: "Refunded", value: formatDateTime(order.closedAt) });
  return (
    <Card>
      <h2 className="mb-3 text-[15px] font-semibold text-text">Receipt</h2>
      <DataList items={items} />
      <Link to={`/proof/${order.id}`} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand underline-offset-2 hover:underline">
        See the on-chain proof <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </Card>
  );
}

function DeliveryActions({ order, buyerKey, windowLabel, webUrl, onOrder }: { order: Order; buyerKey: BuyerKey; windowLabel: string; webUrl: string; onOrder: (o: Order) => void }) {
  const { toast } = useToast();
  const [passOpen, setPassOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const chainId = order.chainOrderId!;

  const passUrl = useMemo(() => (passOpen ? links.confirm(webUrl, order.id, signMessage(buyerKey, messages.delivered(chainId, order.escrow))) : ""), [passOpen, webUrl, order.id, order.escrow, buyerKey, chainId]);

  const confirm = useMutation({
    mutationFn: () => api.orders.confirm(order.id, { signature: signMessage(buyerKey, messages.delivered(chainId, order.escrow)) }),
    onSuccess: (o) => {
      setConfirmOpen(false);
      onOrder(o);
      toast({ title: "Delivery confirmed", description: `The ${windowLabel} protection window has started.` });
    },
  });

  const otp = useMutation({
    mutationFn: (): Promise<OtpRevealResponse> => {
      const signedAt = Math.floor(Date.now() / 1000);
      return api.orders.revealOtp(order.id, { signedAt, signature: signMessage(buyerKey, messages.otpReveal(chainId, order.escrow, signedAt)) });
    },
  });

  const openCode = () => {
    setPassOpen(false);
    setCodeOpen(true);
    otp.mutate();
  };

  return (
    <Card>
      <h2 className="text-[15px] font-semibold text-text">When your order arrives</h2>
      <p className="mt-0.5 text-sm text-text-2">Use one of these only once the parcel is in your hands.</p>
      <div className="mt-4 flex flex-col gap-2">
        <Button size="lg" block icon={<QrIcon aria-hidden className="size-[18px]" />} onClick={() => setPassOpen(true)}>
          Show delivery pass
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" icon={<PackageCheck aria-hidden className="size-4" />} onClick={() => setConfirmOpen(true)}>
            I received it
          </Button>
          <Button variant="secondary" icon={<Hash aria-hidden className="size-4" />} onClick={openCode}>
            Delivery code
          </Button>
        </div>
      </div>
      <p className="mt-3 text-xs text-text-3">Confirming starts a {windowLabel} protection window. {order.shop.name} is paid after it ends.</p>

      <Sheet open={passOpen} onClose={() => setPassOpen(false)} title="Your delivery pass" size="sm">
        <Banner tone="warning" title="Only show this when the parcel is in your hands">
          Scanning it confirms delivery on chain.
        </Banner>
        <div className="mt-5 flex flex-col items-center">
          {passUrl && <QrCode value={passUrl} label="Delivery pass QR code" size={232} />}
          <p className="mt-3 max-w-[280px] text-center text-sm text-text-2">
            The shop or courier scans this with their phone camera. {order.shop.name} is paid after the {windowLabel} protection window.
          </p>
        </div>
        <Button variant="ghost" block className="mt-3" onClick={openCode}>
          Can't scan? Show a 6-digit code instead
        </Button>
      </Sheet>

      <Sheet open={codeOpen} onClose={() => setCodeOpen(false)} title="Your delivery code" size="sm">
        {otp.isPending ? (
          <div className="flex flex-col items-center py-6">
            <Skeleton className="h-14 w-48" />
            <Skeleton className="mt-3 h-4 w-32" />
          </div>
        ) : otp.isError ? (
          <Banner tone="danger" title="Couldn't get a code" action={<Button size="sm" variant="secondary" onClick={() => otp.mutate()}>Try again</Button>}>
            {errorMessage(otp.error)}
          </Banner>
        ) : otp.data ? (
          <OtpDisplay code={otp.data.code} expiresAt={otp.data.expiresAt} onRefresh={() => otp.mutate()} />
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => confirm.mutate()}
        loading={confirm.isPending}
        title="Confirm you have your order?"
        confirmLabel="Yes, I have it"
        error={confirm.isError ? <Banner tone="danger">{errorMessage(confirm.error)}</Banner> : null}
      >
        This tells the escrow contract your order arrived. {order.shop.name} is paid after a {windowLabel} protection window — you can still report a problem until then.
      </ConfirmDialog>
    </Card>
  );
}

function OtpDisplay({ code, expiresAt, onRefresh }: { code: string; expiresAt: string; onRefresh: () => void }) {
  const now = useNow(1000);
  const expired = Date.parse(expiresAt) <= now;
  return (
    <div className="flex flex-col items-center text-center">
      <p className={clsx("mono rounded-xl bg-surface-2 px-6 py-4 text-[40px] leading-none font-semibold tracking-[0.12em] text-text tabular", expired && "line-through opacity-50")} aria-label={`Delivery code ${code.split("").join(" ")}`}>
        {groupCode(code)}
      </p>
      <p className="mt-3 text-sm text-text-2">
        {expired ? (
          "This code has expired."
        ) : (
          <>
            Expires in <Countdown to={expiresAt} className="font-medium text-text" />
          </>
        )}
      </p>
      <p className="mt-4 max-w-[300px] text-sm text-text-2">Read it to the courier or shop only when the parcel is in your hands. It confirms delivery like your QR pass.</p>
      <Button variant={expired ? "primary" : "ghost"} size="sm" className="mt-3" icon={<RefreshCw aria-hidden className="size-4" />} onClick={onRefresh}>
        Get a new code
      </Button>
    </div>
  );
}

function ProtectionWindow({ order, buyerKey, onOrder }: { order: Order; buyerKey: BuyerKey | null; onOrder: (o: Order) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const now = useNow(1000);
  const ends = order.complaintEndsAt;
  const closed = ends ? Date.parse(ends) <= now : false;
  const complain = useMutation({
    mutationFn: () => api.orders.complaint(order.id, { signature: signMessage(buyerKey!, messages.complaint(order.chainOrderId!, order.escrow)) }),
    onSuccess: (o) => {
      setOpen(false);
      onOrder(o);
      toast({ title: "Problem reported", description: "Your money stays locked while it's reviewed.", tone: "info" });
    },
  });
  return (
    <Card>
      <h2 className="text-[15px] font-semibold text-text">Protection window</h2>
      {ends && !closed ? (
        <>
          <p className="mt-2 flex items-baseline gap-2">
            <Countdown to={ends} className="text-3xl font-semibold tracking-tight text-text" />
            <span className="text-sm text-text-3">left</span>
          </p>
          <p className="mt-2 text-sm text-text-2">Something wrong with your order? Report it before the window closes and the money stays locked until it's resolved.</p>
          {buyerKey ? (
            <Button variant="danger-soft" block className="mt-4" icon={<MessageCircleWarning aria-hidden className="size-4" />} onClick={() => setOpen(true)}>
              Report a problem
            </Button>
          ) : (
            <p className="mt-3 text-sm text-text-3">To report a problem, open your order pass link on this device.</p>
          )}
        </>
      ) : (
        <p className="mt-1 text-sm text-text-2">The window has closed. The payout to {order.shop.name} is on its way.</p>
      )}
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => complain.mutate()}
        loading={complain.isPending}
        variant="danger"
        title="Report a problem?"
        confirmLabel="Report problem"
        error={complain.isError ? <Banner tone="danger">{errorMessage(complain.error)}</Banner> : null}
      >
        Your {usdc(order.priceUnits)} USDC stays locked and the order goes to review. Use this if the parcel didn't arrive, is damaged, or isn't what you ordered. It's worth contacting {order.shop.name} too — most issues are solved quickly.
      </ConfirmDialog>
    </Card>
  );
}

function OutcomeCard({ order, intentsAppUrl }: { order: Order; intentsAppUrl: string }) {
  if (order.status === "Released") {
    return (
      <Card className="flex items-center gap-4">
        <CheckAnimation size={48} still />
        <div>
          <h2 className="text-[15px] font-semibold text-text">All done</h2>
          <p className="text-sm text-text-2">Delivery was proven and {order.shop.name} has been paid.</p>
        </div>
      </Card>
    );
  }
  if (order.status === "Refunded") {
    return (
      <Card>
        <h2 className="text-[15px] font-semibold text-text">Where your refund is</h2>
        <p className="mt-1 text-sm text-text-2">
          {usdc(order.priceUnits)} USDC was credited to <span className="mono text-[13px] break-all text-text">{order.buyer.refundAccount ?? "your refund account"}</span> inside NEAR Intents. Withdraw it to any chain.
        </p>
        <ButtonAnchor href={intentsAppUrl} target="_blank" variant="secondary" block className="mt-4" icon={<Wallet aria-hidden className="size-4" />}>
          Withdraw from NEAR Intents
        </ButtonAnchor>
      </Card>
    );
  }
  if (order.status === "Disputed") {
    return (
      <Card>
        <h2 className="text-[15px] font-semibold text-text">What happens next</h2>
        <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-text-2">
          <li>The money stays locked in the escrow contract.</li>
          <li>The escrow owner reviews the order with you and {order.shop.name}.</li>
          <li>The contract then pays the shop or refunds you — nobody else can move it.</li>
        </ol>
      </Card>
    );
  }
  return null;
}

export default function OrderPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const settings = useAppSettings();

  // A backup link (#k=…) imports the buyer key before the first paint, then the fragment is stripped.
  const [imported] = useState(() => (location.hash.includes("k=") ? { key: importKeyFromHash(id, location.hash) } : null));
  const announced = useRef(false);
  useEffect(() => {
    if (!imported || announced.current) return;
    announced.current = true;
    navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    if (imported.key) toast({ title: "Order pass saved on this device", description: "You can confirm delivery from here now." });
    else toast({ title: "That order pass link is damaged", description: "Copy the full link and try again.", tone: "error" });
  }, [imported, navigate, location.pathname, location.search, toast]);

  const orderQ = useOrder(id, 5000);
  const order = orderQ.data;
  useDocumentTitle(order ? `Order · ${order.item}` : "Order");
  const onOrder = (o: Order) => qc.setQueryData(qk.order(id), o);

  // Re-read when the order arrives (cheap), so a key stored by another tab or the demo seed is picked up.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stored = useMemo(() => loadKey(id), [id, imported, orderQ.dataUpdatedAt]);
  const buyerKey = order && stored && order.buyer.publicKey === stored.publicKey ? stored : null;
  const keyMismatch = !!order?.buyer.publicKey && !!stored && !buyerKey;
  const windowLabel = formatWindow(settings.config?.complaintWindowMs ?? 10 * 60_000);

  let body: React.ReactNode;
  if (orderQ.isPending) body = <OrderSkeleton />;
  else if (orderQ.isError || !order) body = <ErrorState error={orderQ.error} onRetry={() => orderQ.refetch()} />;
  else {
    const copy = buyerCopy(order);
    const awaitingDelivery = order.status === "Funded" || order.status === "Shipped";
    body = (
      <div className="flex flex-col gap-4">
        <Card>
          <div aria-live="polite">
            <StatusChip status={order.status} />
            <h1 className="mt-3 text-2xl leading-tight font-semibold tracking-tight text-text">{copy.headline}</h1>
            <p className="mt-1.5 text-sm text-text-2">{copy.sub}</p>
          </div>
          <div className="mt-4 flex items-end justify-between gap-4 border-t border-border pt-4">
            <div className="min-w-0">
              <p className="text-xs text-text-3">Order</p>
              <p className="truncate text-sm font-medium text-text">{order.item}</p>
            </div>
            <Amount units={order.priceUnits} inrPerUsd={settings.inrPerUsd} size="md" className="items-end text-right" />
          </div>
        </Card>

        {(order.status === "Draft" || order.status === "Created") && (
          <ButtonLink to={`/pay/${order.id}`} size="lg" block iconRight={<ArrowRight aria-hidden className="size-4" />}>
            {order.payment && order.payment.status !== "PENDING_DEPOSIT" ? "See payment status" : "Continue to payment"}
          </ButtonLink>
        )}

        {awaitingDelivery && buyerKey && order.chainOrderId && (
          <DeliveryActions order={order} buyerKey={buyerKey} windowLabel={windowLabel} webUrl={settings.webUrl} onOrder={onOrder} />
        )}
        {awaitingDelivery && !buyerKey && (
          <Banner tone="neutral" icon={KeyRound} title={keyMismatch ? "This device has a different key" : "Viewing only"}>
            To confirm delivery or get a delivery code, open your order pass link (from when you paid) on this device.
          </Banner>
        )}
        {order.status === "Delivered" && <ProtectionWindow order={order} buyerKey={buyerKey} onOrder={onOrder} />}
        <OutcomeCard order={order} intentsAppUrl={settings.intentsAppUrl} />

        <Card>
          <h2 className="mb-4 text-[15px] font-semibold text-text">Progress</h2>
          <OrderTimeline order={order} layout="vertical" />
        </Card>

        <CourierCard order={order} />
        {(isFinal(order.status) || order.status === "Delivered" || order.status === "Disputed") && order.fundedAt && <Receipt order={order} />}
        {buyerKey && !isFinal(order.status) && <OrderPassCard orderId={order.id} buyerKey={buyerKey} webUrl={settings.webUrl} />}

        <Disclosure summary="Details">
          <OrderFacts order={order} explorerTxUrl={settings.explorerTxUrl} />
          <h3 className="mt-5 mb-3 text-sm font-semibold text-text">On-chain transactions</h3>
          <TxList order={order} />
          <Link to={`/proof/${order.id}`} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand underline-offset-2 hover:underline">
            Public proof page <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </Disclosure>
      </div>
    );
  }

  return (
    <BuyerLayout header={<ShopHeader name={order?.shop.name} />}>
      {body}
      {order && <DemoControls orderId={id} status={order.status} />}
    </BuyerLayout>
  );
}
