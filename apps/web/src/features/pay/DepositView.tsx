import { clsx } from "clsx";
import { isDemoDepositAddress, type Order, type Payment } from "@doorstep/shared";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, LoaderCircle, Send, Timer, TriangleExclamationPoint } from "lucide-react";
import { useState } from "react";
import { Banner, Button, Card, CopyButton, CopyField, Countdown, DataList, Disclosure, Field, Input, NetworkBadge, QrCode, TokenIcon, useNow } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { chainName } from "../../lib/chains";
import { formatDateTime, usdc } from "../../lib/format";
import { PAYMENT_PROBLEMS, paymentProgress } from "../../lib/status";

export interface DepositViewProps {
  order: Order;
  payment: Payment;
  demoMode: boolean;
  onOrder: (o: Order) => void;
  onChangeToken: () => void;
  onRequote: () => void;
  requoting: boolean;
  requoteError: unknown;
}

function ProgressList({ order, payment }: { order: Order; payment: Payment }) {
  const steps = paymentProgress(payment.status, order.status);
  const current = steps.find((s) => s.state === "current");
  return (
    <div>
      <ol className="flex flex-col gap-3" aria-label="Payment progress">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-3" aria-current={s.state === "current" ? "step" : undefined}>
            <span
              className={clsx(
                "flex size-7 shrink-0 items-center justify-center rounded-full transition-colors duration-200",
                s.state === "done" && "bg-brand text-on-brand",
                s.state === "current" && "border-2 border-brand text-brand",
                s.state === "upcoming" && "border-2 border-border text-text-3",
              )}
            >
              {s.state === "done" ? (
                <Check aria-hidden className="size-3.5" strokeWidth={3} />
              ) : s.state === "current" ? (
                <LoaderCircle aria-hidden className="size-3.5 animate-spin" strokeWidth={2.5} />
              ) : (
                <span className="tabular text-[11px] font-semibold">{i + 1}</span>
              )}
            </span>
            <span className={clsx("text-sm", s.state === "upcoming" ? "text-text-3" : "font-medium text-text")}>
              {s.label}
              {i === steps.length - 1 && s.state === "done" ? " ✓" : ""}
            </span>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {current ? `Payment status: ${current.label}` : "Payment is held safely"}
      </p>
    </div>
  );
}

const randomHash = () => "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

function SentForm({ order, payment, demoMode, onOrder }: { order: Order; payment: Payment; demoMode: boolean; onOrder: (o: Order) => void }) {
  const [open, setOpen] = useState(false);
  const [hash, setHash] = useState("");
  const [done, setDone] = useState(!!payment.originTxHash);
  const submit = useMutation({
    mutationFn: () => api.orders.submitDeposit(order.id, { txHash: hash.trim() }),
    onSuccess: (o) => {
      setDone(true);
      setOpen(false);
      onOrder(o);
    },
  });

  if (done || payment.status !== "PENDING_DEPOSIT") {
    return (
      <p className="flex items-start gap-2 text-sm text-text-2">
        <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
        Thanks — we're watching for it. This page updates by itself; you can also close it and come back.
      </p>
    );
  }
  if (!open) {
    return (
      <Button variant="secondary" block icon={<Send aria-hidden className="size-4" />} onClick={() => setOpen(true)}>
        I've sent it
      </Button>
    );
  }
  const invalid = hash.trim().length > 0 && hash.trim().length < 8;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!hash.trim()) {
          setDone(true);
          return;
        }
        if (!invalid) submit.mutate();
      }}
    >
      <Field
        label="Transaction hash"
        optional
        hint={`Paste it from your wallet to speed things up. No hash? Just tap Done — we'll spot the payment on ${chainName(payment.originChain)}.`}
        error={invalid ? "That looks too short for a transaction hash" : submit.isError ? errorMessage(submit.error) : null}
      >
        {(a11y) => <Input {...a11y} value={hash} onChange={(e) => setHash(e.target.value)} placeholder="0x… or signature" mono autoComplete="off" spellCheck={false} data-autofocus />}
      </Field>
      {demoMode && (
        <button type="button" onClick={() => setHash(randomHash())} className="self-start text-sm font-medium text-brand underline-offset-2 hover:underline">
          Demo: use a sample hash
        </button>
      )}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" loading={submit.isPending}>
          {hash.trim() ? "Submit" : "Done"}
        </Button>
      </div>
    </form>
  );
}

const PROBLEM_COPY: Record<string, { title: string; body: (refundTo: string) => string; action: string }> = {
  INCOMPLETE_DEPOSIT: {
    title: "Not enough was received",
    body: (r) => `Less than the exact amount arrived, so the payment can't complete. What arrived is refunded to ${r}. Get a new quote to try again.`,
    action: "Get a new quote",
  },
  REFUNDED: {
    title: "Your payment was returned",
    body: (r) => `The conversion couldn't complete, so your money went back to ${r}. Nothing reached the shop. You can try again.`,
    action: "Try again",
  },
  FAILED: {
    title: "The conversion failed",
    body: (r) => `If you sent money, it's returned to ${r}. Nothing reached the shop. You can try again with a new quote.`,
    action: "Try again",
  },
};

