import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MOCK_TOKENS } from "../../lib/mock/tokens";
import { popularTiles, searchTokens, TokenPicker } from "./TokenPicker";

describe("searchTokens", () => {
  it("matches by symbol and by network name", () => {
    const sol = searchTokens(MOCK_TOKENS, "sol");
    expect(sol[0]?.symbol).toBe("SOL");
    expect(sol.some((t) => t.symbol === "USDC" && t.chain === "sol")).toBe(true);
    expect(sol.some((t) => t.chain === "base")).toBe(false);
    const arb = searchTokens(MOCK_TOKENS, "Arbitrum");
    expect(arb.length).toBeGreaterThanOrEqual(3);
    expect(arb.every((t) => t.chain === "arb")).toBe(true);
    expect(searchTokens(MOCK_TOKENS, "usdc on base")[0]?.chain).toBe("base");
    expect(searchTokens(MOCK_TOKENS, "zzzz")).toEqual([]);
  });

  it("puts popular tokens first with an empty query", () => {
    const all = searchTokens(MOCK_TOKENS, "");
    expect(all).toHaveLength(MOCK_TOKENS.length);
    expect(all[0]?.popular).toBe(true);
  });

  it("shows a curated, varied set of popular tiles", () => {
    expect(popularTiles(MOCK_TOKENS, 7).map((t) => `${t.symbol}:${t.chain}`)).toEqual(["USDC:base", "USDC:arb", "USDT:tron", "ETH:eth", "SOL:sol", "BTC:btc", "NEAR:near"]);
  });
});

describe("TokenPicker", () => {
  it("picks a popular tile, and searches the full list in a sheet", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TokenPicker tokens={MOCK_TOKENS} value={null} onChange={onChange} />);

    expect(screen.getAllByRole("radio")).toHaveLength(7);
    await user.click(screen.getByRole("radio", { name: "USDT on Tron" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: "USDT", chain: "tron" }));

    await user.click(screen.getByRole("button", { name: /More/ }));
    const dialog = screen.getByRole("dialog", { name: "Choose a token" });
    const search = within(dialog).getByRole("searchbox", { name: "Search token or network" });
    await user.type(search, "doge");
    const list = within(dialog).getByRole("list", { name: "Tokens" });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    await user.click(within(list).getByRole("button", { name: /DOGE/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: "DOGE" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains when nothing matches", async () => {
    const user = userEvent.setup();
    render(<TokenPicker tokens={MOCK_TOKENS} value={null} onChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: /More/ }));
    await user.type(screen.getByRole("searchbox"), "notatoken");
    expect(screen.getByText(/No tokens match/)).toBeInTheDocument();
  });

  it("keeps a selected non-popular token visible as a tile", () => {
    const doge = MOCK_TOKENS.find((t) => t.symbol === "DOGE")!;
    render(<TokenPicker tokens={MOCK_TOKENS} value={doge.assetId} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "DOGE on Dogecoin" })).toHaveAttribute("aria-checked", "true");
  });
});
