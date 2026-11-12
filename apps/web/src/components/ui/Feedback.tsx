// Small feedback pieces: Skeleton, Spinner, EmptyState, Banner, ErrorState, CheckAnimation.
import { clsx } from "clsx";
import { CircleCheck, CircleExclamationPoint, CloudOff, Info, LoaderCircle, RefreshCw, TriangleExclamationPoint, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage, isApiError } from "../../lib/api";
import { isMock, setSandbox } from "../../lib/env";
import { Button } from "./Button";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("animate-shimmer rounded-md bg-surface-2", className)} />;
}

/** Text-line skeletons that match the height of real text. */
export function SkeletonText({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div className={clsx("flex flex-col gap-2", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={clsx("h-3.5", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex">
      <LoaderCircle aria-hidden className={clsx("size-5 animate-spin text-brand", className)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Icon aria-hidden className="size-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-text">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-text-2">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export type BannerTone = "info" | "warning" | "danger" | "success" | "neutral";

const bannerTone: Record<BannerTone, { box: string; icon: LucideIcon }> = {
  info: { box: "bg-transit-bg text-transit", icon: Info },
  warning: { box: "bg-waiting-bg text-waiting", icon: TriangleExclamationPoint },
  danger: { box: "bg-danger-bg text-danger", icon: CircleExclamationPoint },
  success: { box: "bg-success-bg text-success", icon: CircleCheck },
  neutral: { box: "bg-surface-2 text-text-2", icon: Info },
};

export function Banner({ tone = "info", title, children, icon, action, className, role }: { tone?: BannerTone; title?: ReactNode; children?: ReactNode; icon?: LucideIcon; action?: ReactNode; className?: string; role?: "alert" | "status" }) {
  const t = bannerTone[tone];
  const Icon = icon ?? t.icon;
  return (
    <div role={role} className={clsx("flex gap-3 rounded-xl px-4 py-3 text-sm", t.box, className)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && "mt-0.5", "opacity-95")}>{children}</div>}
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  );
}

/** Error card with a retry, and a way into the sandbox when the API can't be reached. */
export function ErrorState({ error, onRetry, title, className }: { error: unknown; onRetry?: () => void; title?: string; className?: string }) {
  const offline = isApiError(error, "network");
  const notFound = isApiError(error, "not_found");
  return (
    <div role="alert" className={clsx("flex flex-col items-center rounded-xl border border-border bg-surface px-6 py-10 text-center shadow-card", className)}>
      <div className={clsx("flex size-12 items-center justify-center rounded-full", notFound ? "bg-neutral-bg text-neutral" : "bg-danger-bg text-danger")}>
        {offline ? <CloudOff aria-hidden className="size-6" /> : <CircleExclamationPoint aria-hidden className="size-6" />}
      </div>
      <h2 className="mt-4 text-base font-semibold text-text">{title ?? (notFound ? "We couldn't find that" : offline ? "Can't reach Doorstep" : "Something went wrong")}</h2>
      <p className="mt-1 max-w-sm text-sm text-text-2">{errorMessage(error)}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {onRetry && !notFound && (
          <Button variant="secondary" icon={<RefreshCw aria-hidden className="size-4" />} onClick={onRetry}>
            Try again
          </Button>
        )}
        {offline && !isMock && (
          <Button variant="ghost" onClick={() => setSandbox(true)}>
            Use sample data instead
          </Button>
        )}
      </div>
    </div>
  );
}

/** Animated check used when money is secured or released. */
export function CheckAnimation({ size = 72, className, still }: { size?: number; className?: string; still?: boolean }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 56 56" className={clsx(!still && "check-anim", "text-brand", className)}>
      <circle cx="28" cy="28" r="26" fill="none" stroke="currentColor" strokeWidth="3" className="opacity-100" />
      <circle cx="28" cy="28" r="22" fill="currentColor" className="opacity-10" style={{ animation: "none", strokeDasharray: "none", strokeDashoffset: 0 }} />
      <path d="M17 28.5l7.5 7.5L39 21.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
