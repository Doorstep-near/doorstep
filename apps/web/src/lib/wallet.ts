// "Pay with wallet": sends the exact 1Click deposit from a browser wallet
// (MetaMask, Coinbase Wallet, Rabby, or a phone wallet's built-in browser).
// It talks to the wallet through the standard EIP-1193 `window.ethereum`
// provider, so no wallet library is needed. Only ETH and ERC-20 tokens on
// Ethereum, Base and Arbitrum are supported; every other token keeps the
// copy-the-address flow.
import { isDemoDepositAddress, type Payment } from "@doorstep/shared";
import { useEffect, useState } from "react";

/** An error whose message is already written for the buyer. */
export class WalletError extends Error {}

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface EvmChain {
  id: number;
  name: string;
  explorerTx: string;
  /** For wallet_addEthereumChain when the wallet doesn't know the chain yet. */
  add?: { chainName: string; rpcUrls: string[]; blockExplorerUrls: string[] };
}

/** Keyed by 1Click's chain name (also the prefix inside its asset ids). */
const CHAINS: Record<string, EvmChain> = {
  eth: { id: 1, name: "Ethereum", explorerTx: "https://etherscan.io/tx/" },
  base: {
    id: 8453,
    name: "Base",
    explorerTx: "https://basescan.org/tx/",
    add: { chainName: "Base", rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] },
  },
  arb: {
    id: 42161,
    name: "Arbitrum",
    explorerTx: "https://arbiscan.io/tx/",
    add: { chainName: "Arbitrum One", rpcUrls: ["https://arb1.arbitrum.io/rpc"], blockExplorerUrls: ["https://arbiscan.io"] },
  },
};

// "nep141:base.omft.near" is native ETH on Base;
// "nep141:base-0x8335…2913.omft.near" is the ERC-20 at that address on Base.
const OMFT_ASSET = /^nep141:(eth|base|arb)(?:-(0x[0-9a-f]{40}))?\.omft\.near$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Everything needed to send one payment from a wallet. */
export interface WalletPayment {
  chainKey: string;
  chainId: number;
  chainName: string;
  /** ERC-20 contract, or null for the chain's native ETH. */
  token: string | null;
  /** The 1Click deposit address. */
  to: string;
  /** Exact amount in the token's smallest unit. */
  amount: bigint;
  explorerTx: string;
}

/** Returns how to pay this quote from a wallet, or null if a wallet can't pay it. */
export function walletPaymentFor(p: Pick<Payment, "originAsset" | "originChain" | "amountIn" | "depositAddress" | "depositMemo">): WalletPayment | null {
  if (isDemoDepositAddress(p.depositAddress) || p.depositMemo) return null;
  if (!EVM_ADDRESS.test(p.depositAddress)) return null;
  const m = OMFT_ASSET.exec(p.originAsset);
  if (!m || m[1] !== p.originChain) return null;
  const chain = CHAINS[m[1]!]!;
  let amount: bigint;
  try {
    amount = BigInt(p.amountIn);
  } catch {
    return null;
  }
  if (amount <= 0n) return null;
  return { chainKey: m[1]!, chainId: chain.id, chainName: chain.name, token: m[2] ?? null, to: p.depositAddress, amount, explorerTx: chain.explorerTx };
}

const pad32 = (hex: string) => hex.padStart(64, "0");

/** Calldata for ERC-20 `transfer(to, amount)`. */
export function encodeTransfer(to: string, amount: bigint): string {
  return "0xa9059cbb" + pad32(to.slice(2).toLowerCase()) + pad32(amount.toString(16));
}

/** The transaction the wallet is asked to send. */
export function buildTx(wp: WalletPayment, from: string): { from: string; to: string; value?: string; data?: string } {
  return wp.token ? { from, to: wp.token, value: "0x0", data: encodeTransfer(wp.to, wp.amount) } : { from, to: wp.to, value: "0x" + wp.amount.toString(16) };
}

/** The browser's wallet, if one is installed or this page is open inside a wallet app. */
export function injectedWallet(): Eip1193Provider | null {
  const eth = (globalThis as { ethereum?: unknown }).ethereum;
  return eth && typeof (eth as Eip1193Provider).request === "function" ? (eth as Eip1193Provider) : null;
}

