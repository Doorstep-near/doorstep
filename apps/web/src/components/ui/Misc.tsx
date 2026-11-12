// Brand, theme, explorer links and the Details disclosure.
import { clsx } from "clsx";
import { ChevronDown, ExternalLink, Moon, PackageCheck, Sun } from "lucide-react";
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router";
import { shortHash } from "../../lib/format";

// ------------------------------------------------------------------ brand

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span className={clsx("inline-flex shrink-0 items-center justify-center rounded-[9px] bg-brand-soft text-brand", className)} style={{ width: size, height: size }} aria-hidden>
      <PackageCheck style={{ width: size * 0.58, height: size * 0.58 }} strokeWidth={2.1} />
    </span>
  );
}

export function Logo({ to = "/", size = "md", className, suffix }: { to?: string | null; size?: "sm" | "md"; className?: string; suffix?: ReactNode }) {
  const content = (
    <>
      <LogoMark size={size === "sm" ? 26 : 32} />
      <span className={clsx("font-semibold tracking-tight text-text", size === "sm" ? "text-[15px]" : "text-lg")}>Doorstep</span>
      {suffix}
    </>
  );
  if (to === null) return <span className={clsx("inline-flex items-center gap-2", className)}>{content}</span>;
  return (
    <Link to={to} className={clsx("inline-flex items-center gap-2 rounded-lg", className)} aria-label="Doorstep home">
      {content}
    </Link>
  );
}

/** GitHub mark (lucide v1 dropped brand icons). */
export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

// ------------------------------------------------------------------ theme

type Theme = "light" | "dark";
const THEME_KEY = "doorstep:theme";
const themeListeners = new Set<() => void>();

const readTheme = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

function storedTheme(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function applyTheme(t: Theme, persist: boolean) {
  document.documentElement.classList.toggle("dark", t === "dark");
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* ignore */
    }
  }
  themeListeners.forEach((l) => l());
}

// Follow the OS preference until the person picks a theme.
if (typeof window !== "undefined") {
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", (e) => {
    if (!storedTheme()) applyTheme(e.matches ? "dark" : "light", false);
  });
}

function subscribeTheme(cb: () => void) {
  themeListeners.add(cb);
  return () => themeListeners.delete(cb);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "light" as Theme);
  const setTheme = useCallback((t: Theme) => applyTheme(t, true), []);
  return { theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={clsx("relative inline-flex size-10 items-center justify-center rounded-lg text-text-2 transition-colors hover:bg-surface-2 hover:text-text", className)}
    >
      {theme === "dark" ? <Sun aria-hidden className="size-[18px]" /> : <Moon aria-hidden className="size-[18px]" />}
    </button>
  );
}

// ------------------------------------------------------------------ explorer

export function ExplorerLink({ hash, url, className, label }: { hash: string; url: string; className?: string; label?: string }) {
  const demo = !url || url.startsWith("#");
  if (demo) {
    return (
      <span className={clsx("inline-flex items-center gap-1.5 text-text-3", className)} title="Demo transaction — not on chain">
        <span className="mono">{shortHash(hash)}</span>
        <span className="rounded-full bg-neutral-bg px-1.5 py-px text-[11px] font-medium text-neutral">demo</span>
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx("inline-flex items-center gap-1 rounded text-brand underline-offset-2 hover:underline", className)}
      aria-label={`${label ?? "View transaction"} ${shortHash(hash)} on NearBlocks (opens in a new tab)`}
    >
      <span className="mono">{label ?? shortHash(hash)}</span>
      <ExternalLink aria-hidden className="size-3.5" />
    </a>
  );
}

// ------------------------------------------------------------------ disclosure

export function Disclosure({ summary, children, className, defaultOpen }: { summary: ReactNode; children: ReactNode; className?: string; defaultOpen?: boolean }) {
  return (
    <details className={clsx("group rounded-xl border border-border bg-surface shadow-card", className)} open={defaultOpen}>
      <summary className="flex min-h-12 list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium text-text select-none hover:bg-surface-2/60">
        {summary}
        <ChevronDown aria-hidden className="size-4 text-text-3 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-4 py-4">{children}</div>
    </details>
  );
}
