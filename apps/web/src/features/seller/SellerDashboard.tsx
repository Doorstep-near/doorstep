import { clsx } from "clsx";
import type { SellerOrder, SellerSummary } from "@doorstep/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BadgeCheck, ChevronRight, CircleExclamationPoint, Inbox, Lock, Plus, Search, SearchX, Wallet, type LucideIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useDocumentTitle } from "../../components/layout/Layout";
import { Amount, Button, ButtonAnchor, ButtonLink, Card, EmptyState, ErrorState, Skeleton, StatusChip } from "../../components/ui";
import { api } from "../../lib/api";
import { relativeTime, usdc } from "../../lib/format";
import { qk, useAppSettings, useSellerMe } from "../../lib/query";
import { lastActivity } from "../../lib/status";
import { FILTERS, matchesFilter, matchesSearch, type OrderFilter } from "./sellerUtils";

export default function SellerDashboard() {
  useDocumentTitle("Dashboard");
  const me = useSellerMe();
  const summary = useQuery({ queryKey: qk.sellerSummary, queryFn: api.seller.summary, refetchInterval: 15_000 });
  const orders = useQuery({ queryKey: qk.sellerOrders, queryFn: api.seller.listOrders, refetchInterval: 10_000 });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-text-3">{me.data?.name ?? " "}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-text sm:text-3xl">Dashboard</h1>
        </div>
        <div className="hidden lg:block">
          <ButtonLink to="/seller/new" icon={<Plus aria-hidden className="size-4" />}>
            New order
          </ButtonLink>
        </div>
      </div>

      <KpiGrid summary={summary.data} loading={summary.isPending} error={summary.error} onRetry={() => summary.refetch()} />

      <OrdersSection orders={orders.data?.orders} loading={orders.isPending} error={orders.error} onRetry={() => orders.refetch()} />
    </div>
  );
}

// ------------------------------------------------------------------ KPIs

function Kpi({ label, icon: Icon, children, footer, accent }: { label: string; icon: LucideIcon; children: ReactNode; footer?: ReactNode; accent?: boolean }) {
  return (
    <Card padding="none" className={clsx("flex min-h-[148px] flex-col p-4 sm:p-5", accent && "border-waiting-bg ring-1 ring-waiting-bg")}>
      <div className="flex items-center gap-2 text-sm font-medium text-text-2">
        <span className={clsx("flex size-7 items-center justify-center rounded-lg", accent ? "bg-waiting-bg text-waiting" : "bg-brand-soft text-brand")}>
          <Icon aria-hidden className="size-4" />
        </span>
        {label}
      </div>
      <div className="mt-3 flex-1">{children}</div>
      {footer && <div className="mt-2 text-xs text-text-3">{footer}</div>}
    </Card>
  );
}

function KpiSkeleton() {
  return (
    <Card padding="none" className="flex min-h-[148px] flex-col p-4 sm:p-5" aria-hidden>
      <Skeleton className="h-7 w-28" />
      <Skeleton className="mt-4 h-8 w-24" />
      <Skeleton className="mt-2 h-3.5 w-16" />
    </Card>
  );
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function KpiGrid({ summary, loading, error, onRetry }: { summary: SellerSummary | undefined; loading: boolean; error: unknown; onRetry: () => void }) {
  const { inrPerUsd } = useAppSettings();
  if (error && !summary) return <ErrorState error={error} onRetry={onRetry} title="Couldn't load your numbers" />;
  if (loading || !summary) {
    return (
      <section aria-label="Summary" aria-busy="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </section>
    );
  }
  const c = summary.counts;
  const needs = c.toShip + c.disputed;
  const breakdown = [c.toShip ? `${c.toShip} to ship` : null, c.disputed ? plural(c.disputed, "dispute") : null].filter(Boolean).join(" · ");
  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <Kpi label="Held in escrow" icon={Lock} footer={`${plural(c.toShip + c.inTransit + c.inWindow + c.disputed, "order")} protected`}>
        <Amount units={summary.heldUnits} inrPerUsd={inrPerUsd} size="md" />
      </Kpi>
      <Kpi label="Paid out" icon={BadgeCheck} footer="All time, to NEAR Intents">
        <Amount units={summary.releasedUnits} inrPerUsd={inrPerUsd} size="md" />
      </Kpi>
      <Kpi label="Needs action" icon={CircleExclamationPoint} accent={needs > 0} footer={`${c.awaitingPayment} awaiting payment · ${c.inWindow} in protection window`}>
        <p className="tabular text-xl font-semibold text-text">{needs}</p>
        <p className="mt-0.5 text-xs text-text-2">{needs ? breakdown : "You're all caught up"}</p>
      </Kpi>
      <Kpi
        label="NEAR Intents balance"
        icon={Wallet}
        footer={
          <ButtonAnchor href={summary.intentsAppUrl} target="_blank" variant="secondary" size="sm" iconRight={<ArrowUpRight aria-hidden className="size-3.5" />} className="mt-1">
            Withdraw
          </ButtonAnchor>
        }
      >
        <Amount units={summary.intentsBalanceUnits} inrPerUsd={inrPerUsd} size="md" />
      </Kpi>
    </section>
  );
}

// ------------------------------------------------------------------ orders

