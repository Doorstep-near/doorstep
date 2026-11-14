import type { Order, Payment } from "@doorstep/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { encodeTransfer } from "../../lib/wallet";
import { renderRoute } from "../../test/utils";
import { DepositView } from "./DepositView";

const DEPOSIT = "0xb60A43d045364febb27F3e13E13a25e6Eb10348F";
const HASH = "0x" + "cd".repeat(32);

const order = { id: "ord-1", status: "Created", priceUnits: "2000000", escrow: "escrow.example.near", buyer: { refundAccount: null } } as unknown as Order;
const basePayment: Payment = {
  status: "PENDING_DEPOSIT",
  originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  originSymbol: "USDC",
  originChain: "base",
  amountIn: "2020614",
  amountInFormatted: "2.020614",
  depositAddress: DEPOSIT,
  depositMemo: null,
  deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  refundTo: "0x5e2f1a4b7c9d3e8f0a1b2c3d4e5f6a7b8c9d0e1f",
  quotedAt: new Date().toISOString(),
  originTxHash: null,
  nearTxHashes: [],
  issue: null,
} as Payment;

function installWallet(opts: { reject?: boolean } = {}) {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_requestAccounts") return ["0x55f2000000000000000000000000000000000001"];
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_sendTransaction") {
      if (opts.reject) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      return HASH;
    }
    throw new Error(`unexpected ${method}`);
  });
  (window as unknown as { ethereum?: unknown }).ethereum = { request };
  return request;
}

function show(payment: Payment = basePayment, demoMode = false) {
  const onOrder = vi.fn();
  renderRoute(<DepositView order={order} payment={payment} demoMode={demoMode} onOrder={onOrder} onChangeToken={() => {}} onRequote={() => {}} requoting={false} requoteError={null} />, { path: "/", url: "/" });
  return onOrder;
}

afterEach(() => {
  delete (window as unknown as { ethereum?: unknown }).ethereum;
  localStorage.clear();
});

describe("Pay with wallet", () => {
  it("sends the exact USDC amount to the deposit address and reports the hash", async () => {
    const user = userEvent.setup();
    const request = installWallet();
    const updated = { ...order, payment: { ...basePayment, originTxHash: HASH } } as unknown as Order;
    const submit = vi.spyOn(api.orders, "submitDeposit").mockResolvedValue(updated);
    const onOrder = show();

    expect(screen.getByText(/exactly 2\.020614 USDC on Base/)).toBeInTheDocument();
    expect(screen.getByText(/a little ETH on Base for the network fee/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Pay with wallet/ }));

    expect(await screen.findByText("Sent from your wallet")).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith({
      method: "eth_sendTransaction",
      params: [{ from: "0x55f2000000000000000000000000000000000001", to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", value: "0x0", data: encodeTransfer(DEPOSIT, 2020614n) }],
    });
    expect(screen.getByRole("link", { name: /View your transaction/ })).toHaveAttribute("href", `https://basescan.org/tx/${HASH}`);
    expect(submit).toHaveBeenCalledWith("ord-1", { txHash: HASH });
    expect(onOrder).toHaveBeenCalledWith(updated);
    expect(screen.queryByRole("button", { name: /Pay with wallet/ })).not.toBeInTheDocument();
    // The copy-the-address way stays available.
    expect(screen.getByText(DEPOSIT)).toBeInTheDocument();
  });

  it("still shows the payment as sent if reporting the hash fails", async () => {
    const user = userEvent.setup();
    installWallet();
    vi.spyOn(api.orders, "submitDeposit").mockRejectedValue(new Error("1Click is down"));
    show();
    await user.click(screen.getByRole("button", { name: /Pay with wallet/ }));
    expect(await screen.findByText("Sent from your wallet")).toBeInTheDocument();
  });

  it("explains a cancel in the wallet and lets the buyer try again", async () => {
    const user = userEvent.setup();
    installWallet({ reject: true });
    const submit = vi.spyOn(api.orders, "submitDeposit");
    show();
    await user.click(screen.getByRole("button", { name: /Pay with wallet/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You cancelled in your wallet. Nothing was sent.");
    expect(screen.getByRole("button", { name: /Pay with wallet/ })).toBeEnabled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("doesn't offer a second payment after a reload", () => {
    installWallet();
    localStorage.setItem(`doorstep:walletTx:${DEPOSIT}`, HASH);
    show();
    expect(screen.getByText("Sent from your wallet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pay with wallet/ })).not.toBeInTheDocument();
  });

  it("doesn't offer it once a hash was pasted by hand", () => {
    installWallet();
    show({ ...basePayment, originTxHash: "0xabc123def4567890" });
    expect(screen.queryByRole("button", { name: /Pay with wallet/ })).not.toBeInTheDocument();
  });

  it("leaves only the copy-the-address way when there is no wallet", () => {
    show();
    expect(screen.queryByRole("button", { name: /Pay with wallet/ })).not.toBeInTheDocument();
    // Moving to a wallet app now would lose the order pass, so no tip suggests it.
    expect(screen.queryByText(/wallet's own browser|Open in MetaMask/)).not.toBeInTheDocument();
    expect(screen.getByText(DEPOSIT)).toBeInTheDocument();
  });

  it("is hidden in practice mode and for tokens a wallet can't send here", () => {
    installWallet();
    show({ ...basePayment, depositAddress: "DEMO-NOT-REAL-0123456789abcdef" });
    expect(screen.queryByRole("button", { name: /Pay with wallet/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/wallet's own browser/)).not.toBeInTheDocument();
  });

  it("is hidden for Solana", () => {
    installWallet();
    show({ ...basePayment, originAsset: "nep141:sol.omft.near", originChain: "sol", originSymbol: "SOL", depositAddress: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" });
    expect(screen.queryByRole("button", { name: /Pay with wallet/ })).not.toBeInTheDocument();
  });

  it("is hidden in demo mode", () => {
    installWallet();
    show(basePayment, true);
    expect(screen.queryByRole("button", { name: /Pay with wallet/ })).not.toBeInTheDocument();
  });
});