export function DepositView({ order, payment, demoMode, onOrder, onChangeToken, onRequote, requoting, requoteError }: DepositViewProps) {
  const now = useNow(1000);
  const expired = payment.status === "PENDING_DEPOSIT" && Date.parse(payment.deadline) <= now;
  const lowTime = Date.parse(payment.deadline) - now < 5 * 60_000;
  const problem = PAYMENT_PROBLEMS.includes(payment.status) ? PROBLEM_COPY[payment.status] : null;
  const chain = chainName(payment.originChain);
  const inFlight = payment.status !== "PENDING_DEPOSIT";
  // Demo mode and the sandbox use fake addresses no wallet accepts; say so loudly anyway.
  const practice = demoMode || isDemoDepositAddress(payment.depositAddress);

  if (problem) {
    return (
      <div className="flex flex-col gap-4">
        <Banner tone={payment.status === "INCOMPLETE_DEPOSIT" ? "warning" : "danger"} title={problem.title} role="alert">
          <span className="break-words">{problem.body(payment.refundTo)}</span>
        </Banner>
        {requoteError ? <Banner tone="danger">{errorMessage(requoteError)}</Banner> : null}
        <Button size="lg" block onClick={onRequote} loading={requoting}>
          {problem.action}
        </Button>
        <Button variant="ghost" block onClick={onChangeToken}>
          Pay with a different token
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text">{inFlight ? "Payment on its way" : "Send your payment"}</h1>
        {!inFlight && !expired && (
          <span className={clsx("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium", lowTime ? "bg-waiting-bg text-waiting" : "bg-surface-2 text-text-2")}>
            <Timer aria-hidden className="size-3.5" />
            <span className="sr-only">Address valid for </span>
            <Countdown to={payment.deadline} />
          </span>
        )}
      </div>

      {expired ? (
        <div className="flex flex-col gap-3">
          <Banner tone="danger" title="This deposit address has expired" role="alert">
            Don't send anything to it. Get a new quote — it only takes a second.
          </Banner>
          {requoteError ? <Banner tone="danger">{errorMessage(requoteError)}</Banner> : null}
          <Button size="lg" block onClick={onRequote} loading={requoting}>
            Get a new quote
          </Button>
        </div>
      ) : (
        <>
          {practice && !inFlight && (
            <Banner tone="danger" title="Practice mode: don't send real money" role="alert">
              This address is fake on purpose. Wallets and exchanges reject it, and nothing sent here can reach a shop. Use the demo steps on this page to see what happens next.
            </Banner>
          )}
          <Card padding="none" className="overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <p className="text-sm font-medium text-text-2">Send exactly</p>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <TokenIcon symbol={payment.originSymbol} chain={payment.originChain} size={40} />
                  <p className="min-w-0">
                    <span className="tabular block text-3xl leading-tight font-semibold tracking-tight break-all text-text">{payment.amountInFormatted}</span>
                    <span className="text-sm font-semibold text-text-2">{payment.originSymbol}</span>
                  </p>
                </div>
                <CopyButton value={payment.amountInFormatted} label="Copy" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-3">
                <NetworkBadge chain={payment.originChain} />
                <span>The shop receives exactly {usdc(order.priceUnits)} USDC</span>
              </div>
            </div>
            <div className="border-t border-border bg-waiting-bg px-5 py-3 text-sm text-waiting">
              <p className="flex items-start gap-2 font-medium">
                <TriangleExclamationPoint aria-hidden className="mt-0.5 size-4 shrink-0" />
                Send only {payment.originSymbol} on {chain} — other tokens or networks can't be recovered.
              </p>
            </div>
          </Card>

          {!inFlight && (
            <Card>
              <div className="flex flex-col items-center">
                <QrCode value={payment.depositAddress} label={`QR code of the ${chain} deposit address`} size={168} />
                <p className={clsx("mt-2 text-xs", practice ? "font-medium text-danger" : "text-text-3")}>
                  {practice ? "Practice address: real wallets reject it" : "Scan with your wallet, or copy the address"}
                </p>
              </div>
              <CopyField className="mt-4" label={practice ? "Practice address (not a real address)" : `Deposit address (${chain})`} value={payment.depositAddress} />
              {payment.depositMemo && (
                <>
                  <CopyField className="mt-3" label="Memo (required)" value={payment.depositMemo} />
                  <p className="mt-1.5 text-xs font-medium text-waiting">Include this memo, or the payment can't be matched to your order.</p>
                </>
              )}
            </Card>
          )}
        </>
      )}

      <Card>
        <h2 className="mb-3.5 text-[15px] font-semibold text-text">Status</h2>
        <ProgressList order={order} payment={payment} />
        {payment.issue && (
          <Banner tone="info" className="mt-4">
            {payment.issue}
          </Banner>
        )}
        {!expired && (
          <div className="mt-4 border-t border-border pt-4">
            <SentForm order={order} payment={payment} demoMode={demoMode} onOrder={onOrder} />
          </div>
        )}
      </Card>

      <Disclosure summary="Details">
        <DataList
          items={[
            { label: "Paying with", value: `${payment.originSymbol} on ${chain}` },
            { label: "Refunds (if the conversion fails)", value: payment.refundTo, mono: true },
            ...(order.buyer.refundAccount ? [{ label: "Escrow refund account", value: order.buyer.refundAccount, mono: true }] : []),
            { label: "Quoted", value: formatDateTime(payment.quotedAt) },
            { label: "Address valid until", value: formatDateTime(payment.deadline) },
            ...(payment.originTxHash ? [{ label: "Your transaction", value: payment.originTxHash, mono: true }] : []),
            { label: "Converted by", value: "NEAR Intents (1Click)" },
            { label: "Held by", value: order.escrow, mono: true },
          ]}
        />
      </Disclosure>

      {!inFlight && (
        <Button variant="ghost" block icon={<ArrowLeft aria-hidden className="size-4" />} onClick={onChangeToken}>
          Pay with a different token
        </Button>
      )}
    </div>
  );
}