function OrdersSection({ orders, loading, error, onRetry }: { orders: SellerOrder[] | undefined; loading: boolean; error: unknown; onRetry: () => void }) {
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, (orders ?? []).filter((o) => matchesFilter(o, f.key)).length])) as Record<OrderFilter, number>, [orders]);
  const visible = useMemo(() => (orders ?? []).filter((o) => matchesFilter(o, filter) && matchesSearch(o, query)), [orders, filter, query]);

  return (
    <section aria-labelledby="orders-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="orders-heading" className="text-lg font-semibold text-text">
          Orders
        </h2>
        <div className="relative sm:w-72">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search item, order id or phone"
            aria-label="Search orders"
            className="h-11 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-base text-text shadow-card placeholder:text-text-3 hover:border-border-strong focus:border-brand sm:text-sm"
          />
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Filter orders"
        onKeyDown={(e) => {
          const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          const i = FILTERS.findIndex((f) => f.key === filter);
          const next = FILTERS[(i + d + FILTERS.length) % FILTERS.length]!.key;
          setFilter(next);
          document.getElementById(`tab-${next}`)?.focus();
        }}
        className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              id={`tab-${f.key}`}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              aria-controls="orders-panel"
              onClick={() => setFilter(f.key)}
              className={clsx(
                "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors",
                active ? "border-text bg-text text-bg" : "border-border bg-surface text-text-2 hover:border-border-strong hover:text-text",
              )}
            >
              {f.label}
              <span className={clsx("tabular rounded-full px-1.5 text-xs", active ? "bg-bg/20 text-bg" : "bg-surface-2 text-text-3")}>{orders ? counts[f.key] : "–"}</span>
            </button>
          );
        })}
      </div>

      <div id="orders-panel" role="tabpanel" aria-labelledby={`tab-${filter}`}>
        {error && !orders ? (
          <ErrorState error={error} onRetry={onRetry} title="Couldn't load orders" />
        ) : loading || !orders ? (
          <OrdersSkeleton />
        ) : orders.length === 0 ? (
          <Card padding="none">
            <EmptyState
              icon={Inbox}
              title="No orders yet"
              description="Create a protected pay link and send it to your buyer on WhatsApp. They pay with any crypto; you're paid when it's delivered."
              action={
                <ButtonLink to="/seller/new" icon={<Plus aria-hidden className="size-4" />}>
                  Create your first order
                </ButtonLink>
              }
            />
          </Card>
        ) : visible.length === 0 ? (
          <Card padding="none">
            <EmptyState
              icon={SearchX}
              title="No orders match"
              description={query ? `Nothing matches “${query}” in this view.` : "There are no orders in this view right now."}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  Show all orders
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            <OrderCards orders={visible} />
            <OrderTable orders={visible} />
          </>
        )}
      </div>
    </section>
  );
}

function OrdersSkeleton() {
  return (
    <Card padding="none" aria-busy="true" aria-label="Loading orders">
      <ul className="divide-y divide-border">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="flex items-center gap-4 px-4 py-4 sm:px-5">
            <div className="flex-1">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="hidden h-4 w-16 sm:block" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Mobile: one card per order. */
function OrderCards({ orders }: { orders: SellerOrder[] }) {
  return (
    <ul className="flex flex-col gap-2 lg:hidden" aria-label="Orders">
      {orders.map((o) => (
        <li key={o.id}>
          <Link
            to={`/seller/orders/${o.id}`}
            className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong hover:bg-surface-2/40"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-[15px] font-semibold text-text">{o.item}</p>
              <p className="tabular shrink-0 text-[15px] font-semibold text-text">
                {usdc(o.priceUnits)} <span className="text-xs font-medium text-text-3">USDC</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusChip status={o.status} audience="seller" size="sm" />
              <span className="flex items-center gap-1 text-xs text-text-3">
                <span className="tabular">{o.buyer.phoneMasked ?? "—"}</span>
                <span aria-hidden>·</span>
                <span>{relativeTime(lastActivity(o))}</span>
                <ChevronRight aria-hidden className="size-4" />
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Desktop: a real table; the whole row is clickable, the item cell is the keyboard link. */
function OrderTable({ orders }: { orders: SellerOrder[] }) {
  const navigate = useNavigate();
  return (
    <Card padding="none" className="hidden overflow-hidden lg:block">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-surface-2/60 text-left text-xs font-medium tracking-wide text-text-3 uppercase">
          <tr>
            <th scope="col" className="px-5 py-3 font-medium">
              Order
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Buyer
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              Amount
            </th>
            <th scope="col" className="px-5 py-3 text-right font-medium">
              Updated
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {orders.map((o) => (
            <tr key={o.id} onClick={() => navigate(`/seller/orders/${o.id}`)} className="cursor-pointer transition-colors hover:bg-surface-2/50">
              <td className="max-w-[340px] px-5 py-3.5">
                <Link to={`/seller/orders/${o.id}`} onClick={(e) => e.stopPropagation()} className="block truncate rounded font-medium text-text hover:text-brand">
                  {o.item}
                </Link>
                <span className="mono text-[12px] text-text-3">{o.id}</span>
              </td>
              <td className="px-3 py-3.5">
                <StatusChip status={o.status} audience="seller" size="sm" />
              </td>
              <td className="tabular px-3 py-3.5 text-text-2">
                {o.buyer.phoneMasked ?? "—"}
                {o.delivery.area && <span className="block text-xs text-text-3">{o.delivery.area}</span>}
              </td>
              <td className="tabular px-3 py-3.5 text-right font-semibold text-text">
                {usdc(o.priceUnits)} <span className="text-xs font-medium text-text-3">USDC</span>
              </td>
              <td className="px-5 py-3.5 text-right text-text-3">
                <time dateTime={lastActivity(o)}>{relativeTime(lastActivity(o))}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
