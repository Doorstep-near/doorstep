import { clsx } from "clsx";
import { links, type Order, type PaymentStatus, type TxKind } from "@doorstep/shared";
import { ExternalLink, FlaskConical } from "lucide-react";
import { Link, useParams } from "react-router";
import { useDocumentTitle } from "../../components/layout/Layout";
import { TX_ICON, explorerAccountUrl } from "../../components/order/OrderBits";
import {
  Amount,
  Banner,
  ButtonAnchor,
  Card,
  CopyButton,
  DataList,
  ErrorState,
  ExplorerLink,
  Logo,
  OrderTimeline,
  Skeleton,
  SkeletonText,
  StatusChip,
  ThemeToggle,
} from "../../components/ui";
import { chainName } from "../../lib/chains";
import { formatDate, formatFull, shortHash, usdc } from "../../lib/format";
import { useAppSettings, useOrder, type AppSettings } from "../../lib/query";
import { TX_LABEL, TX_METHOD, isFinal } from "../../lib/status";

// ------------------------------------------------------------------ copy

/** One neutral sentence for a public reader. */
export function proofSummary(o: Order): string {
  const shop = o.shop.name;
  switch (o.status) {
    case "Draft":
      return "The shop created this order. It goes on chain when the buyer opens the pay link.";
    case "Created":
      return "The order is on chain and waiting for the buyer's payment.";
    case "Funded":
      return `The buyer's payment is locked in the escrow contract. ${shop} is paid only after delivery is proven.`;
    case "Shipped":
      return "The order has been shipped and the payment is still locked, waiting for delivery proof.";
    case "Delivered":
      return "Delivery was proven. The complaint window is running; after it ends the contract pays the shop.";
    case "Disputed":
      return "The buyer reported a problem inside the complaint window. The money stays locked until the dispute is resolved.";
    case "Released":
      return `Delivery was proven and the contract paid ${shop} inside NEAR Intents.`;
    case "Refunded":
      return "Delivery wasn't proven in time (or a dispute went to the buyer), so the contract refunded the buyer.";
    case "Expired":
      return "The order was never paid before its deadline. No money moved.";
  }
}

function txDescription(o: Order, kind: TxKind): string {
  switch (kind) {
    case "create":
      return "The order — price, deadline and the buyer's public key — was registered in the escrow contract.";
    case "fund":
      return "NEAR Intents (1Click) delivered exactly the price in USDC to the escrow, tagged with this order id.";
    case "ship":
      return "The courier reference was recorded on chain.";
    case "deliver":
      return o.proof === "buyer"
        ? "The contract verified the buyer's ed25519 signature over “delivered|order|escrow”."
        : "The contract verified the checker's signature for a courier report or delivery code.";
    case "complaint":
      return "The buyer signed a complaint inside the protection window; the funds stay locked.";
    case "resolve":
      return "The contract owner resolved the dispute.";
    case "release":
      return "The contract paid the shop inside NEAR Intents.";
    case "refund":
      return "The contract returned the USDC to the buyer's refund account inside NEAR Intents.";
  }
}

function txAmount(o: Order, kind: TxKind): string | null {
  if (kind === "fund") return `${usdc(o.paidUnits === "0" ? o.priceUnits : o.paidUnits)} USDC in`;
  if (kind === "release") return `${usdc(o.priceUnits)} USDC → shop`;
  if (kind === "refund") return `${usdc(o.paidUnits === "0" ? o.priceUnits : o.paidUnits)} USDC → buyer`;
  return null;
}

const PAYMENT_STATUS: Record<PaymentStatus, string> = {
  NONE: "No quote yet",
  PENDING_DEPOSIT: "Waiting for the deposit",
  KNOWN_DEPOSIT_TX: "Deposit submitted",
  PROCESSING: "Converting to USDC",
  SUCCESS: "Delivered to the escrow",
  INCOMPLETE_DEPOSIT: "Incomplete deposit",
  REFUNDED: "Refunded by 1Click",
  FAILED: "Failed",
};

// ------------------------------------------------------------------ page

export default function ProofPage() {
  const { id = "" } = useParams();
  const q = useOrder(id, (o) => (o && isFinal(o.status) ? false : 10_000));
  const settings = useAppSettings();
  useDocumentTitle(q.data ? `Proof · ${q.data.item}` : "Proof");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
        <div className="mx-auto flex h-14 max-w-[960px] items-center gap-3 px-4 sm:px-6">
          <Logo size="sm" />
          <span className="hidden h-6 items-center rounded-full bg-surface-2 px-2.5 text-xs font-medium text-text-2 sm:inline-flex">Public proof</span>
          <ThemeToggle className="ml-auto -mr-2" />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-[960px] flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {q.isPending ? (
          <ProofSkeleton />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} className="mx-auto max-w-lg" />
        ) : (
          <ProofContent order={q.data} settings={settings} />
        )}
      </main>
      <footer className="mx-auto w-full max-w-[960px] px-4 pb-10 text-xs text-text-3 sm:px-6">
        Doorstep keeps payments in a NEAR escrow contract until delivery is proven.{" "}
        <Link to="/" className="font-medium text-text-2 underline-offset-2 hover:underline">
          How it works
        </Link>
      </footer>
    </div>
  );
}

