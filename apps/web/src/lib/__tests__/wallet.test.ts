import { describe, expect, it, vi } from "vitest";
import { buildTx, encodeTransfer, type Eip1193Provider, isMobileBrowser, payWithWallet, walletAppLinks, WalletError, walletErrorMessage, walletPaymentFor } from "../wallet";

const DEPOSIT = "0xb60A43d045364febb27F3e13E13a25e6Eb10348F";
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const quote = (over: Partial<Parameters<typeof walletPaymentFor>[0]> = {}) => ({
  originAsset: BASE_USDC,
  originChain: "base",
  amountIn: "2020614",
  depositAddress: DEPOSIT,
  depositMemo: null,
  ...over,
});
const FROM = "0x55f2000000000000000000000000000000000001";
const HASH = "0x" + "ab".repeat(32);

/** A wallet that records requests. `chain` is its current network. */
function fakeWallet(opts: { chain?: string; switchError?: unknown; sticky?: boolean; hash?: unknown } = {}) {
  let chain = opts.chain ?? "0x2105";
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    switch (method) {
      case "eth_requestAccounts":
        return [FROM];
      case "eth_chainId":
        return chain;
      case "wallet_switchEthereumChain":
        if (opts.switchError) throw opts.switchError;
        if (!opts.sticky) chain = (params![0] as { chainId: string }).chainId;
        return null;
      case "wallet_addEthereumChain":
        chain = (params![0] as { chainId: string }).chainId;
        return null;
      case "eth_sendTransaction":
        return "hash" in opts ? opts.hash : HASH;
      default:
        throw new Error(`unexpected ${method}`);
    }
  });
  return { provider: { request } as Eip1193Provider, request, methods: () => request.mock.calls.map((c) => c[0].method) };
}

