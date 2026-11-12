// NEAR Intents 1Click API client (https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api).
// Request shape copied from scripts/oneclick-test.mjs, which worked on mainnet.
import { AppError } from "../errors";

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number | string | null;
  priceUpdatedAt?: string;
  contractAddress?: string;
}

export interface OneClickQuoteRequest {
  dry: boolean;
  swapType: "EXACT_OUTPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  customRecipientMsg?: string;
  deadline: string;
  referral: string;
}

export interface OneClickQuote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd?: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  minAmountOut?: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate?: number;
}

export interface OneClickQuoteResponse {
  timestamp?: string;
  signature?: string;
  quoteRequest?: OneClickQuoteRequest;
  quote: OneClickQuote;
  correlationId?: string;
}

export interface OneClickStatus {
  status: string;
  updatedAt?: string;
  swapDetails?: {
    nearTxHashes?: string[];
    originChainTxHashes?: { hash: string; explorerUrl?: string }[];
    destinationChainTxHashes?: { hash: string; explorerUrl?: string }[];
    amountIn?: string;
    amountOut?: string;
    refundedAmount?: string;
  };
}

export interface OneClick {
  tokens(): Promise<OneClickToken[]>;
  quote(req: OneClickQuoteRequest): Promise<OneClickQuoteResponse>;
  submitDeposit(txHash: string, depositAddress: string, memo?: string | null): Promise<void>;
  status(depositAddress: string, memo?: string | null): Promise<OneClickStatus>;
}

export class LiveOneClick implements OneClick {
  constructor(
    private baseUrl: string,
    private auth: { apiKey?: string; jwt?: string },
    private fetchFn: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    if (this.auth.apiKey) return { "X-API-Key": this.auth.apiKey };
    if (this.auth.jwt) return { Authorization: `Bearer ${this.auth.jwt}` };
    return {};
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: { "content-type": "application/json", ...this.headers() },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new AppError("oneclick_error", `1Click unreachable: ${(e as Error).message}`);
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    if (!res.ok) {
      const msg = typeof body === "object" && body && "message" in body ? String((body as { message: unknown }).message) : String(text).slice(0, 300);
      throw new AppError("oneclick_error", `1Click ${path.split("?")[0]} failed (HTTP ${res.status}): ${msg}`);
    }
    return body as T;
  }

  tokens() {
    return this.request<OneClickToken[]>("/v0/tokens");
  }
  quote(req: OneClickQuoteRequest) {
    return this.request<OneClickQuoteResponse>("/v0/quote", { method: "POST", body: req });
  }
  async submitDeposit(txHash: string, depositAddress: string, memo?: string | null) {
    await this.request("/v0/deposit/submit", { method: "POST", body: { txHash, depositAddress, ...(memo ? { memo } : {}) } });
  }
  status(depositAddress: string, memo?: string | null) {
    const q = new URLSearchParams({ depositAddress });
    if (memo) q.set("depositMemo", memo);
    return this.request<OneClickStatus>(`/v0/status?${q}`);
  }
}
