import { clsx } from "clsx";
import { ChevronDown, CircleExclamationPoint } from "lucide-react";
import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export interface ControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  className?: string;
  /** Extra content on the right of the label row (e.g. a live estimate). */
  aside?: ReactNode;
  children: (control: ControlProps) => ReactNode;
}

/** Label + control + hint/error, with ids and aria wiring done for you. */
export function Field({ label, hint, error, optional, className, aside, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
          {optional && <span className="ml-1 font-normal text-text-3">(optional)</span>}
        </label>
        {aside && <div className="text-sm text-text-3">{aside}</div>}
      </div>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-danger" role="alert">
          <CircleExclamationPoint aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-sm text-text-3">
          {hint}
        </p>
      )}
    </div>
  );
}

const controlBase =
  "w-full rounded-lg border border-border bg-surface text-base text-text shadow-card placeholder:text-text-3 " +
  "transition-[border-color,box-shadow] duration-150 hover:border-border-strong focus:border-brand " +
  "aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-3";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
  mono?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ leading, trailing, mono, className, ref, ...rest }: InputProps) {
  const input = (
    <input
      ref={ref}
      className={clsx(controlBase, "h-11 px-3", mono && "font-mono text-[14px]", leading && "pl-10", trailing && "pr-16", className)}
      {...rest}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className="relative">
      {leading && <div className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-text-3">{leading}</div>}
      {input}
      {trailing && <div className="absolute inset-y-0 right-0 flex items-center pr-3 text-sm font-medium text-text-3">{trailing}</div>}
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ className, ref, rows = 3, ...rest }: TextareaProps) {
  return <textarea ref={ref} rows={rows} className={clsx(controlBase, "min-h-[88px] resize-y px-3 py-2.5 leading-6", className)} {...rest} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  ref?: Ref<HTMLSelectElement>;
}

export function Select({ className, children, ref, ...rest }: SelectProps) {
  return (
    <div className="relative">
      <select ref={ref} className={clsx(controlBase, "h-11 appearance-none pr-10 pl-3", className)} {...rest}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-3" />
    </div>
  );
}