describe("walletPaymentFor", () => {
  it("pays USDC on Base with an ERC-20 transfer of the exact amount", () => {
    expect(walletPaymentFor(quote())).toEqual({
      chainKey: "base",
      chainId: 8453,
      chainName: "Base",
      token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      to: DEPOSIT,
      amount: 2020614n,
      explorerTx: "https://basescan.org/tx/",
    });
  });

  it("pays native ETH on Arbitrum and Ethereum", () => {
    expect(walletPaymentFor(quote({ originAsset: "nep141:arb.omft.near", originChain: "arb", amountIn: "1000000000000000" }))).toMatchObject({ chainId: 42161, token: null, amount: 10n ** 15n });
    expect(walletPaymentFor(quote({ originAsset: "nep141:eth.omft.near", originChain: "eth" }))).toMatchObject({ chainId: 1, token: null });
  });

  it.each([
    ["a practice address", quote({ depositAddress: "DEMO-NOT-REAL-0123456789abcdef" })],
    ["a deposit that needs a memo", quote({ depositMemo: "123" })],
    ["Solana", quote({ originAsset: "nep141:sol.omft.near", originChain: "sol", depositAddress: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" })],
    ["Optimism (HOT bridge asset)", quote({ originAsset: "nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ", originChain: "op" })],
    ["BNB Chain (not supported yet)", quote({ originAsset: "nep141:bnb-0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d.omdep.near", originChain: "bsc" })],
    ["an asset from another chain than the quote says", quote({ originChain: "arb" })],
    ["a non-EVM deposit address", quote({ depositAddress: "escrow.near" })],
    ["a zero amount", quote({ amountIn: "0" })],
    ["a malformed amount", quote({ amountIn: "1.5" })],
  ])("returns null for %s", (_name, q) => {
    expect(walletPaymentFor(q)).toBeNull();
  });
});

describe("transaction building", () => {
  it("encodes ERC-20 transfer(to, amount)", () => {
    expect(encodeTransfer(DEPOSIT, 2020614n)).toBe(
      "0xa9059cbb" + "000000000000000000000000b60a43d045364febb27f3e13e13a25e6eb10348f" + "00000000000000000000000000000000000000000000000000000000001ed506",
    );
  });

  it("sends tokens to the token contract and ETH straight to the deposit address", () => {
    const usdc = walletPaymentFor(quote())!;
    expect(buildTx(usdc, FROM)).toEqual({ from: FROM, to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", value: "0x0", data: encodeTransfer(DEPOSIT, 2020614n) });
    const eth = walletPaymentFor(quote({ originAsset: "nep141:base.omft.near", amountIn: "255" }))!;
    expect(buildTx(eth, FROM)).toEqual({ from: FROM, to: DEPOSIT, value: "0xff" });
  });
});

describe("payWithWallet", () => {
  it("sends straight away when the wallet is already on the right network", async () => {
    const w = fakeWallet();
    const steps: string[] = [];
    await expect(payWithWallet(w.provider, walletPaymentFor(quote())!, (s) => steps.push(s))).resolves.toBe(HASH);
    expect(w.methods()).toEqual(["eth_requestAccounts", "eth_chainId", "eth_sendTransaction"]);
    expect(steps).toEqual(["connect", "confirm"]);
    expect(w.request).toHaveBeenLastCalledWith({ method: "eth_sendTransaction", params: [buildTx(walletPaymentFor(quote())!, FROM)] });
  });

  it("switches the wallet to Base first", async () => {
    const w = fakeWallet({ chain: "0x1" });
    await payWithWallet(w.provider, walletPaymentFor(quote())!);
    expect(w.methods()).toEqual(["eth_requestAccounts", "eth_chainId", "wallet_switchEthereumChain", "eth_chainId", "eth_sendTransaction"]);
    expect(w.request).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
  });

  it("adds Base to a wallet that doesn't know it", async () => {
    const w = fakeWallet({ chain: "0x1", switchError: { code: 4902, message: "Unrecognized chain" } });
    await payWithWallet(w.provider, walletPaymentFor(quote())!);
    expect(w.request).toHaveBeenCalledWith({
      method: "wallet_addEthereumChain",
      params: [{ chainId: "0x2105", chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }],
    });
  });

  it("refuses to send if the wallet stays on the wrong network", async () => {
    const w = fakeWallet({ chain: "0x1", sticky: true });
    await expect(payWithWallet(w.provider, walletPaymentFor(quote())!)).rejects.toThrow("Switch your wallet to Base, then try again.");
    expect(w.methods()).not.toContain("eth_sendTransaction");
  });

  it("passes on a refused network switch without sending", async () => {
    const w = fakeWallet({ chain: "0x1", switchError: { code: 4001, message: "User rejected" } });
    await expect(payWithWallet(w.provider, walletPaymentFor(quote())!)).rejects.toMatchObject({ code: 4001 });
    expect(w.methods()).not.toContain("eth_sendTransaction");
  });

  it("rejects an answer that isn't a transaction hash", async () => {
    const w = fakeWallet({ hash: null });
    await expect(payWithWallet(w.provider, walletPaymentFor(quote())!)).rejects.toBeInstanceOf(WalletError);
  });
});

describe("walletErrorMessage", () => {
  it("explains common wallet errors in plain words", () => {
    expect(walletErrorMessage({ code: 4001, message: "User rejected the request." })).toBe("You cancelled in your wallet. Nothing was sent.");
    expect(walletErrorMessage({ code: -32603, data: { originalError: { code: 4001 } } })).toBe("You cancelled in your wallet. Nothing was sent.");
    expect(walletErrorMessage({ code: -32002 })).toMatch(/already has a request waiting/);
    expect(walletErrorMessage(new WalletError("Switch your wallet to Base, then try again."))).toBe("Switch your wallet to Base, then try again.");
    expect(walletErrorMessage(new Error("insufficient funds for gas"))).toBe("Your wallet said: insufficient funds for gas");
    expect(walletErrorMessage(undefined)).toBe("Something went wrong in your wallet. Nothing was sent.");
  });
});

describe("wallet app links", () => {
  it("opens the pay page inside MetaMask and Coinbase Wallet, never passing the key fragment", () => {
    const links = walletAppLinks("https://shop.example/pay/9kA9R6N1YWmp?x=1#k=SECRETSEED");
    expect(links).toEqual([
      { name: "MetaMask", href: "https://metamask.app.link/dapp/shop.example/pay/9kA9R6N1YWmp?x=1" },
      { name: "Coinbase Wallet", href: "https://go.cb-w.com/dapp?cb_url=https%3A%2F%2Fshop.example%2Fpay%2F9kA9R6N1YWmp%3Fx%3D1" },
    ]);
    expect(JSON.stringify(links)).not.toContain("SECRETSEED");
  });

  it("tells phones from desktops", () => {
    expect(isMobileBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15")).toBe(true);
    expect(isMobileBrowser("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131 Mobile")).toBe(true);
    expect(isMobileBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131")).toBe(false);
  });
});
