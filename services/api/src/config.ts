import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { API_PORT, EXPLORER_TX_URL, NearAccountId } from "@doorstep/shared";
import { z } from "zod";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** A shop that sells through Doorstep. Each has its own seller token and payout account. */
export interface Merchant {
  /** Short id, e.g. "eraya". The shop from SHOP_* settings is "main". */
  id: string;
  name: string;
  /** NEAR account (or lowercase 0x… account in NEAR Intents) that receives payouts. */
  account: string;
  token: string;
  /** Pickup address and phone, needed only for Borzo bookings. */
  address: string;
  phone: string;
}

const MerchantEntry = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,32}$/, "id: 2-32 lowercase letters, digits or -"),
  name: z.string().trim().min(1).max(80),
  account: NearAccountId,
  token: z.string().min(16, "token: at least 16 characters"),
  address: z.string().default(""),
  phone: z.string().default(""),
});

/** Reads extra shops from MERCHANTS_FILE (a JSON array). Throws with a clear message if the file is wrong. */
export function loadMerchants(path: string): Merchant[] {
  if (!path) return [];
  if (!existsSync(path)) throw new Error(`MERCHANTS_FILE not found: ${path}`);
  const parsed = z.array(MerchantEntry).safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`MERCHANTS_FILE is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return parsed.data;
}

/** Every shop: the one from SHOP_* settings ("main") first, then MERCHANTS_FILE. */
export function allMerchants(c: Config): Merchant[] {
  const main: Merchant[] =
    c.sellerToken && c.shopAccount ? [{ id: "main", name: c.shopName, account: c.shopAccount, token: c.sellerToken, address: c.shopAddress, phone: c.shopPhone }] : [];
  return [...main, ...c.merchants];
}

/** Problems that make the shop list unsafe (duplicate ids, tokens or payout accounts). */
export function merchantProblems(list: Merchant[]): string[] {
  const out: string[] = [];
  for (const key of ["id", "token", "account"] as const) {
    const seen = new Set<string>();
    for (const m of list) {
      if (seen.has(m[key])) out.push(key === "token" ? `two shops share a seller token (${m.id})` : `duplicate ${key}: ${m[key]}`);
      seen.add(m[key]);
    }
  }
  return out;
}

export interface Config {
  demoMode: boolean;
  port: number;
  host: string;
  webUrl: string;
  /** Extra web origins allowed by CORS besides webUrl (e.g. a second host for the web app). */
  corsOrigins: string[];
  sellerToken: string;
  shopName: string;
  shopAccount: string;
  shopAddress: string;
  shopPhone: string;
  /** Path of the JSON file with extra shops (MERCHANTS_FILE), or "". */
  merchantsFile: string;
  /** Extra shops from MERCHANTS_FILE. Use allMerchants() for the full list. */
  merchants: Merchant[];
  inrPerUsd: number;
  dbPath: string;
  network: "mainnet" | "testnet";
  rpcUrl: string;
  escrow: string;
  relayerAccount: string;
  relayerKeyFile: string;
  checkerKeyFile: string;
  complaintWindowMs: number;
  oneclickUrl: string;
  oneclickApiKey: string;
  oneclickJwt: string;
  borzoBaseUrl: string;
  borzoAuthToken: string;
  borzoCallbackSecret: string;
  ship24ApiKey: string;
  ship24WebhookSecret: string;
  schedulerIntervalMs: number;
  explorerTxUrl: string;
}

/** Loads the repo-root .env (if any) into process.env. Never prints values. */
export function loadEnvFile(): void {
  const path = resolve(REPO_ROOT, ".env");
  if (existsSync(path)) process.loadEnvFile(path);
}

const str = (env: NodeJS.ProcessEnv, key: string, fallback = "") => {
  const v = env[key];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
};
const num = (env: NodeJS.ProcessEnv, key: string, fallback: number) => {
  const v = Number(str(env, key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const fromRoot = (p: string) => resolve(REPO_ROOT, p);

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const demoMode = /^(1|true|yes)$/i.test(str(env, "DEMO_MODE"));
  const network = str(env, "NETWORK", "mainnet") === "testnet" ? "testnet" : "mainnet";
  const explorerTxUrl = network === "testnet" ? "https://testnet.nearblocks.io/txns/" : EXPLORER_TX_URL;
  return {
    demoMode,
    // Hosts such as Render set PORT; API_PORT wins when both are set.
    port: num(env, "API_PORT", num(env, "PORT", API_PORT)),
    host: str(env, "API_HOST", "localhost"),
    webUrl: str(env, "WEB_URL", "http://localhost:5173").replace(/\/+$/, ""),
    corsOrigins: str(env, "CORS_ORIGINS")
      .split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    // Demo mode always uses "demo", so a real token from .env is never printed or needed.
    sellerToken: demoMode ? "demo" : str(env, "SELLER_TOKEN"),
    shopName: demoMode ? "Eraya Foods (demo)" : str(env, "SHOP_NAME", "My shop"),
    // In demo mode no real account is used, so the names are fixed and clearly fake.
    shopAccount: demoMode ? "eraya-foods.doorstep-demo.near" : str(env, "SHOP_ACCOUNT", str(env, "SELLER")),
    shopAddress: str(env, "SHOP_ADDRESS", demoMode ? "Shop 4, Sector 18 Market, Noida, Uttar Pradesh" : ""),
    shopPhone: str(env, "SHOP_PHONE", demoMode ? "+91 98100 00000" : ""),
    // Extra shops also work in demo mode (payouts there are fake), e.g. to show two shops side by side.
    merchantsFile: str(env, "MERCHANTS_FILE") ? fromRoot(str(env, "MERCHANTS_FILE")) : "",
    merchants: str(env, "MERCHANTS_FILE") ? loadMerchants(fromRoot(str(env, "MERCHANTS_FILE"))) : [],
    inrPerUsd: num(env, "INR_PER_USD", 84.2),
    dbPath: demoMode ? ":memory:" : fromRoot(str(env, "DB_PATH", "data/doorstep.sqlite")),
    network,
    rpcUrl: str(env, "NEAR_RPC", network === "testnet" ? "https://rpc.testnet.fastnear.com" : "https://rpc.mainnet.fastnear.com"),
    escrow: demoMode ? "escrow.doorstep-demo.near" : str(env, "ESCROW"),
    relayerAccount: str(env, "RELAYER_ACCOUNT", str(env, "RELAYER")),
    relayerKeyFile: fromRoot(str(env, "RELAYER_KEY_FILE", ".keys/relayer.json")),
    checkerKeyFile: fromRoot(str(env, "CHECKER_KEY_FILE", ".keys/checker.json")),
    complaintWindowMs: demoMode ? num(env, "DEMO_COMPLAINT_WINDOW_MS", 120_000) : num(env, "COMPLAINT_WINDOW_MS", 600_000),
    oneclickUrl: str(env, "ONECLICK_URL", "https://1click.chaindefuser.com").replace(/\/+$/, ""),
    oneclickApiKey: str(env, "ONECLICK_API_KEY"),
    oneclickJwt: str(env, "ONECLICK_JWT"),
    // Borzo's docs (https://borzodelivery.com/in/business-api/doc) list 1.8 as the current version.
    borzoBaseUrl: str(env, "BORZO_BASE_URL", "https://robotapitest-in.borzodelivery.com/api/business/1.8").replace(/\/+$/, ""),
    borzoAuthToken: str(env, "BORZO_AUTH_TOKEN"),
    borzoCallbackSecret: str(env, "BORZO_CALLBACK_SECRET"),
    ship24ApiKey: str(env, "SHIP24_API_KEY"),
    ship24WebhookSecret: str(env, "SHIP24_WEBHOOK_SECRET"),
    schedulerIntervalMs: num(env, "SCHEDULER_INTERVAL_MS", demoMode ? 3_000 : 60_000),
    explorerTxUrl,
  };
}
