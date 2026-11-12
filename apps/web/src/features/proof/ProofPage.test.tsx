import { screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../test/utils";

vi.mock("../../lib/env", async (orig) => ({ ...(await orig<typeof import("../../lib/env")>()), isMock: true }));

import { mockSettings } from "../../lib/mock";
import ProofPage from "./ProofPage";
import NotFound from "../NotFound";

beforeAll(() => {
  mockSettings.delayScale = 0;
});

describe("ProofPage", () => {
  it("lists every on-chain step of a released order", async () => {
    renderRoute(<ProofPage />, { path: "/proof/:id", url: "/proof/demo-paid-out1" });
    expect(await screen.findByRole("heading", { level: 1, name: "Classic salted makhana 1 kg" })).toBeInTheDocument();
    expect(screen.getByText(/Demo order — these transactions are simulated/)).toBeInTheDocument();

    const record = screen.getByRole("region", { name: "On-chain record" });
    for (const label of ["Order placed on NEAR", "Payment locked in escrow", "Marked as shipped", "Delivery confirmed", "Paid out to the shop"]) {
      expect(within(record).getByRole("heading", { name: label })).toBeInTheDocument();
    }
    expect(within(record).getByText("9.00 USDC → shop")).toBeInTheDocument();
    expect(within(record).getByText("5 transactions")).toBeInTheDocument();

    const facts = screen.getByRole("region", { name: "Order facts" });
    expect(within(facts).getByText("escrow.doorstep-demo.near")).toBeInTheDocument();
    expect(within(facts).getByText("Checker (courier or code)")).toBeInTheDocument();

    // Demo orders can't be verified on NearBlocks, so the button is disabled.
    expect(screen.getByText("Verify on NearBlocks").closest("[aria-disabled]")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("region", { name: "Payment conversion" })).toHaveTextContent("ETH on Base");
  });

  it("shows a not-found state for an unknown order", async () => {
    renderRoute(<ProofPage />, { path: "/proof/:id", url: "/proof/does-not-exist-123" });
    expect(await screen.findByText("We couldn't find that")).toBeInTheDocument();
  });
});

describe("NotFound", () => {
  it("offers a way home", () => {
    renderRoute(<NotFound />, { path: "*", url: "/nowhere" });
    expect(screen.getByRole("heading", { name: "This page doesn't exist" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  });
});
