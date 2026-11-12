import type { Order } from "@doorstep/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CircleSlash, MonitorSmartphone } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { BuyerLayout, useDocumentTitle } from "../../components/layout/Layout";
import { Amount, Banner, ButtonLink, Card, CheckAnimation, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { loadKey } from "../../lib/buyerKey";
import { refundPlan } from "../../lib/chains";
import { qk, useAppSettings, useOrder } from "../../lib/query";
import { PAYMENT_PROBLEMS } from "../../lib/status";
import { DemoControls } from "../demo/DemoControls";
import { CheckoutForm } from "./CheckoutForm";
import { DepositView } from "./DepositView";
import { loadPaySession, OrderPassCard, OrderSummaryCard, OrderSummarySkeleton, ProtectionExplainer, ShopHeader, type PaySession } from "./parts";

const ACTIVE_PAYMENT = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS", "INCOMPLETE_DEPOSIT", "REFUNDED", "FAILED"];
const SECURED = ["Funded", "Shipped", "Delivered", "Disputed", "Released", "Refunded"];

function PaySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading order">
      <OrderSummarySkeleton />
      <Skeleton className="h-[108px] rounded-xl" />
      <Card>
        <Skeleton className="h-5 w-28" />
        <div className="mt-4 grid grid-cols-4 gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-[84px] rounded-xl" />
          ))}
        </div>
      </Card>
    </div>
  );
}

function SuccessView({ order, animate, inrPerUsd, webUrl }: { order: Order; animate: boolean; inrPerUsd: number; webUrl: string }) {
  const key = loadKey(order.id);
  const ours = key && key.publicKey === order.buyer.publicKey;
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col items-center px-6 py-8 text-center" raised>
        <CheckAnimation size={animate ? 76 : 64} still={!animate} />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-text" aria-live="polite">
          Your payment is held safely
        </h1>
        <p className="mt-1.5 max-w-xs text-sm text-text-2">{order.shop.name} gets paid only after it reaches your door.</p>
        <div className="mt-5 rounded-xl bg-surface-2 px-5 py-3">
          <Amount units={order.paidUnits !== "0" ? order.paidUnits : order.priceUnits} inrPerUsd={inrPerUsd} size="md" inr="row" />
          <p className="mt-0.5 text-xs text-text-3">locked in the escrow contract</p>
        </div>
      </Card>
      {ours && key && <OrderPassCard orderId={order.id} buyerKey={key} webUrl={webUrl} emphasis />}
      <ButtonLink to={`/o/${order.id}`} size="lg" block iconRight={<ArrowRight aria-hidden className="size-4" />}>
        Track your order
      </ButtonLink>
    </div>
  );
}

export default function PayPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const settings = useAppSettings();
  const [session, setSession] = useState<PaySession>(() => loadPaySession(id));
  const [editing, setEditing] = useState(false);
  const sawPending = useRef(false);

  const orderQ = useOrder(id, (o) => {
    if (!o) return false;
    if (o.status === "Created" && o.payment && ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"].includes(o.payment.status)) return 3000;
    if (o.status === "Draft" || o.status === "Created") return 15_000;
    return false;
  });
  const order = orderQ.data;
  useDocumentTitle(order ? `Pay ${order.shop.name}` : "Pay");

  const setOrder = useCallback((o: Order) => qc.setQueryData(qk.order(id), o), [qc, id]);

  const requote = useMutation({
    mutationFn: async () => {
      const assetId = session.assetId ?? order?.payment?.originAsset;
      const chain = order?.payment?.originChain;
      if (!assetId || !order) throw new Error("Choose a token first");
      const refundTo = session.originAddress && chain ? refundPlan(chain, session.originAddress, session.nearAccount).refundTo : order.payment?.refundTo;
      if (!refundTo) throw new Error("Enter a refund address first");
      return (await api.orders.quote(id, { originAsset: assetId, refundTo, dry: false })).order;
    },
    onSuccess: setOrder,
  });

  const key = order ? loadKey(order.id) : null;
  const ownsOrder = !!order && !!key && order.buyer.publicKey === key.publicKey;
  const payment = order?.payment ?? null;
  const showDeposit = !!order && order.status === "Created" && ownsOrder && !!payment && ACTIVE_PAYMENT.includes(payment.status) && !editing;
  if (showDeposit && !PAYMENT_PROBLEMS.includes(payment.status)) sawPending.current = true;

  useEffect(() => {
    if (order && SECURED.includes(order.status)) setEditing(false);
  }, [order]);

  let body: React.ReactNode;
  if (orderQ.isPending) {
    body = <PaySkeleton />;
  } else if (orderQ.isError || !order) {
    body = <ErrorState error={orderQ.error} onRetry={() => orderQ.refetch()} title={undefined} />;
  } else if (SECURED.includes(order.status)) {
    body =
      order.status === "Refunded" ? (
        <Card>
          <EmptyState
            icon={CircleSlash}
            title="This order was refunded"
            description="The payment went back to the buyer's refund account."
            action={<ButtonLink to={`/o/${order.id}`}>View order</ButtonLink>}
          />
        </Card>
      ) : (
        <SuccessView order={order} animate={sawPending.current} inrPerUsd={settings.inrPerUsd} webUrl={settings.webUrl} />
      );
  } else if (order.status === "Expired") {
    body = (
      <Card>
        <EmptyState icon={CircleSlash} title="This pay link has expired" description="It wasn't paid before the deadline, so no money moved. Ask the shop for a new link." />
      </Card>
    );
  } else if (order.status === "Created" && order.buyer.publicKey && !ownsOrder) {
    body = (
      <div className="flex flex-col gap-4">
        <OrderSummaryCard order={order} inrPerUsd={settings.inrPerUsd} />
        <Card>
          <EmptyState
            icon={MonitorSmartphone}
            title="This order was opened on another device"
            description="Only the device that started paying can finish. If that was you, open your order pass link there. Otherwise, ask the shop for a new link."
            action={<ButtonLink to={`/o/${order.id}`} variant="secondary">View order status</ButtonLink>}
          />
        </Card>
      </div>
    );
  } else if (showDeposit && payment) {
    body = (
      <DepositView
        order={order}
        payment={payment}
        demoMode={settings.demoMode}
        onOrder={setOrder}
        onChangeToken={() => setEditing(true)}
        onRequote={() => requote.mutate()}
        requoting={requote.isPending}
        requoteError={requote.error}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <OrderSummaryCard order={order} inrPerUsd={settings.inrPerUsd} />
        <ProtectionExplainer order={order} />
        {editing && payment?.status === "PENDING_DEPOSIT" && (
          <Banner tone="warning" title="Changing how you pay">
            You'll get a new deposit address. Don't send anything to the previous one.
          </Banner>
        )}
        <CheckoutForm
          order={order}
          session={session}
          onSessionChange={setSession}
          onPaymentReady={(o) => {
            setOrder(o);
            setEditing(false);
            window.scrollTo({ top: 0 });
          }}
        />
      </div>
    );
  }

  return (
    <BuyerLayout header={<ShopHeader name={order?.shop.name} />}>
      {body}
      {order && (
        <DemoControls
          orderId={id}
          status={order.status}
          blockedReason={
            order.status === "Draft"
              ? "Fill in the form and continue as the buyer — then use this to simulate the payment."
              : order.status === "Created" && !payment
                ? "Continue to payment first, then simulate it here."
                : null
          }
        />
      )}
    </BuyerLayout>
  );
}
