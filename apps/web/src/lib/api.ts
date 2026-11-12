// Typed client for the Doorstep HTTP contract (packages/shared/src/api.ts).
// Every response is parsed with the shared zod schemas. The transport is the
// only thing that differs between the real API and the in-browser mock, and it
// is chosen in exactly one place: `api` at the bottom of this file.
import { z } from "zod";
import {
  ApiError,
  AppConfig,
  OtpRevealResponse,
  Order,
  QuoteResponse,
  SellerOrder,
  SellerOrdersResponse,
  SellerSummary,
  ShipQuote,
  Stats,
  TokensResponse,
  type CreateOrderRequest,
  type DepositSubmitRequest,
  type OtpRevealRequest,
  type OtpVerifyRequest,
  type QuoteRequest,
  type RegisterBuyerRequest,
  type ShipQuoteRequest,
  type ShipRequest,
  type SignatureRequest,
} from "@doorstep/shared";
import { env, isMock } from "./env";

export type HttpMethod = "GET" | "POST";

export interface TransportRequest {
  method: HttpMethod;
  path: string;
  body?: unknown;
  token?: string | null;
}

export interface TransportResponse {
  status: number;
  body: unknown;
}

export interface Transport {
  request(req: TransportRequest): Promise<TransportResponse>;
}

type ApiErrorCode = ApiError["error"]["code"];

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | "network" | "bad_response";
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: ApiRequestError["code"], message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(e: unknown, code?: ApiRequestError["code"]): e is ApiRequestError {
  return e instanceof ApiRequestError && (code === undefined || e.code === code);
}

/** A sentence a person can act on, for any thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong. Please try again.";
}

// ------------------------------------------------------------------ seller token

const TOKEN_KEY = "doorstep:seller-token";

export const sellerToken = {
  get(): string | null {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore */
    }
  },
  clear(): void {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

// ------------------------------------------------------------------ transports

export function createFetchTransport(baseUrl: string): Transport {
  return {
    async request({ method, path, body, token }) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            Accept: "application/json",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new ApiRequestError(0, "network", "Can't reach Doorstep right now. Check your connection and try again.");
      }
      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      return { status: res.status, body: parsed };
    },
  };
}

/** Lazily loads the in-browser mock so it never ships in the real-API code path. */
function createLazyMockTransport(): Transport {
  let loaded: Promise<Transport> | null = null;
  return {
    request(req) {
      loaded ??= import("./mock").then((m) => m.mockTransport);
      return loaded.then((t) => t.request(req));
    },
  };
}

// ------------------------------------------------------------------ client

const Health = z.object({ ok: z.literal(true) });

export function createClient(transport: Transport) {
  async function call<T>(schema: z.ZodType<T>, method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const token = path.startsWith("/seller/") ? sellerToken.get() : null;
    const res = await transport.request({ method, path, body, token });
    if (res.status >= 400 || res.status === 0) {
      const err = ApiError.safeParse(res.body);
      if (err.success) {
        throw new ApiRequestError(res.status, err.data.error.code, err.data.error.message, err.data.error.details);
      }
      throw new ApiRequestError(res.status, res.status === 404 ? "not_found" : "internal", `Request failed (HTTP ${res.status}). Please try again.`);
    }
    const parsed = schema.safeParse(res.body);
    if (!parsed.success) {
      console.error(`Doorstep: ${method} ${path} returned an unexpected shape`, parsed.error.issues);
      throw new ApiRequestError(res.status, "bad_response", "The server sent something unexpected. Please try again.");
    }
    return parsed.data;
  }

  const enc = encodeURIComponent;

  return {
    health: () => call(Health, "GET", "/health"),
    config: () => call(AppConfig, "GET", "/config"),
    tokens: () => call(TokensResponse, "GET", "/tokens"),
    stats: () => call(Stats, "GET", "/stats"),

    seller: {
      createOrder: (req: CreateOrderRequest) => call(SellerOrder, "POST", "/seller/orders", req),
      listOrders: () => call(SellerOrdersResponse, "GET", "/seller/orders"),
      getOrder: (id: string) => call(SellerOrder, "GET", `/seller/orders/${enc(id)}`),
      summary: () => call(SellerSummary, "GET", "/seller/summary"),
      shipQuote: (id: string, req: ShipQuoteRequest) => call(ShipQuote, "POST", `/seller/orders/${enc(id)}/ship/quote`, req),
      ship: (id: string, req: ShipRequest) => call(SellerOrder, "POST", `/seller/orders/${enc(id)}/ship`, req),
      verifyOtp: (id: string, req: OtpVerifyRequest) => call(SellerOrder, "POST", `/seller/orders/${enc(id)}/otp/verify`, req),
    },

    orders: {
      get: (id: string) => call(Order, "GET", `/orders/${enc(id)}`),
      registerBuyer: (id: string, req: RegisterBuyerRequest) => call(Order, "POST", `/orders/${enc(id)}/buyer`, req),
      quote: (id: string, req: QuoteRequest) => call(QuoteResponse, "POST", `/orders/${enc(id)}/quote`, req),
      submitDeposit: (id: string, req: DepositSubmitRequest) => call(Order, "POST", `/orders/${enc(id)}/deposit`, req),
      confirm: (id: string, req: SignatureRequest) => call(Order, "POST", `/orders/${enc(id)}/confirm`, req),
      complaint: (id: string, req: SignatureRequest) => call(Order, "POST", `/orders/${enc(id)}/complaint`, req),
      revealOtp: (id: string, req: OtpRevealRequest) => call(OtpRevealResponse, "POST", `/orders/${enc(id)}/otp`, req),
    },

    demo: {
      advance: (id: string) => call(Order, "POST", `/demo/orders/${enc(id)}/advance`),
    },
  };
}

export type DoorstepClient = ReturnType<typeof createClient>;

/** The one place the mock and the real API are swapped. */
export const api: DoorstepClient = createClient(isMock ? createLazyMockTransport() : createFetchTransport(env.apiUrl));
