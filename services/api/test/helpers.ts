import { USDC_NEAR_ASSET } from "@doorstep/shared";
import { buildApp } from "../src/app";
import { LiveEscrow } from "../src/near/escrow";
import { createLive, silentLogger } from "../src/setup";
import { readConfig, type Config } from "../src/config";
import { signerFromNearSecret, type Ed25519Signer } from "../src/ed25519";
import type { ChainOrder, EscrowConfig, TxResult, Unmatched } from "../src/near/escrow";
import type { Relayer } from "../src/near/relayer";
import type { Viewer } from "../src/near/rpc";
import { b58encode } from "../src/util";

export const ESCROW = "escrow.test.near";
export const SHOP = "shop.test.near";
export const SELLER_TOKEN = "s3cret-seller-token";

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    ...readConfig({}),
    demoMode: false,
    escrow: ESCROW,
    shopAccount: SHOP,
    shopName: "Test Shop",
    shopAddress: "1 Market Road, Noida",
    shopPhone: "+91 98100 00000",
    sellerToken: SELLER_TOKEN,
    dbPath: ":memory:",
    borzoAuthToken: "borzo-test-token",
    borzoCallbackSecret: "borzo-callback-secret",
    ship24WebhookSecret: "ship24-secret",
    oneclickApiKey: "oneclick-test-key",
    webUrl: "http://localhost:5173",
    ...over,
  };
}

/** A FIXED ed25519 key (seed 0x00..0x1f), so signatures are reproducible. */
export const FIXED_SEED = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
export const fixedKey = (seed: Buffer = FIXED_SEED): Ed25519Signer => signerFromNearSecret("ed25519:" + b58encode(seed));

export class Clock {
  constructor(public t = Date.parse("2026-11-13T10:00:00Z")) {}
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

/** In-memory "chain" for live-mode tests: a viewer that serves get_order etc., and a relayer that records calls. */
export class StubChain {
  orders = new Map<string, ChainOrder>();
  unmatched: Unmatched[] = [];
  usdcRegistered = true;
  intents = "0";
  config: Partial<EscrowConfig> = { complaint_window_ms: "600000" };
  calls: { method: string; args: Record<string, unknown>; gasTgas: number }[] = [];
  /** Optional per-method behaviour (mutate state, throw, delay). */
  onCall: Record<string, (args: Record<string, unknown>) => unknown | Promise<unknown>> = {};
  nextId = 1;
  viewCount: Record<string, number> = {};
  /** Access keys for wallet sign-in tests: "account|ed25519:..." -> kind. */
  accessKeys = new Map<string, "full" | "function">();

  viewer: Viewer = async <T>(contract: string, method: string, args: Record<string, unknown>): Promise<T> => {
    this.viewCount[method] = (this.viewCount[method] ?? 0) + 1;
    if (method === "get_order") return (structuredClone(this.orders.get(String(args.order_id))) ?? null) as T;
    if (method === "get_unmatched") return structuredClone(this.unmatched) as T;
    if (method === "get_config") return this.config as T;
    if (method === "storage_balance_of") return (this.usdcRegistered ? { total: "1250000000000000000000", available: "0" } : null) as T;
    if (method === "mt_balance_of") return this.intents as T;
    throw new Error(`unexpected view ${contract}.${method}`);
  };

  relayer: Relayer = {
    call: async (method, args, gasTgas): Promise<TxResult> => {
      this.calls.push({ method, args, gasTgas });
      let value: unknown = null;
      if (this.onCall[method]) value = await this.onCall[method]!(args);
      else if (method === "create_order") {
        const id = String(this.nextId++);
        this.orders.set(id, chainOrder({ id, ...(args as object) } as Partial<ChainOrder>));
        value = id;
      }
      return { hash: `hash-${method}-${this.calls.length}`, value, logs: [] };
    },
  };

