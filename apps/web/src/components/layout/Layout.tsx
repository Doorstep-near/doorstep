import { clsx } from "clsx";
import { FlaskConical, ShieldCheck } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router";
import { env, isMock, setSandbox } from "../../lib/env";
import { useAppSettings } from "../../lib/query";
import { Logo, ThemeToggle } from "../ui";

export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} · Doorstep`;
  }, [title]);
}

/** Slim top bar shown whenever no real money can move. */
export function DemoBanner() {
  const { demoMode } = useAppSettings();
  useEffect(() => {
    document.documentElement.style.setProperty("--banner-h", demoMode ? "36px" : "0px");
  }, [demoMode]);
  if (!demoMode) return null;
  const sandbox = isMock && !env.forcedMock;
  return (
    <div className="relative z-40 flex h-9 items-center justify-center gap-2 bg-waiting-bg px-4 py-1.5 text-center text-[13px] font-medium text-waiting">
      <FlaskConical aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">
        Demo mode — practice only, don't send real money{isMock ? <span className="hidden sm:inline"> · sample data lives in your browser</span> : null}
      </span>
      {sandbox && (
        <button type="button" onClick={() => setSandbox(false, "/")} className="ml-1 rounded underline underline-offset-2 hover:no-underline">
          Exit
        </button>
      )}
    </div>
  );
}

/** "Protected by Doorstep" badge for buyer pages. */
export function ProtectedBadge({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex h-7 items-center gap-1.5 rounded-full bg-brand-soft px-2.5 text-xs font-semibold text-brand", className)}>
      <ShieldCheck aria-hidden className="size-3.5" strokeWidth={2.5} />
      Protected by Doorstep
    </span>
  );
}

/** Mobile-first buyer page frame: max ~440px, centred. */
export function BuyerLayout({ header, children, footer = true, wide }: { header?: ReactNode; children: ReactNode; footer?: boolean; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
        <div className={clsx("mx-auto flex min-h-14 items-center justify-between gap-3 px-4", wide ? "max-w-5xl" : "max-w-[440px]")}>
          {header ?? <Logo size="sm" />}
          <ThemeToggle className="-mr-2" />
        </div>
      </header>
      <main id="main" className={clsx("mx-auto w-full flex-1 px-4 pt-5 pb-28", wide ? "max-w-5xl" : "max-w-[440px]")}>
        {children}
      </main>
      {footer && (
        <footer className={clsx("mx-auto w-full px-4 pb-8 text-center text-xs text-text-3", wide ? "max-w-5xl" : "max-w-[440px]")}>
          <p>
            Payments run on{" "}
            <span className="font-medium text-text-2">NEAR Intents</span> and a NEAR smart contract.{" "}
            <Link to="/" className="font-medium text-text-2 underline-offset-2 hover:underline">
              How Doorstep works
            </Link>
          </p>
        </footer>
      )}
    </div>
  );
}

/** Section heading used inside buyer cards ("1 · Pay with"). */
export function StepHeading({ n, children, id }: { n?: number; children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-[15px] font-semibold text-text">
      {n !== undefined && <span className="flex size-6 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-text-2 tabular">{n}</span>}
      {children}
    </h2>
  );
}