function ProofContent({ order: o, settings }: { order: Order; settings: AppSettings }) {
  const proofUrl = links.proof(settings.webUrl, o.id);
  const verifyUrl = explorerAccountUrl(settings.explorerTxUrl, o.escrow);
  const txs = [...o.txs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const p = o.payment;

  const facts = [
    { label: "Escrow contract", value: o.escrow, mono: true },
    { label: "On-chain order id", value: o.chainOrderId ?? "Not on chain yet", mono: !!o.chainOrderId },
    { label: "Shop account", value: o.shop.account, mono: true },
    { label: "Price", value: <span className="tabular">{usdc(o.priceUnits)} USDC</span> },
    { label: "Paid into escrow", value: <span className="tabular">{usdc(o.paidUnits)} USDC</span> },
    { label: "Deliver by", value: formatFull(o.deliverBy) },
    { label: "Delivery proof", value: o.proof === "buyer" ? "Buyer's signature" : o.proof === "checker" ? "Checker (courier or code)" : "Not yet" },
  ];
  if (p) facts.push({ label: "Paid with", value: `${p.amountInFormatted} ${p.originSymbol} on ${chainName(p.originChain)}` });

  return (
    <div className="flex flex-col gap-6">
      {/* Summary */}
      <Card padding="lg" as="section" aria-labelledby="proof-title">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={o.status} />
              <span className="mono text-text-3">Order {o.id}</span>
            </div>
            <p className="mt-4 text-sm font-medium text-text-2">Proof of a delivery-protected payment</p>
            <h1 id="proof-title" className="mt-1 text-2xl font-semibold tracking-tight text-balance text-text sm:text-3xl">
              {o.item}
            </h1>
            <p className="mt-1 text-sm text-text-2">
              Sold by <span className="font-medium text-text">{o.shop.name}</span>
              {o.delivery.area && <> · to {o.delivery.area}</>} · deliver by {formatDate(o.deliverBy)}
            </p>
            <p className="mt-4 max-w-xl text-[15px] leading-6 text-text" aria-live="polite">
              {proofSummary(o)}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-4 md:items-end md:text-right">
            <Amount units={o.priceUnits} inrPerUsd={settings.inrPerUsd} size="xl" className="md:items-end" />
            <div className="flex flex-wrap gap-2 md:justify-end">
              {o.demo ? (
                <span
                  className="inline-flex h-11 cursor-not-allowed items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 text-[15px] font-semibold text-text-3"
                  title="Demo orders aren't on chain"
                  aria-disabled="true"
                >
                  <ExternalLink aria-hidden className="size-4" />
                  Verify on NearBlocks
                </span>
              ) : (
                <ButtonAnchor href={verifyUrl} target="_blank" icon={<ExternalLink aria-hidden className="size-4" />}>
                  Verify on NearBlocks
                </ButtonAnchor>
              )}
              <CopyButton value={proofUrl} label="Copy link" />
            </div>
          </div>
        </div>
      </Card>

      {o.demo && (
        <Banner tone="warning" icon={FlaskConical} title="Demo order — these transactions are simulated and not on chain">
          Real orders link every step below to NearBlocks, where anyone can check it against the escrow contract.
        </Banner>
      )}

      {/* Timeline */}
      <Card as="section" aria-labelledby="progress-heading">
        <h2 id="progress-heading" className="mb-5 text-base font-semibold text-text">
          Progress
        </h2>
        <OrderTimeline order={o} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* On-chain record */}
        <Card as="section" aria-labelledby="record-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="record-heading" className="text-base font-semibold text-text">
              On-chain record
            </h2>
            <span className="text-xs text-text-3">
              {txs.length} transaction{txs.length === 1 ? "" : "s"}
            </span>
          </div>
          {txs.length === 0 ? (
            <p className="mt-4 text-sm text-text-2">Nothing on chain yet. The first transaction happens when the buyer opens the pay link.</p>
          ) : (
            <ol className="mt-5 flex flex-col">
              {txs.map((t, i) => {
                const Icon = TX_ICON[t.kind];
                const amount = txAmount(o, t.kind);
                return (
                  <li key={`${t.kind}-${t.hash}`} className="relative flex gap-4 pb-6 last:pb-0">
                    {i < txs.length - 1 && <span aria-hidden className="absolute top-10 bottom-1 left-[17px] w-0.5 rounded-full bg-border" />}
                    <span
                      className={clsx(
                        "relative flex size-9 shrink-0 items-center justify-center rounded-lg",
                        t.kind === "complaint" ? "bg-danger-bg text-danger" : t.kind === "refund" ? "bg-neutral-bg text-neutral" : "bg-brand-soft text-brand",
                      )}
                    >
                      <Icon aria-hidden className="size-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <h3 className="text-sm font-semibold text-text">{TX_LABEL[t.kind]}</h3>
                        {amount && <span className="tabular text-sm font-semibold text-text">{amount}</span>}
                      </div>
                      <p className="tabular mt-0.5 text-xs text-text-3">
                        <time dateTime={t.at}>{formatFull(t.at)}</time>
                      </p>
                      <p className="mt-1.5 text-sm leading-6 text-text-2">{txDescription(o, t.kind)}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <code className="mono rounded-md bg-surface-2 px-1.5 py-0.5 text-[12px] text-text-2">{TX_METHOD[t.kind]}</code>
                        <ExplorerLink hash={t.hash} url={t.url} className="text-[13px]" />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card as="section" aria-labelledby="facts-heading">
            <h2 id="facts-heading" className="mb-4 text-base font-semibold text-text">
              Order facts
            </h2>
            <DataList items={facts} />
          </Card>
          <HowToVerify order={o} network={settings.config?.network ?? "mainnet"} />
        </div>
      </div>

      {p && (
        <Card as="section" aria-labelledby="oneclick-heading">
          <h2 id="oneclick-heading" className="text-base font-semibold text-text">
            Payment conversion
          </h2>
          <p className="mt-1 text-sm text-text-2">
            The buyer paid on {chainName(p.originChain)}; NEAR Intents (1Click) converted it into exactly {usdc(o.priceUnits)} USDC for the escrow.
          </p>
          {p.issue && (
            <Banner tone="info" className="mt-4">
              {p.issue}
            </Banner>
          )}
          <DataList
            className="mt-4"
            items={[
              { label: "Sent", value: `${p.amountInFormatted} ${p.originSymbol} on ${chainName(p.originChain)}` },
              { label: "1Click status", value: PAYMENT_STATUS[p.status] },
              { label: "Deposit address", value: p.depositAddress, mono: true },
              ...(p.originTxHash ? [{ label: "Origin chain tx", value: shortHash(p.originTxHash, 12, 10), mono: true }] : []),
              { label: "Quoted at", value: formatFull(p.quotedAt) },
            ]}
          />
          {p.nearTxHashes.length > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-sm text-text-2">Settlement transactions on NEAR</p>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                {p.nearTxHashes.map((h) => (
                  <li key={h}>
                    <ExplorerLink hash={h} url={o.demo ? "#demo" : links.explorerTx(h, settings.explorerTxUrl)} className="text-[13px]" />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function HowToVerify({ order: o, network }: { order: Order; network: string }) {
  const cmd = o.chainOrderId
    ? `near contract call-function as-read-only ${o.escrow} get_order json-args '{"order_id":"${o.chainOrderId}"}' network-config ${network} now`
    : null;
  return (
    <Card as="section" aria-labelledby="verify-heading">
      <h2 id="verify-heading" className="text-base font-semibold text-text">
        How to verify
      </h2>
      <p className="mt-1.5 text-sm leading-6 text-text-2">
        Each step is a call on the escrow contract. Open a link to see it on NearBlocks, or read the order straight from the contract — anyone can call the{" "}
        <code className="mono text-[12px]">get_order</code> view.
      </p>
      {cmd && (
        <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
          <code className="mono block text-[12px] break-all text-text">{cmd}</code>
          <CopyButton value={cmd} label="Copy command" size="sm" className="mt-2.5" />
        </div>
      )}
      <dl className="mt-4 flex flex-col gap-2 text-sm">
        {(
          [
            ["create_order", "registers price, deadline and buyer key"],
            ["ft_on_transfer", "USDC arrives; order becomes Funded"],
            ["confirm_by_buyer", "buyer's signature proves delivery"],
            ["confirm_by_checker", "courier report or 6-digit code"],
            ["release / refund", "pays the shop or returns the money"],
          ] as const
        ).map(([m, d]) => (
          <div key={m} className="flex flex-col">
            <dt className="mono text-[12px] text-text">{m}</dt>
            <dd className="text-text-3">{d}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function ProofSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading proof">
      <Card padding="lg">
        <div className="flex flex-col gap-6 md:flex-row md:justify-between">
          <div className="flex-1">
            <Skeleton className="h-7 w-32 rounded-full" />
            <Skeleton className="mt-5 h-4 w-48" />
            <Skeleton className="mt-2 h-8 w-3/4" />
            <SkeletonText lines={2} className="mt-5 max-w-md" />
          </div>
          <div className="flex flex-col gap-3 md:items-end">
            <Skeleton className="h-12 w-40" />
            <Skeleton className="h-11 w-56" />
          </div>
        </div>
      </Card>
      <Card>
        <Skeleton className="h-5 w-24" />
        <div className="mt-5 flex flex-col gap-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
