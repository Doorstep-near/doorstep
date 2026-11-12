import { clsx } from "clsx";
import type { Order } from "@doorstep/shared";
import { Check, CircleExclamationPoint, Clock, Undo2, X } from "lucide-react";
import { buildTimeline, type StepState, type TimelineStep } from "../../lib/status";
import { formatDateTime } from "../../lib/format";

const SR_STATE: Record<StepState, string> = {
  done: "completed",
  current: "in progress",
  upcoming: "not started",
  failed: "problem",
  stopped: "stopped",
  skipped: "skipped",
};

function StepIcon({ step }: { step: TimelineStep }) {
  const base = "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-200";
  switch (step.state) {
    case "done":
      return (
        <span className={clsx(base, "bg-brand text-on-brand")}>
          <Check aria-hidden className="size-4" strokeWidth={3} />
        </span>
      );
    case "current":
      return (
        <span className={clsx(base, "border-2 border-brand bg-surface text-brand")}>
          <span className="size-2.5 animate-pulse-dot rounded-full bg-brand" />
        </span>
      );
    case "failed":
      return (
        <span className={clsx(base, "bg-danger-bg text-danger")}>
          <CircleExclamationPoint aria-hidden className="size-4" strokeWidth={2.5} />
        </span>
      );
    case "stopped": {
      const Icon = step.key === "payout" ? Undo2 : step.label.includes("time") ? Clock : X;
      return (
        <span className={clsx(base, "bg-neutral-bg text-neutral")}>
          <Icon aria-hidden className="size-4" strokeWidth={2.5} />
        </span>
      );
    }
    case "skipped":
      return <span className={clsx(base, "border-2 border-dashed border-border bg-surface")} />;
    default:
      return <span className={clsx(base, "border-2 border-border bg-surface")} />;
  }
}

export interface OrderTimelineProps {
  order: Order;
  className?: string;
  /** Force a layout; by default it's vertical in narrow containers and horizontal in wide ones. */
  layout?: "auto" | "vertical";
}

/** Paid → Shipped → Delivered → Protection window → Paid out, with branches for disputes, refunds and expiry. */
export function OrderTimeline({ order, className, layout = "auto" }: OrderTimelineProps) {
  const steps = buildTimeline(order);
  const h = layout === "auto";
  return (
    <div className={clsx("@container", className)}>
      <ol aria-label="Order progress" className={clsx("flex flex-col", h && "@2xl:flex-row")}>
        {steps.map((s, i) => {
          const next = steps[i + 1];
          const lineDone = s.state === "done" && next && next.state !== "upcoming" && next.state !== "skipped";
          return (
            <li
              key={s.key}
              aria-current={s.state === "current" ? "step" : undefined}
              className={clsx("relative flex gap-3 pb-5 last:pb-0", h && "@2xl:flex-1 @2xl:flex-col @2xl:gap-2.5 @2xl:pr-3 @2xl:pb-0")}
            >
              {next && (
                <span
                  aria-hidden
                  className={clsx(
                    "absolute top-9 bottom-1 left-[15px] w-0.5 rounded-full",
                    h && "@2xl:top-[15px] @2xl:right-1 @2xl:bottom-auto @2xl:left-10 @2xl:h-0.5 @2xl:w-auto",
                    lineDone ? "bg-brand" : "bg-border",
                  )}
                />
              )}
              <StepIcon step={s} />
              <div className={clsx("min-w-0 pt-1", h && "@2xl:pt-0")}>
                <p
                  className={clsx(
                    "text-sm leading-5",
                    s.state === "current" && "font-semibold text-text",
                    s.state === "done" && "font-medium text-text",
                    s.state === "failed" && "font-semibold text-danger",
                    s.state === "stopped" && "font-semibold text-neutral",
                    (s.state === "upcoming" || s.state === "skipped") && "text-text-3",
                  )}
                >
                  {s.label}
                  <span className="sr-only"> — {SR_STATE[s.state]}</span>
                </p>
                {s.at && s.state !== "upcoming" && s.state !== "skipped" && (
                  <p className="tabular mt-0.5 text-xs text-text-3">
                    <time dateTime={s.at}>{formatDateTime(s.at)}</time>
                  </p>
                )}
                {s.detail && <p className="mt-0.5 text-xs text-text-2">{s.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
