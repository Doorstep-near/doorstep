import { clsx } from "clsx";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  description?: string;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  id?: string;
}

/** A radio group drawn as a segmented control. Arrow keys move the selection. */
export function SegmentedControl<T extends string>({ label, value, options, onChange, className, id }: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={clsx("grid gap-1 rounded-[10px] border border-border bg-surface-2 p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={clsx(
              "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150",
              selected ? "bg-surface text-text shadow-card ring-1 ring-border" : "text-text-2 hover:text-text",
            )}
          >
            <span className="flex items-center gap-1.5">
              {o.icon}
              {o.label}
            </span>
            {o.description && <span className="text-xs font-normal text-text-3">{o.description}</span>}
          </button>
        );
      })}
    </div>
  );
}