  set(id: string, patch: Partial<ChainOrder>) {
    this.orders.set(id, { ...(this.orders.get(id) ?? chainOrder({ id })), ...patch });
  }
}

export function chainOrder(p: Partial<ChainOrder> = {}): ChainOrder {
  return {
    id: "1",
    seller: SHOP,
    buyer_pk: fixedKey().publicKey,
    buyer_refund: "buyer.test.near",
    price: "2000000",
    paid: "0",
    deadline_ms: String(Date.parse("2026-11-15T10:00:00Z")),
    courier_ref: null,
    status: "Created",
    proof: null,
    created_ms: String(Date.parse("2026-11-13T09:00:00Z")),
    funded_ms: null,
    delivered_ms: null,
    closed_ms: null,
    ...p,
  };
}

/** fetch stub: route by "METHOD path" prefix; records requests. */
export function fakeFetch(routes: Record<string, (req: { url: string; body: unknown; headers: Record<string, string> }) => unknown>) {
  const requests: { method: string; url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    requests.push({ method, url, body, headers });
    const path = new URL(url).pathname + new URL(url).search;
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === method && (path.startsWith(p!) || url.endsWith(p!));
    });
    if (!key) return new Response(JSON.stringify({ message: `no route for ${method} ${path}` }), { status: 404 });
    const out = routes[key]!({ url, body, headers });
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, requests };
}

// ------------------------------------------------------------ live-mode app

export const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

export const ONECLICK_TOKENS = [
  { assetId: BASE_USDC, decimals: 6, blockchain: "base", symbol: "USDC", price: 1 },
  { assetId: USDC_NEAR_ASSET, decimals: 6, blockchain: "near", symbol: "USDC", price: 1 },
  { assetId: "nep141:eth.omft.near", decimals: 18, blockchain: "eth", symbol: "ETH", price: 3000 },
  { assetId: "nep141:doge.omft.near", decimals: 8, blockchain: "doge", symbol: "DOGE", price: 0.16 },
];

/** 1Click and Borzo HTTP stubs with switchable behaviour. */
export function externalApis() {
  const state = {
    tokens: ONECLICK_TOKENS as unknown[],
    status: "PENDING_DEPOSIT",
    nearTxHashes: [] as string[],
    borzoOrder: null as Record<string, unknown> | null,
    quoteOverride: null as null | ((req: Record<string, unknown>) => unknown),
  };
  const api = fakeFetch({
    "GET /v0/tokens": () => state.tokens,
    "POST /v0/quote": ({ body }) => {
      const req = body as Record<string, unknown>;
      if (state.quoteOverride) return state.quoteOverride(req);
      return {
        timestamp: "2026-11-13T10:00:00Z",
        signature: "ed25519:quote-sig",
        quoteRequest: req,
        quote: {
          amountIn: "2020614",
          amountInFormatted: "2.020614",
          minAmountIn: "2000407",
          amountOut: req.amount,
          amountOutFormatted: "2.0",
          timeEstimate: 35,
          ...(req.dry ? {} : { depositAddress: "0xb60A43d045364febb27F3e13E13a25e6Eb10348F", deadline: "2026-11-15T12:27:00Z" }),
        },
      };
    },
    "POST /v0/deposit/submit": () => ({ status: "KNOWN_DEPOSIT_TX" }),
    "GET /v0/status": () => ({ status: state.status, swapDetails: { nearTxHashes: state.nearTxHashes, originChainTxHashes: [] } }),
    "POST /api/business/1.8/calculate-order": () => ({ is_successful: true, order: { order_id: 0, status: "new", payment_amount: "89.00", points: [] } }),
    "POST /api/business/1.8/create-order": () => ({
      is_successful: true,
      order: { order_id: 1250032, status: "available", payment_amount: "89.00", points: [{ address: "a" }, { address: "b", tracking_url: "https://track.example/1", delivery: { status: "planned" } }] },
    }),
    "GET /api/business/1.8/orders": () => ({ is_successful: true, orders: state.borzoOrder ? [state.borzoOrder] : [] }),
  });
  return { state, ...api };
}

export async function makeLive(opts: { clock?: Clock; chain?: StubChain; config?: Partial<Config> } = {}) {
  const clock = opts.clock ?? new Clock();
  const chain = opts.chain ?? new StubChain();
  const apis = externalApis();
  const escrow = new LiveEscrow(ESCROW, chain.viewer, chain.relayer);
  const wired = await createLive(testConfig(opts.config), {
    escrow,
    relayer: chain.relayer,
    checkerSigner: fixedKey(),
    fetch: apis.fn,
    now: clock.now,
    log: silentLogger,
    accessKey: async (account, publicKey) => chain.accessKeys.get(`${account}|${publicKey}`) ?? "none",
  });
  const app = buildApp(wired);
  return { ...wired, app, chain, clock, apis };
}

export const sellerAuth = { authorization: `Bearer ${SELLER_TOKEN}` };
