import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { API_PORT, EXPLORER_TX_URL } from "@doorstep/shared";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface Config {
  demoMode: boolean;
  port: number;
  host: string;
  webUrl: string;
  sellerToken: string;
  shopName: string;
  shopAccount: string;
  shopAddress: string;
  shopPhone: string;
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
    // Demo mode always uses "demo", so a real token from .env is never printed or needed.
    sellerToken: demoMode ? "demo" : str(env, "SELLER_TOKEN"),
    shopName: demoMode ? "Eraya Foods (demo)" : str(env, "SHOP_NAME", "My shop"),
    // In demo mode no real account is used, so the names are fixed and clearly fake.
    shopAccount: demoMode ? "eraya-foods.doorstep-demo.near" : str(env, "SHOP_ACCOUNT", str(env, "SELLER")),
    shopAddress: str(env, "SHOP_ADDRESS", demoMode ? "Shop 4, Sector 18 Market, Noida, Uttar Pradesh" : ""),
    shopPhone: str(env, "SHOP_PHONE", demoMode ? "+91 98100 00000" : ""),
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
