import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { countdownLabel, formatCountdown } from "../../lib/format";

/** Current time, re-rendered every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export interface CountdownProps {
  to: string;
  className?: string;
  onExpire?: () => void;
  expiredText?: string;
}

/** "04:59" / "3:04:59" / "2d 4h". Not a live region (it would be noisy); the label is for screen readers. */
export function Countdown({ to, className, onExpire, expiredText = "00:00" }: CountdownProps) {
  const now = useNow(1000);
  const left = Date.parse(to) - now;
  const fired = useRef(false);
  useEffect(() => {
    if (left <= 0 && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
    if (left > 0) fired.current = false;
  }, [left, onExpire]);
  return (
    <time dateTime={to} aria-label={countdownLabel(left)} className={clsx("tabular", className)}>
      {left <= 0 ? expiredText : formatCountdown(left)}
    </time>
  );
}
