import type { Order } from "@doorstep/shared";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenInWalletApp } from "./parts";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
const draft = { id: "9kA9R6N1YWmp", buyer: { publicKey: null } } as unknown as Order;
const onPhone = () => vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE);

afterEach(() => {
  delete (window as unknown as { ethereum?: unknown }).ethereum;
});

describe("Open in wallet app", () => {
  it("offers MetaMask and Coinbase Wallet on a phone before checkout starts", () => {
    onPhone();
    render(<OpenInWalletApp order={draft} practice={false} />);
    expect(screen.getByRole("heading", { name: "Paying from a wallet app?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in MetaMask" }).getAttribute("href")).toMatch(/^https:\/\/metamask\.app\.link\/dapp\//);
    expect(screen.getByRole("link", { name: "Open in Coinbase Wallet" }).getAttribute("href")).toMatch(/^https:\/\/go\.cb-w\.com\/dapp\?cb_url=/);
  });

  it("stays hidden inside a wallet app, after checkout started, in practice mode, and on desktop", () => {
    onPhone();
    (window as unknown as { ethereum?: unknown }).ethereum = { request: vi.fn() };
    const { unmount } = render(<OpenInWalletApp order={draft} practice={false} />);
    expect(screen.queryByText("Paying from a wallet app?")).not.toBeInTheDocument();
    unmount();
    delete (window as unknown as { ethereum?: unknown }).ethereum;

    const started = { ...draft, buyer: { publicKey: "ed25519:abc" } } as unknown as Order;
    const second = render(<OpenInWalletApp order={started} practice={false} />);
    expect(screen.queryByText("Paying from a wallet app?")).not.toBeInTheDocument();
    second.unmount();
    const third = render(<OpenInWalletApp order={draft} practice />);
    expect(screen.queryByText("Paying from a wallet app?")).not.toBeInTheDocument();
    third.unmount();
    vi.restoreAllMocks();
    render(<OpenInWalletApp order={draft} practice={false} />);
    expect(screen.queryByText("Paying from a wallet app?")).not.toBeInTheDocument();
  });
});
