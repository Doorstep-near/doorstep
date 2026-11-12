import { clsx } from "clsx";
import { inrEstimate } from "@doorstep/shared";
import { usdc } from "../../lib/format";

export interface AmountProps {
  units: string;
  inrPerUsd?: number;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  /** Show "≈ ₹…" next to (row) or under (stack) the USDC figure. */
  inr?: "stack" | "row" | false;
  currency?: string;
}

const numberSize = { sm: "text-base", md: "text-xl", lg: "text-3xl", xl: "text-4xl sm:text-5xl" };
const unitSize = { sm: "text-xs", md: "text-sm", lg: "text-base", xl: "text-lg" };

/** Money is the hero: big USDC with a rupee estimate. */
export function Amount({ units, inrPerUsd, size = "lg", className, inr = "stack", currency = "USDC" }: AmountProps) {
  const value = usdc(units);
  const rupees = inrPerUsd ? inrEstimate(units, inrPerUsd) : null;
  return (
    <div className={clsx("flex", inr === "row" ? "flex-row flex-wrap items-baseline gap-x-2" : "flex-col", className)}>
      <span className="flex items-baseline gap-1.5">
        <span className={clsx("tabular font-semibold tracking-tight text-text", numberSize[size])}>{value}</span>
        <span className={clsx("font-semibold text-text-2", unitSize[size])}>{currency}</span>
      </span>
      {inr && rupees && (
        <span className={clsx("tabular text-text-3", size === "xl" || size === "lg" ? "text-sm" : "text-xs")}>
          ≈ {rupees}
          <span className="sr-only"> (estimate)</span>
        </span>
      )}
    </div>
  );
}
