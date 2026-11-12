// Opened from the buyer's delivery-pass QR (phone camera or the seller app's scanner).
import { base64UrlToBase64, Signature, type Order } from "@doorstep/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleExclamationPoint, LinkIcon, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useParams } from "react-router";
import { BuyerLayout, useDocumentTitle } from "../../components/layout/Layout";
import { Amount, Button, ButtonLink, Card, CheckAnimation, Countdown, Spinner } from "../../components/ui";
import { api, errorMessage, isApiError } from "../../lib/api";
import { qk, useAppSettings } from "../../lib/query";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <BuyerLayout>
      <Card className="flex flex-col items-center px-6 py-10 text-center" raised>
        {children}
      </Card>
    </BuyerLayout>
  );
}

function OrderLinks({ id }: { id: string }) {
  return (
    <div className="mt-6 flex w-full flex-col gap-2">
      <ButtonLink to={`/seller/orders/${id}`} block>
        Open in seller app
      </ButtonLink>
      <ButtonLink to={`/o/${id}`} variant="ghost" block>
        View order status
      </ButtonLink>
    </div>
  );
}

function Confirmed({ order, already }: { order: Order | undefined; already?: boolean }) {
  const { inrPerUsd } = useAppSettings();
  return (
    <>
      {already ? <CircleCheck aria-hidden className="size-14 text-brand" /> : <CheckAnimation size={76} />}
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-text" aria-live="polite">
        {already ? "Delivery was already confirmed" : "Delivery confirmed"}
      </h1>
      <p className="mt-1.5 max-w-xs text-sm text-text-2">Payout after the protection window. The buyer can still report a problem until it ends.</p>
      {order && (
        <div className="mt-5 w-full rounded-xl bg-surface-2 px-4 py-3 text-left">
          <p className="truncate text-sm font-medium text-text">{order.item}</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <Amount units={order.priceUnits} inrPerUsd={inrPerUsd} size="sm" inr="row" />
            {order.complaintEndsAt && order.status === "Delivered" && (
              <p className="text-xs text-text-3">
                Payout in <Countdown to={order.complaintEndsAt} className="font-medium text-text" />
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function ConfirmPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const qc = useQueryClient();
  useDocumentTitle("Confirm delivery");

  const signature = useMemo(() => {
    const raw = new URLSearchParams(location.hash.replace(/^#/, "")).get("sig");
    if (!raw) return null;
    const b64 = base64UrlToBase64(raw);
    return Signature.safeParse(b64).success ? b64 : null;
  }, [location.hash]);

  const confirm = useMutation({
    mutationFn: () => api.orders.confirm(id, { signature: signature! }),
    onSuccess: (o) => qc.setQueryData(qk.order(id), o),
  });
  // If the order turns out to be confirmed already, show that instead of an error.
  const already = useMutation({ mutationFn: () => api.orders.get(id) });

  const started = useRef(false);
  useEffect(() => {
    if (signature && !started.current) {
      started.current = true;
      confirm.mutate(undefined, {
        onError: (e) => {
          if (isApiError(e, "invalid_state")) already.mutate();
        },
      });
    }
  }, [signature, confirm, already]);

  if (!signature) {
    return (
      <Shell>
        <span className="flex size-14 items-center justify-center rounded-full bg-neutral-bg text-neutral">
          <LinkIcon aria-hidden className="size-7" />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-text">This link is incomplete</h1>
        <p className="mt-1.5 max-w-xs text-sm text-text-2">It's missing the buyer's delivery signature. Ask the buyer to show their delivery pass again and scan the whole code.</p>
      </Shell>
    );
  }

  if (confirm.isSuccess) {
    return (
      <Shell>
        <Confirmed order={confirm.data} />
        <OrderLinks id={id} />
      </Shell>
    );
  }

  const alreadyDone = already.data && ["Delivered", "Released", "Disputed"].includes(already.data.status);
  if (alreadyDone) {
    return (
      <Shell>
        <Confirmed order={already.data} already />
        <OrderLinks id={id} />
      </Shell>
    );
  }

  if (confirm.isError && !already.isPending) {
    const badSig = isApiError(confirm.error, "invalid_signature");
    return (
      <Shell>
        <span className="flex size-14 items-center justify-center rounded-full bg-danger-bg text-danger">
          <CircleExclamationPoint aria-hidden className="size-7" />
        </span>
        <div role="alert">
          <h1 className="mt-4 text-xl font-semibold text-text">{badSig ? "This delivery pass doesn't match the order" : "Couldn't confirm delivery"}</h1>
          <p className="mt-1.5 max-w-xs text-sm text-text-2">
            {badSig ? "It may belong to a different order. Ask the buyer to open their order page and show the pass again." : errorMessage(confirm.error)}
          </p>
        </div>
        {!badSig && (
          <Button variant="secondary" className="mt-5" icon={<RefreshCw aria-hidden className="size-4" />} onClick={() => confirm.mutate()}>
            Try again
          </Button>
        )}
        <OrderLinks id={id} />
      </Shell>
    );
  }

  return (
    <Shell>
      <Spinner className="size-10" label="Confirming delivery" />
      <h1 className="mt-4 text-xl font-semibold text-text">Confirming delivery…</h1>
      <p className="mt-1.5 max-w-xs text-sm text-text-2">Recording the buyer's signed confirmation with the escrow contract on NEAR.</p>
    </Shell>
  );
}
