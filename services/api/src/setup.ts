// Wires the dependencies for demo mode (all fakes, no network) or live mode.
import { existsSync } from "node:fs";
import { NearAccountId } from "@doorstep/shared";
import { LiveBorzo } from "./borzo/client";
import { MockBorzo } from "./borzo/mock";
import { Checker } from "./checker";
import { allMerchants, merchantProblems, type Config } from "./config";
import { Db } from "./db";
import { Demo } from "./demo";
import { loadSignerFile, newSigner, type Ed25519Signer } from "./ed25519";
import { LiveEscrow, type Escrow } from "./near/escrow";
import { FakeEscrow } from "./near/fake-escrow";
import { createNearRelayer, MissingRelayer, type Relayer } from "./near/relayer";
import { rpcAccessKey, rpcViewer, type AccessKeyChecker } from "./near/rpc";
import { LiveOneClick } from "./oneclick/client";
import { FakeOneClick } from "./oneclick/fake";
import { Scheduler } from "./scheduler";
import { OrderService, type Deps, type Logger, type Trackers } from "./service";

export const consoleLogger: Logger = {
  info: (o, m) => console.log(JSON.stringify({ level: "info", msg: m, ...(o as object) })),
  warn: (o, m) => console.warn(JSON.stringify({ level: "warn", msg: m, ...(o as object) })),
  error: (o, m) => console.error(JSON.stringify({ level: "error", msg: m, ...(o as object) })),
};
export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export interface Wired {
  deps: Deps;
  svc: OrderService;
  scheduler: Scheduler;
  demo: Demo | null;
  warnings: string[];
}

export async function createDemo(config: Config, opts: { now?: () => number; log?: Logger; seed?: boolean } = {}): Promise<Wired> {
  const now = opts.now ?? Date.now;
  const checkerKey = newSigner(); // throwaway key; the fake escrow trusts it like the contract trusts checker_pk
  const escrow = new FakeEscrow(config.escrow, checkerKey.publicKey, config.complaintWindowMs, now);
  const oneclick = new FakeOneClick((msg, amount) => escrow.ftOnTransfer("intents.near", amount, msg), now);
  const borzo = new MockBorzo();
  const deps: Deps = {
    config,
    db: new Db(config.dbPath),
    escrow,
    oneclick,
    borzo,
    checker: new Checker(checkerKey, escrow, now),
    now,
    log: opts.log ?? consoleLogger,
  };
  const svc = new OrderService(deps);
  const demo = new Demo(svc, { escrow, oneclick, borzo }, deps.db, now);
  if (opts.seed !== false) await demo.seed();
  return { deps, svc, scheduler: new Scheduler(svc, deps), demo, warnings: [] };
}

export interface LiveOverrides {
  fetch?: typeof fetch;
  accessKey?: AccessKeyChecker;
  relayer?: Relayer;
  checkerSigner?: Ed25519Signer | null;
  escrow?: Escrow;
  now?: () => number;
  log?: Logger;
}

