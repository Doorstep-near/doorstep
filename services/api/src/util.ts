import { randomBytes } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Random base62 id with rejection sampling (no modulo bias). */
export function randomId(length = 12): string {
  let out = "";
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < 248 && out.length < length) out += BASE62[b % 62];
    }
  }
  return out;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function b58encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function b58decode(str: string): Uint8Array {
  let n = 0n;
  for (const ch of str) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error("Bad base58 character");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const ch of str) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** A random 32-byte base58 string shaped like a NEAR tx hash (demo mode only). */
export const fakeTxHash = () => b58encode(randomBytes(32));

export const iso = (ms: number | null | undefined): string | null => (ms == null ? null : new Date(ms).toISOString());

/** "+91 98765 43210" -> "+91 98•••••210". Keeps the country code, first 2 and last 3 digits. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "•".repeat(digits.length);
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : "";
  const masked = `${national.slice(0, 2)}${"•".repeat(Math.max(1, national.length - 5))}${national.slice(-3)}`;
  return cc ? `+${cc} ${masked}` : masked;
}

/** "1.5", 6 -> 1500000n. Truncates extra decimals. */
export function decimalToUnits(amount: string, decimals: number): bigint {
  const [whole = "0", frac = ""] = amount.split(".");
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac.slice(0, decimals) || "0").padEnd(decimals, "0"));
}

export function unitsToDecimal(units: bigint, decimals: number, maxFraction = 6): string {
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  let frac = (units % scale).toString().padStart(decimals, "0").slice(0, maxFraction);
  frac = frac.replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
