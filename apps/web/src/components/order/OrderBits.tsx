// Order building blocks shared by the buyer, seller and proof screens.
import { clsx } from "clsx";
import type { Order, TxKind } from "@doorstep/shared";
import {
  BadgeCheck,
  CircleExclamationPoint,
  FileCheck,
  Gavel,
  Lock,
  PackageCheck,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { chainName } from "../../lib/chains";
import { formatDateTime, shortHash } from "../../lib/format";
import { TX_LABEL, TX_METHOD } from "../../lib/status";
import { DataList, ExplorerLink } from "../ui";

export const TX_ICON: Record<TxKind, LucideIcon> = {
  create: FileCheck,
  fund: Lock,
  ship: Truck,
  deliver: PackageCheck,
  complaint: CircleExclamationPoint,
  resolve: Gavel,
  release: BadgeCheck,
  refund: Undo2,
};

const TX_TONE: Partial<Record<TxKind, string>> = {
  complaint: "bg-danger-bg text-danger",
  refund: "bg-neutral-bg text-neutral",
  release: "bg-success-bg text-success",
  fund: "bg-brand-soft text-brand",
};

/** "https://nearblocks.io/txns/" -> "https://nearblocks.io/address/<account>". */
export function explorerAccountUrl(explorerTxUrl: string, account: string): string {
  return explorerTxUrl.replace(/\/txns?\/?$/, "/address/") + account;
}

/** Every on-chain step with its explorer link, oldest first. */
export function TxList({ order, showMethod = true, className }: { order: Order; showMethod?: boolean; className?: string }) {
  const txs = [...order.txs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (txs.length === 0) {
    return <p className={clsx("text-sm text-text-3", className)}>No on-chain transactions yet. The first one happens when the buyer opens the pay link.</p>;
  }
  return (
    <ol className={clsx("flex flex-col gap-3", className)}>
      {txs.map((t) => {
        const Icon = TX_ICON[t.kind];
        return (
          <li key={`${t.kind}-${t.hash}`} className="flex items-start gap-3">
            <span className={clsx("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", TX_TONE[t.kind] ?? "bg-surface-2 text-text-2")}>
              <Icon aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium text-text">{TX_LABEL[t.kind]}</p>
                <time dateTime={t.at} className="tabular text-xs text-text-3">
                  {formatDateTime(t.at)}
                </time>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                {showMethod && <span className="mono text-[12px] text-text-3">{TX_METHOD[t.kind]}</span>}
                <ExplorerLink hash={t.hash} url={t.url} className="text-[12px]" />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Technical facts for the "Details" area. */
export function OrderFacts({ order, explorerTxUrl, className }: { order: Order; explorerTxUrl: string; className?: string }) {
  const p = order.payment;
  const items = [
    { label: "Order id", value: order.id, mono: true },
    { label: "On-chain order id", value: order.chainOrderId ?? "Not on chain yet", mono: !!order.chainOrderId },
    {
      label: "Escrow contract",
      value: order.demo ? (
        order.escrow
      ) : (
        <a href={explorerAccountUrl(explorerTxUrl, order.escrow)} target="_blank" rel="noopener noreferrer" className="text-brand underline-offset-2 hover:underline">
          {order.escrow}
        </a>
      ),
      mono: true,
    },
    { label: "Shop account", value: order.shop.account, mono: true },
  ];
  if (order.buyer.refundAccount) items.push({ label: "Refund account", value: order.buyer.refundAccount, mono: true });
  if (order.buyer.publicKey) items.push({ label: "Buyer key", value: shortHash(order.buyer.publicKey, 14, 6), mono: true });
  if (p) {
    items.push({ label: "Paid with", value: `${p.amountInFormatted} ${p.originSymbol} on ${chainName(p.originChain)}`, mono: false });
    items.push({ label: "1Click deposit address", value: p.depositAddress, mono: true });
    if (p.originTxHash) items.push({ label: "Deposit tx", value: shortHash(p.originTxHash, 10, 8), mono: true });
    items.push({ label: "Origin refund address", value: p.refundTo, mono: true });
  }
  if (order.proof) items.push({ label: "Delivery proof", value: order.proof === "buyer" ? "Buyer's signature" : "Courier / delivery code (checker)", mono: false });
  return <DataList items={items} className={className} />;
}
