import { clsx } from "clsx";
import { LoaderCircle } from "lucide-react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-soft";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "relative inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap select-none " +
  "transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 ease-out " +
  "active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-on-brand shadow-card hover:bg-brand-strong",
  secondary: "border border-border bg-surface text-text shadow-card hover:border-border-strong hover:bg-surface-2",
  ghost: "text-text-2 hover:bg-surface-2 hover:text-text",
  danger: "bg-danger text-on-danger shadow-card hover:opacity-90",
  "danger-soft": "border border-border bg-surface text-danger shadow-card hover:border-danger hover:bg-danger-bg",
};

// sm is 36px tall but its hit area is padded to 44px with a pseudo-element.
const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']",
  md: "h-11 px-4 text-[15px]",
  lg: "h-13 px-5 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", block = false, className?: string) {
  return clsx(base, variants[variant], sizes[size], block && "w-full", className);
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, CommonProps {
  loading?: boolean;
  loadingText?: string;
}

export function Button({ variant, size, block, icon, iconRight, loading, loadingText, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, block, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : icon}
      <span>{loading && loadingText ? loadingText : children}</span>
      {!loading && iconRight}
    </button>
  );
}

export function ButtonLink({ variant, size, block, icon, iconRight, className, children, ...rest }: LinkProps & CommonProps) {
  return (
    <Link className={buttonClass(variant, size, block, className)} {...rest}>
      {icon}
      <span>{children}</span>
      {iconRight}
    </Link>
  );
}

export function ButtonAnchor({ variant, size, block, icon, iconRight, className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & CommonProps) {
  const external = rest.target === "_blank";
  return (
    <a className={buttonClass(variant, size, block, className)} rel={external ? "noopener noreferrer" : undefined} {...rest}>
      {icon}
      <span>{children}</span>
      {iconRight}
    </a>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md";
}

/** Square icon-only button; `label` is its accessible name. */
export function IconButton({ label, size = "md", className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={clsx(
        "relative inline-flex shrink-0 items-center justify-center rounded-lg text-text-2 transition-colors duration-150 hover:bg-surface-2 hover:text-text disabled:opacity-50",
        size === "md" ? "size-11" : "size-9 before:absolute before:-inset-1 before:content-['']",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
