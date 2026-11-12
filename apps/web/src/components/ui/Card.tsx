import { clsx } from "clsx";
import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: "none" | "sm" | "md" | "lg";
  as?: "div" | "section" | "article" | "aside";
  raised?: boolean;
}

const pad = { none: "", sm: "p-4", md: "p-5", lg: "p-6 sm:p-8" };

export function Card({ padding = "md", as: As = "div", raised, className, ...rest }: CardProps) {
  return <As className={clsx("rounded-xl border border-border bg-surface", raised ? "shadow-raised" : "shadow-card", pad[padding], className)} {...rest} />;
}

export function CardHeader({ title, description, action, icon, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex items-start justify-between gap-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">{icon}</div>}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-text-2">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Label/value rows for summaries and receipts. */
export function DataList({ items, className }: { items: { label: ReactNode; value: ReactNode; mono?: boolean }[]; className?: string }) {
  return (
    <dl className={clsx("divide-y divide-border", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-start justify-between gap-4 py-2.5 text-sm first:pt-0 last:pb-0">
          <dt className="shrink-0 text-text-2">{it.label}</dt>
          <dd className={clsx("min-w-0 text-right font-medium break-words text-text", it.mono && "mono font-normal break-all")}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
