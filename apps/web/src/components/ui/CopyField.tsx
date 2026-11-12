import { clsx } from "clsx";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers / insecure origins.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function useCopy(timeout = 1600) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      if (ok) {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), timeout);
      }
      return ok;
    },
    [timeout],
  );
  return { copied, copy };
}

export function CopyButton({ value, label = "Copy", className, size = "md" }: { value: string; label?: string; className?: string; size?: "sm" | "md" }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      className={clsx(
        "relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border font-medium transition-[background-color,border-color,color] duration-150",
        size === "md" ? "h-11 px-3.5 text-sm" : "h-8 px-2.5 text-xs before:absolute before:-inset-1.5 before:content-['']",
        copied ? "border-success-bg bg-success-bg text-success" : "border-border bg-surface text-text hover:border-border-strong hover:bg-surface-2",
        className,
      )}
    >
      {copied ? <Check aria-hidden className="size-4" strokeWidth={2.5} /> : <Copy aria-hidden className="size-4" />}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}

export interface CopyFieldProps {
  label?: ReactNode;
  value: string;
  /** What to show if it differs from what gets copied. */
  display?: ReactNode;
  mono?: boolean;
  large?: boolean;
  className?: string;
  copyLabel?: string;
}

/** A value with a copy button and "Copied" feedback. */
export function CopyField({ label, value, display, mono = true, large, className, copyLabel }: CopyFieldProps) {
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      {label && <span className="text-sm font-medium text-text-2">{label}</span>}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 py-1.5 pr-1.5 pl-3">
        <span className={clsx("min-w-0 flex-1 break-all text-text select-all", mono ? "mono" : "text-sm", large && "text-[15px] leading-6")} translate="no">
          {display ?? value}
        </span>
        <CopyButton value={value} label={copyLabel} size="md" />
      </div>
    </div>
  );
}
