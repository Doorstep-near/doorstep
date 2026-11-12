import type { Order, Token } from "@doorstep/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Info, LoaderCircle } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { StepHeading } from "../../components/layout/Layout";
import { Banner, Button, Card, ErrorState, Field, Input, TokenPicker } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { getOrCreateKey, loadKey } from "../../lib/buyerKey";
import { chainInfo, chainName, previewRefundTo, refundPlan, validateNearAccount, validateOriginAddress } from "../../lib/chains";
import { useTokens } from "../../lib/query";
import { savePaySession, type PaySession } from "./parts";

type Phase = "idle" | "register" | "quote";

export interface CheckoutFormProps {
  order: Order;
  session: PaySession;
  onSessionChange: (s: PaySession) => void;
  onPaymentReady: (order: Order) => void;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Live "You send ≈ …" preview for the chosen token. */
function DryQuote({ order, token, originAddress }: { order: Order; token: Token; originAddress: string }) {
  const q = useQuery({
    queryKey: ["dry-quote", order.id, token.assetId],
    queryFn: () => api.orders.quote(order.id, { originAsset: token.assetId, refundTo: previewRefundTo(token.chain, originAddress), dry: true }),
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: false,
  });
  return (
    <div aria-live="polite" className="mt-3 min-h-[52px] rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-sm">
      {q.isPending ? (
        <p className="flex items-center gap-2 py-1.5 text-text-2">
          <LoaderCircle aria-hidden className="size-4 animate-spin text-brand" />
          Getting a live price…
        </p>
      ) : q.isError ? (
        <p className="flex items-start gap-2 py-0.5 text-text-2">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-text-3" />
          Live price unavailable right now — you'll see the exact amount on the next step.
        </p>
      ) : (
        <>
          <p className="text-text">
            You send ≈{" "}
            <span className="tabular font-semibold">
              {q.data.amountInFormatted} {token.symbol}
            </span>{" "}
            on {chainName(token.chain)}
          </p>
          <p className="mt-0.5 text-xs text-text-3">
            Converted to exactly {q.data.amountOutFormatted} USDC for the shop
            {q.data.timeEstimateSec ? ` · about ${q.data.timeEstimateSec < 90 ? `${q.data.timeEstimateSec} s` : `${Math.round(q.data.timeEstimateSec / 60)} min`}` : ""}
          </p>
        </>
      )}
    </div>
  );
}

export function CheckoutForm({ order, session, onSessionChange, onPaymentReady }: CheckoutFormProps) {
  const tokens = useTokens();
  const payWithId = useId();
  const refundId = useId();
  const [touched, setTouched] = useState<{ origin?: boolean; near?: boolean; token?: boolean }>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const originRef = useRef<HTMLInputElement>(null);
  const nearRef = useRef<HTMLInputElement>(null);

  const token = useMemo(() => tokens.data?.tokens.find((t) => t.assetId === session.assetId) ?? null, [tokens.data, session.assetId]);
  const debouncedToken = useDebounced(token, 250);
  const family = token ? chainInfo(token.chain).family : null;
  const registeredHere = order.status === "Created" && !!order.buyer.publicKey && loadKey(order.id)?.publicKey === order.buyer.publicKey;
  const fixedRefundAccount = registeredHere ? order.buyer.refundAccount : null;

  const update = (patch: Partial<PaySession>) => {
    const next = { ...session, ...patch };
    onSessionChange(next);
    savePaySession(order.id, next);
  };

  const errors = {
    token: !token ? "Choose how you want to pay" : null,
    origin: token ? validateOriginAddress(token.chain, session.originAddress) : null,
    near: token && family === "other" && !fixedRefundAccount ? validateNearAccount(session.nearAccount) : null,
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Choose how you want to pay");
      const plan = refundPlan(token.chain, session.originAddress, session.nearAccount);
      // The key is created and stored before anything is sent, so it survives a failed request.
      const key = getOrCreateKey(order.id);
      let current = order;
      if (current.status === "Draft" || !current.buyer.publicKey) {
        setPhase("register");
        current = await api.orders.registerBuyer(order.id, { buyerPk: key.publicKey, refundAccount: plan.refundAccount });
      } else if (current.buyer.publicKey !== key.publicKey) {
        throw new Error("This order was already opened on another device. Open your order pass link there to continue, or ask the shop for a new link.");
      }
      setPhase("quote");
      const quote = await api.orders.quote(order.id, { originAsset: token.assetId, refundTo: plan.refundTo, dry: false });
      return quote.order;
    },
    onSuccess: (o) => onPaymentReady(o),
    onSettled: () => setPhase("idle"),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ origin: true, near: true, token: true });
    if (errors.token || errors.origin || errors.near) {
      if (!errors.token) (errors.origin ? originRef : nearRef).current?.focus();
      return;
    }
    submit.mutate();
  };

  const chain = token ? chainName(token.chain) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Card>
        <StepHeading n={1} id={payWithId}>
          Pay with
        </StepHeading>
        <p className="mt-1 mb-3.5 text-sm text-text-2">Any token on any chain. It's converted to exactly the price in USDC.</p>
        {tokens.isError ? (
          <ErrorState error={tokens.error} onRetry={() => tokens.refetch()} title="Couldn't load tokens" className="py-6 shadow-none" />
        ) : (
          <TokenPicker
            tokens={tokens.data?.tokens}
            loading={tokens.isPending}
            value={session.assetId}
            labelledBy={payWithId}
            onChange={(t) => {
              const sameFamily = token && chainInfo(token.chain).family === chainInfo(t.chain).family && chainInfo(t.chain).family !== "other";
              update({ assetId: t.assetId, originAddress: sameFamily ? session.originAddress : "" });
            }}
          />
        )}
        {touched.token && errors.token && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {errors.token}
          </p>
        )}
        {debouncedToken && debouncedToken.assetId === token?.assetId && <DryQuote order={order} token={debouncedToken} originAddress={session.originAddress} />}
      </Card>

      <Card>
        <StepHeading n={2} id={refundId}>
          Refund address
        </StepHeading>
        {!token ? (
          <p className="mt-1 text-sm text-text-3">Pick a token first — we'll ask for the matching address.</p>
        ) : (
          <div className="mt-3.5 flex flex-col gap-4">
            <Field
              label={family === "near" ? "Your NEAR account" : `Your ${chain} address`}
              hint="If anything goes wrong, your money goes back here."
              error={touched.origin ? errors.origin : null}
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  ref={originRef}
                  value={session.originAddress}
                  onChange={(e) => update({ originAddress: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, origin: true }))}
                  placeholder={family === "evm" ? "0x…" : family === "near" ? "yourname.near" : (chainInfo(token.chain).placeholder ?? "Address")}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  mono
                />
              )}
            </Field>
            {family === "other" && !fixedRefundAccount && (
              <Field
                label="NEAR account for refunds"
                hint={
                  <>
                    If the order is refunded after payment, the money is returned inside NEAR Intents, which needs a NEAR account. Use <span className="mono text-[12px]">yourname.near</span> or any 0x address you
                    control.
                  </>
                }
                error={touched.near ? errors.near : null}
              >
                {(a11y) => (
                  <Input
                    {...a11y}
                    ref={nearRef}
                    value={session.nearAccount}
                    onChange={(e) => update({ nearAccount: e.target.value })}
                    onBlur={() => setTouched((t) => ({ ...t, near: true }))}
                    placeholder="yourname.near"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    mono
                  />
                )}
              </Field>
            )}
            {fixedRefundAccount && (
              <p className="text-sm text-text-2">
                Escrow refunds go to <span className="mono text-[13px] break-all text-text">{fixedRefundAccount}</span> (set when you first continued).
              </p>
            )}
          </div>
        )}
      </Card>

      {submit.isError && (
        <Banner tone="danger" title="We couldn't set up your payment" role="alert">
          {errorMessage(submit.error)}
        </Banner>
      )}

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          size="lg"
          block
          loading={submit.isPending}
          loadingText={phase === "register" ? "Securing your order…" : "Getting your deposit address…"}
          iconRight={<ArrowRight aria-hidden className="size-4" />}
        >
          Continue to payment
        </Button>
        <p className="text-center text-xs text-text-3">No wallet connection needed. You'll get an exact amount and an address to send to.</p>
      </div>
    </form>
  );
}
