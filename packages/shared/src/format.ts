import { EXPLORER_TX_URL, USDC_DECIMALS } from "./constants";

const SCALE = 10n ** BigInt(USDC_DECIMALS);

/** "2" -> "2000000", "1.5" -> "1500000". Throws on bad input or more than 6 decimals. */
export function usdcToUnits(amount: string): string {
  const s = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Not a USDC amount: "${amount}"`);
  const [whole = "0", frac = ""] = s.split(".");
  if (frac.length > USDC_DECIMALS) throw new Error("USDC has at most 6 decimals");
  return (BigInt(whole) * SCALE + BigInt(frac.padEnd(USDC_DECIMALS, "0") || "0")).toString();
}

/** "2000000" -> "2.00" (fractionDigits 2..6; trailing digits beyond 2 kept only if non-zero). */
export function unitsToUsdc(units: string, maxFractionDigits = 2): string {
  const n = BigInt(units);
  const whole = n / SCALE;
  const frac = (n % SCALE).toString().padStart(USDC_DECIMALS, "0");
  let shown = frac.slice(0, Math.max(2, maxFractionDigits));
  while (shown.length > 2 && shown.endsWith("0")) shown = shown.slice(0, -1);
  return `${whole.toString()}.${shown}`;
}

/** "2000000" -> "$2.00" */
export function formatUsd(units: string): string {
  return `$${unitsToUsdc(units)}`;
}

/** Rough rupee estimate for display only: "2000000" at 84.2 -> "₹168". */
export function inrEstimate(units: string, inrPerUsd: number): string {
  const usd = Number(BigInt(units)) / Number(SCALE);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(usd * inrPerUsd);
}

/** Standard base64 <-> base64url (for putting signatures and keys in URL fragments). */
export function base64ToBase64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function base64UrlToBase64(b64url: string): string {
  const s = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return s + "=".repeat((4 - (s.length % 4)) % 4);
}

/** Every URL the apps hand around. `webUrl` has no trailing slash. */
export const links = {
  /** Seller shares this with the buyer. */
  pay: (webUrl: string, id: string) => `${webUrl}/pay/${id}`,
  /** Buyer's order page. With `keyB64Url`, it doubles as the private "order pass" backup (key stays in the fragment, never sent to a server). */
  order: (webUrl: string, id: string, keyB64Url?: string) => `${webUrl}/o/${id}${keyB64Url ? `#k=${keyB64Url}` : ""}`,
  /** Encoded in the buyer's delivery-pass QR; opening it submits confirm_by_buyer. `signatureB64` is standard base64. */
  confirm: (webUrl: string, id: string, signatureB64: string) => `${webUrl}/confirm/${id}#sig=${base64ToBase64Url(signatureB64)}`,
  /** Public page listing every on-chain step with explorer links. */
  proof: (webUrl: string, id: string) => `${webUrl}/proof/${id}`,
  explorerTx: (hash: string, base: string = EXPLORER_TX_URL) => `${base}${hash}`,
};
