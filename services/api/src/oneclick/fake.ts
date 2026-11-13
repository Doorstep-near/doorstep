// Demo mode 1Click: a believable token list, quotes at ~1.03% over the
// price for stablecoins, deposit addresses no wallet accepts
// (DEMO_DEPOSIT_PREFIX, so real money can't be sent), and a status that moves
// PENDING_DEPOSIT -> KNOWN_DEPOSIT_TX -> PROCESSING -> SUCCESS ~10 s after a
// deposit is submitted. On SUCCESS it "delivers" USDC to the fake escrow
// with msg = customRecipientMsg, exactly like the real flow.
import { randomBytes } from "node:crypto";
import { DEMO_DEPOSIT_PREFIX, USDC_NEAR_ASSET } from "@doorstep/shared";
import { AppError } from "../errors";
import { fakeTxHash, unitsToDecimal } from "../util";
import type { OneClick, OneClickQuoteRequest, OneClickQuoteResponse, OneClickStatus, OneClickToken } from "./client";

export const DEMO_TOKENS: OneClickToken[] = [
  { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6, blockchain: "base", symbol: "USDC", price: 1 },
  { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", decimals: 6, blockchain: "arb", symbol: "USDC", price: 1 },
  { assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", decimals: 6, blockchain: "eth", symbol: "USDC", price: 1 },
  { assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6, blockchain: "sol", symbol: "USDC", price: 1 },
  { assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", decimals: 6, blockchain: "eth", symbol: "USDT", price: 1 },
  { assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", decimals: 6, blockchain: "tron", symbol: "USDT", price: 1 },
  { assetId: "nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g", decimals: 18, blockchain: "bsc", symbol: "USDT", price: 1 },
  { assetId: "nep141:eth.omft.near", decimals: 18, blockchain: "eth", symbol: "ETH", price: 3150.4 },
  { assetId: "nep141:base.omft.near", decimals: 18, blockchain: "base", symbol: "ETH", price: 3150.4 },
  { assetId: "nep141:arb.omft.near", decimals: 18, blockchain: "arb", symbol: "ETH", price: 3150.4 },
  { assetId: "nep141:sol.omft.near", decimals: 9, blockchain: "sol", symbol: "SOL", price: 152.31 },
  { assetId: "nep141:btc.omft.near", decimals: 8, blockchain: "btc", symbol: "BTC", price: 97012.5 },
  { assetId: "nep141:wrap.near", decimals: 24, blockchain: "near", symbol: "wNEAR", price: 2.41 },
  { assetId: USDC_NEAR_ASSET, decimals: 6, blockchain: "near", symbol: "USDC", price: 1 },
  { assetId: "nep141:eth-0x6b175474e89094c44da98b954eedeac495271d0f.omft.near", decimals: 18, blockchain: "eth", symbol: "DAI", price: 1 },
  { assetId: "nep141:doge.omft.near", decimals: 8, blockchain: "doge", symbol: "DOGE", price: 0.162 },
];

const FEE_NUM = 10103n; // amountIn ≈ price × 1.0103, as seen on mainnet (2.020614 for 2.00)
const FEE_DEN = 10000n;
const SUCCESS_AFTER_MS = 10_000;

interface FakeSwap {
  request: OneClickQuoteRequest;
  depositMemo?: string;
  depositedAt: number | null;
  settled: boolean;
  nearTxHashes: string[];
  originTxHash: string | null;
}

/** Never a real address: invalid on every chain, so nobody can pay into it. */
function fakeAddress(): string {
  return `${DEMO_DEPOSIT_PREFIX}${randomBytes(8).toString("hex")}`;
}

export class FakeOneClick implements OneClick {
  private swaps = new Map<string, FakeSwap>();

  constructor(
    /** Called once per swap when it reaches SUCCESS: deliver USDC to the escrow. */
    private onSettled: (recipientMsg: string, amountOut: string) => void,
    private now: () => number = Date.now,
  ) {}

  async tokens() {
    return DEMO_TOKENS;
  }

  async quote(req: OneClickQuoteRequest): Promise<OneClickQuoteResponse> {
    const token = DEMO_TOKENS.find((t) => t.assetId === req.originAsset);
    if (!token) throw new AppError("oneclick_error", `1Click /v0/quote failed (HTTP 400): tokenIn is not valid`);
    const out = BigInt(req.amount);
    const usd6 = (out * FEE_NUM + FEE_DEN - 1n) / FEE_DEN; // in 6-decimal USD units
    const price = Number(token.price ?? 1);
    // token units = usd / price, computed in fixed point with 6 extra digits
    const priceMicro = BigInt(Math.round(price * 1e6));
    const amountIn = (usd6 * 10n ** BigInt(token.decimals) + priceMicro - 1n) / priceMicro;
    const minAmountIn = (amountIn * 99n) / 100n;
    const quote = {
      amountIn: amountIn.toString(),
      amountInFormatted: unitsToDecimal(amountIn, token.decimals, 6),
      amountInUsd: unitsToDecimal(usd6, 6, 4),
      minAmountIn: minAmountIn.toString(),
      amountOut: out.toString(),
      amountOutFormatted: unitsToDecimal(out, 6, 6),
      minAmountOut: out.toString(),
      timeEstimate: token.blockchain === "btc" ? 900 : 35,
      ...(req.dry
        ? {}
        : {
            depositAddress: fakeAddress(),
            deadline: req.deadline,
            timeWhenInactive: req.deadline,
          }),
    };
    if (!req.dry && quote.depositAddress) {
      this.swaps.set(quote.depositAddress, { request: req, depositedAt: null, settled: false, nearTxHashes: [], originTxHash: null });
    }
    return { timestamp: new Date(this.now()).toISOString(), signature: `demo:${fakeTxHash()}`, quoteRequest: req, quote, correlationId: `demo-${fakeTxHash().slice(0, 12)}` };
  }

  async submitDeposit(txHash: string, depositAddress: string) {
    const s = this.swaps.get(depositAddress);
    if (!s) throw new AppError("oneclick_error", "1Click /v0/deposit/submit failed (HTTP 404): deposit address not found");
    s.depositedAt ??= this.now();
    s.originTxHash = txHash;
  }

  async status(depositAddress: string): Promise<OneClickStatus> {
    const s = this.swaps.get(depositAddress);
    if (!s) throw new AppError("oneclick_error", "1Click /v0/status failed (HTTP 404): deposit address not found");
    let status = "PENDING_DEPOSIT";
    if (s.settled) status = "SUCCESS";
    else if (s.depositedAt != null) {
      const age = this.now() - s.depositedAt;
      status = age >= SUCCESS_AFTER_MS ? "SUCCESS" : age >= 2_000 ? "PROCESSING" : "KNOWN_DEPOSIT_TX";
      if (status === "SUCCESS") this.settle(s);
    }
    return {
      status,
      updatedAt: new Date(this.now()).toISOString(),
      swapDetails: {
        nearTxHashes: s.nearTxHashes,
        originChainTxHashes: s.originTxHash ? [{ hash: s.originTxHash, explorerUrl: "#demo" }] : [],
        amountOut: s.request.amount,
      },
    };
  }

  /** Demo "advance": the buyer paid and 1Click finished right now. */
  settleNow(depositAddress: string) {
    const s = this.swaps.get(depositAddress);
    if (!s) throw new AppError("oneclick_error", "Unknown deposit address");
    s.depositedAt ??= this.now() - SUCCESS_AFTER_MS;
    s.originTxHash ??= `0x${randomBytes(32).toString("hex")}`;
    this.settle(s);
  }

  private settle(s: FakeSwap) {
    if (s.settled) return;
    s.settled = true;
    s.nearTxHashes = [fakeTxHash(), fakeTxHash(), fakeTxHash(), fakeTxHash()];
    this.onSettled(s.request.customRecipientMsg ?? "", s.request.amount);
  }
}

