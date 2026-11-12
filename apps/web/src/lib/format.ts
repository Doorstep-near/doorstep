import { unitsToUsdc } from "@doorstep/shared";

/** "2000000" -> "2.00" (always 2 decimals; more only if they matter, up to 6). */
export function usdc(units: string, maxFraction = 2): string {
  try {
    return unitsToUsdc(units, maxFraction);
  } catch {
    return "0.00";
  }
}

const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const fullFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatFull = (iso: string) => fullFmt.format(new Date(iso));

/** "just now", "5 min ago", "in 3 h", "2 days ago". */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const future = diff > 0;
  const fmt = (n: number, unit: string) => (future ? `in ${n} ${unit}` : `${n} ${unit} ago`);
  if (abs < 45_000) return future ? "in a moment" : "just now";
  if (abs < 3_600_000) return fmt(Math.round(abs / 60_000), "min");
  if (abs < 86_400_000) return fmt(Math.round(abs / 3_600_000), "h");
  const days = Math.round(abs / 86_400_000);
  return fmt(days, days === 1 ? "day" : "days");
}

/** Countdown text: "04:59" under an hour, "3:04:59" under a day, then "2d 4h". */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/** Spoken form for screen readers: "4 minutes 59 seconds". */
export function countdownLabel(ms: number): string {
  if (ms <= 0) return "time is up";
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d} day${d === 1 ? "" : "s"}`);
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m && !d) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (!d && !h) parts.push(`${total % 60} seconds`);
  return parts.join(" ");
}

export function shortHash(hash: string, head = 6, tail = 4): string {
  return hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** Splits a 6-digit code for legibility: "482913" -> "482 913". */
export function groupCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