/** The browser's wallet, re-checked once shortly after load: some wallets inject themselves late. */
export function useInjectedWallet(): Eip1193Provider | null {
  const [wallet, setWallet] = useState<Eip1193Provider | null>(() => injectedWallet());
  useEffect(() => {
    if (wallet) return;
    const check = () => setWallet(injectedWallet());
    window.addEventListener("ethereum#initialized", check, { once: true });
    const t = window.setTimeout(check, 1000);
    return () => {
      window.removeEventListener("ethereum#initialized", check);
      window.clearTimeout(t);
    };
  }, [wallet]);
  return wallet;
}

/** True on phones and tablets, where a wallet is a separate app with its own browser. */
export function isMobileBrowser(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /Android|iPhone|iPad|iPod/i.test(ua);
}

/**
 * Links that open `url` inside a wallet app's own browser. The fragment is
 * dropped on purpose: it can hold the buyer's key (#k=…), which must never pass
 * through a link service.
 */
export function walletAppLinks(url: string): { name: string; href: string }[] {
  const u = new URL(url);
  const page = u.origin + u.pathname + u.search;
  return [
    { name: "MetaMask", href: `https://metamask.app.link/dapp/${u.host}${u.pathname}${u.search}` },
    { name: "Coinbase Wallet", href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(page)}` },
  ];
}

/** Asks the wallet for its address (for the refund field). */
export async function walletAddress(provider: Eip1193Provider): Promise<string> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[] | undefined;
  const address = accounts?.[0];
  if (!address || !EVM_ADDRESS.test(address)) throw new WalletError("Your wallet didn't share an account. Unlock it and try again.");
  return address;
}

/** personal_sign (EIP-191): the wallet signs a readable text message. Resolves to the 65-byte signature (0x...). */
export async function signPersonalMessage(provider: Eip1193Provider, address: string, message: string): Promise<string> {
  const hex = "0x" + Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, "0")).join("");
  const sig = await provider.request({ method: "personal_sign", params: [hex, address] });
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new WalletError("Your wallet didn't return a signature. Please try again.");
  return sig;
}

const errorCode = (e: unknown): number | undefined => {
  const err = e as { code?: unknown; data?: { originalError?: { code?: unknown } } } | null;
  // Some mobile wallets wrap the real code (4001, 4902) inside a generic -32603 error.
  const nested = err?.data?.originalError?.code;
  const code = typeof nested === "number" ? nested : err?.code;
  return typeof code === "number" ? code : undefined;
};

export type WalletStep = "connect" | "switch" | "confirm";

/** Connects, switches to the right network, and sends the payment. Resolves to the transaction hash. */
export async function payWithWallet(provider: Eip1193Provider, wp: WalletPayment, onStep?: (s: WalletStep) => void): Promise<string> {
  onStep?.("connect");
  const from = await walletAddress(provider);

  const want = "0x" + wp.chainId.toString(16);
  const current = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
  if (current !== want) {
    onStep?.("switch");
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
    } catch (e) {
      const add = CHAINS[wp.chainKey]?.add;
      if (errorCode(e) !== 4902 || !add) throw e;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: want, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, ...add }],
      });
    }
    const after = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
    if (after !== want) throw new WalletError(`Switch your wallet to ${wp.chainName}, then try again.`);
  }

  onStep?.("confirm");
  const hash = await provider.request({ method: "eth_sendTransaction", params: [buildTx(wp, from)] });
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new WalletError("Your wallet didn't return a transaction hash. Check its activity tab before trying again.");
  return hash;
}

/** Plain-words message for a wallet error. */
export function walletErrorMessage(e: unknown): string {
  if (e instanceof WalletError) return e.message;
  const code = errorCode(e);
  if (code === 4001) return "You cancelled in your wallet. Nothing was sent.";
  if (code === -32002) return "Your wallet already has a request waiting. Open your wallet to finish or cancel it.";
  const msg = e instanceof Error ? e.message : typeof (e as { message?: unknown })?.message === "string" ? (e as { message: string }).message : "";
  return msg ? `Your wallet said: ${msg}` : "Something went wrong in your wallet. Nothing was sent.";
}

// Remembers a wallet payment per deposit address, so a reload can't offer a second payment.
const sentKey = (depositAddress: string) => `doorstep:walletTx:${depositAddress}`;

export function rememberWalletTx(depositAddress: string, hash: string): void {
  try {
    localStorage.setItem(sentKey(depositAddress), hash);
  } catch {
    /* storage may be blocked; the backend still records the hash */
  }
}

export function recalledWalletTx(depositAddress: string): string | null {
  try {
    return localStorage.getItem(sentKey(depositAddress));
  } catch {
    return null;
  }
}