export async function createLive(config: Config, o: LiveOverrides = {}): Promise<Wired> {
  const missing = [
    !config.escrow && "ESCROW",
    !config.shopAccount && "SHOP_ACCOUNT (or SELLER)",
    !config.sellerToken && "SELLER_TOKEN",
  ].filter(Boolean);
  if (missing.length) throw new Error(`Missing settings in .env: ${missing.join(", ")}. Or run demo mode: npm run demo`);
  for (const [name, v] of [["ESCROW", config.escrow], ["SHOP_ACCOUNT", config.shopAccount]] as const) {
    if (!NearAccountId.safeParse(v).success) throw new Error(`${name} is not a valid NEAR account id`);
  }
  const shopProblems = merchantProblems(allMerchants(config));
  if (shopProblems.length) throw new Error(`Shop settings: ${shopProblems.join("; ")}`);

  const warnings: string[] = [];
  const now = o.now ?? Date.now;
  const fetchFn = o.fetch ?? fetch;

  let relayer = o.relayer;
  if (!relayer) {
    if (!config.relayerAccount) {
      relayer = new MissingRelayer("No relayer account: set RELAYER_ACCOUNT (or RELAYER)");
      warnings.push("RELAYER_ACCOUNT is not set; on-chain calls will fail.");
    } else if (!existsSync(config.relayerKeyFile)) {
      relayer = new MissingRelayer("Relayer key missing: run scripts/add-relayer-key.sh");
      warnings.push(`Relayer key file not found (${config.relayerKeyFile}); run scripts/add-relayer-key.sh.`);
    } else {
      const r = await createNearRelayer({
        network: config.network,
        rpcUrl: config.rpcUrl,
        accountId: config.relayerAccount,
        keyFile: config.relayerKeyFile,
        contractId: config.escrow,
      });
      relayer = r.relayer;
    }
  }

  let checkerSigner = o.checkerSigner;
  if (checkerSigner === undefined) {
    checkerSigner = existsSync(config.checkerKeyFile) ? loadSignerFile(config.checkerKeyFile) : null;
    if (!checkerSigner) warnings.push(`Checker key file not found (${config.checkerKeyFile}); courier/code confirmations will fail.`);
  }

  const escrow = o.escrow ?? new LiveEscrow(config.escrow, rpcViewer(config.rpcUrl, fetchFn), relayer);
  const deps: Deps = {
    config,
    db: new Db(config.dbPath),
    escrow,
    oneclick: new LiveOneClick(config.oneclickUrl, { apiKey: config.oneclickApiKey, jwt: config.oneclickJwt }, fetchFn),
    borzo: new LiveBorzo(config.borzoBaseUrl, config.borzoAuthToken, fetchFn),
    checker: new Checker(checkerSigner, escrow, now),
    now,
    log: o.log ?? consoleLogger,
    accessKey: o.accessKey ?? rpcAccessKey(config.rpcUrl, fetchFn),
  };
  if (config.ship24ApiKey) deps.trackers = ship24Trackers(config.ship24ApiKey, fetchFn);
  if (!config.borzoAuthToken) warnings.push("BORZO_AUTH_TOKEN is not set; Borzo shipping is off (tracking and hand delivery still work).");
  if (!config.borzoCallbackSecret) warnings.push("BORZO_CALLBACK_SECRET is not set; Borzo webhooks will be rejected.");
  if (!config.oneclickApiKey && !config.oneclickJwt) warnings.push("No ONECLICK_API_KEY or ONECLICK_JWT; 1Click adds a 0.1% fee.");

  const svc = new OrderService(deps);
  return { deps, svc, scheduler: new Scheduler(svc, deps), demo: null, warnings };
}

/** Live-mode startup checks against the deployed contract. Read-only; never throws. */
export async function checkContract(w: Wired): Promise<string[]> {
  const out: string[] = [];
  const { escrow, config, checker } = w.deps;
  try {
    const cfg = await escrow.getConfig();
    const window = Number(cfg.complaint_window_ms);
    if (Number.isFinite(window) && window > 0) w.svc.windowMs = window;
    if (checker.publicKey && cfg.checker_pk !== checker.publicKey) out.push(`Checker key mismatch: the contract trusts ${cfg.checker_pk}, our key is ${checker.publicKey}.`);
    if (config.relayerAccount && cfg.relayer !== config.relayerAccount && cfg.owner !== config.relayerAccount) {
      out.push(`The contract's relayer is ${cfg.relayer}, but RELAYER_ACCOUNT is ${config.relayerAccount}; create_order will fail.`);
    }
    if (!(await escrow.usdcRegistered())) out.push(`${escrow.account} is not registered with USDC; real quotes are refused until it is.`);
  } catch (e) {
    out.push(`Could not read the escrow config: ${(e as Error).message}`);
  }
  return out;
}

/** Ship24 "create a tracker" (https://docs.ship24.com): Bearer API key; the courier is auto-detected. */
export function ship24Trackers(apiKey: string, fetchFn: typeof fetch = fetch): Trackers {
  return {
    async register(trackingNumber, orderRef) {
      const res = await fetchFn("https://api.ship24.com/public/v1/trackers", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ trackingNumber, shipmentReference: orderRef }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Ship24 HTTP ${res.status}`);
    },
  };
}
