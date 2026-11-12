import { clsx } from "clsx";
import type { OrderStatus } from "@doorstep/shared";
import type { LucideIcon } from "lucide-react";
import { statusMeta, type Audience, type Tone } from "../../lib/status";

export const toneClass: Record<Tone, string> = {
  waiting: "bg-waiting-bg text-waiting",
  transit: "bg-transit-bg text-transit",
  success: "bg-success-bg text-success",
  danger: "bg-danger-bg text-danger",
  neutral: "bg-neutral-bg text-neutral",
};

export interface ChipProps {
  tone: Tone;
  icon?: LucideIcon;
  children: React.ReactNode;
  size?: "sm" | "md";
  className?: string;
}

/** Pill with an icon and a label, so status never relies on colour alone. */
export function Chip({ tone, icon: Icon, children, size = "md", className }: ChipProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-[13px]",
        toneClass[tone],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} strokeWidth={2.25} />}
      {children}
    </span>
  );
}

export function StatusChip({ status, audience = "buyer", size, className }: { status: OrderStatus; audience?: Audience; size?: "sm" | "md"; className?: string }) {
  const meta = statusMeta(status, audience);
  return (
    <Chip tone={meta.tone} icon={meta.icon} size={size} className={className}>
      {meta.label}
    </Chip>
  );
}
