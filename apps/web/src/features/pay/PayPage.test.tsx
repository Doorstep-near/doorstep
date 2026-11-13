import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../test/utils";

vi.mock("../../lib/env", async (orig) => ({ ...(await orig<typeof import("../../lib/env")>()), isMock: true }));

import { mockSettings, resetMock } from "../../lib/mock";
import PayPage from "./PayPage";

beforeEach(() => {
  mockSettings.delayScale = 0;
  resetMock();
});

describe("buyer pay flow (mock API)", () => {
  it("selects a token, enters a refund address, gets a deposit address and ends with the money held safely", async () => {
    const user = userEvent.setup();
    renderRoute(<PayPage />, { path: "/pay/:id", url: "/pay/demo-mom-gift", extraRoutes: [{ path: "/o/:id", element: <p>Order page</p> }] });

    expect(await screen.findByRole("heading", { name: "Makhana gift box · 4 flavours" })).toBeInTheDocument();
    expect(screen.getByText(/is paid only after it reaches your door/)).toBeInTheDocument();

    // 1. Pay with USDC on Base; a live dry quote appears.
    await user.click(await screen.findByRole("radio", { name: "USDC on Base" }));
    expect(await screen.findByText(/You send ≈/)).toBeInTheDocument();
    expect(screen.getByText(/12\.1236 USDC/)).toBeInTheDocument();

    // 2. Refund address is validated per chain.
    await user.click(screen.getByRole("button", { name: /Continue to payment/ }));
    expect(await screen.findByText("Enter your Base address")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Your Base address"), "0x5E2f1a4b7c9d3e8f0a1b2c3d4e5f6a7b8c9d0e1F");

    // 3. Continue: buyer key generated in the browser, order registered, real quote.
    await user.click(screen.getByRole("button", { name: /Continue to payment/ }));
    expect(await screen.findByText("Send exactly")).toBeInTheDocument();
    expect(screen.getByText(/Send only USDC on Base/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /QR code of the Base deposit address/ })).toBeInTheDocument();
    expect(screen.getByText("Waiting for your payment")).toBeInTheDocument();
    // Practice mode: a fake address no wallet accepts, and a loud warning.
    expect(screen.getByRole("alert")).toHaveTextContent("Practice mode: don't send real money");
    expect(screen.getByText(/^DEMO-NOT-REAL-[0-9a-f]{16}$/)).toBeInTheDocument();
    expect(localStorage.getItem("doorstep:key:demo-mom-gift")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // 4. Demo control: simulate the payment.
    await user.click(screen.getByRole("button", { name: /Demo controls/ }));
    await user.click(await screen.findByRole("button", { name: /Advance one step/ }));

    // 5. Held safely.
    expect(await screen.findByRole("heading", { name: "Your payment is held safely" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Save your order pass" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Track your order/ })).toHaveAttribute("href", "/o/demo-mom-gift");
  });

  it("moves through the live progress after “I've sent it”", async () => {
    const user = userEvent.setup();
    renderRoute(<PayPage />, { path: "/pay/:id", url: "/pay/demo-mom-gift" });
    await user.click(await screen.findByRole("radio", { name: "USDC on Base" }));
    await user.type(screen.getByLabelText("Your Base address"), "0x5e2f1a4b7c9d3e8f0a1b2c3d4e5f6a7b8c9d0e1f");
    await user.click(screen.getByRole("button", { name: /Continue to payment/ }));
    await user.click(await screen.findByRole("button", { name: /I've sent it/ }));
    await user.type(screen.getByLabelText(/Transaction hash/), "0xabc123def4567890");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText(/we're watching for it/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Payment on its way" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Payment seen").closest("li")).toHaveAttribute("aria-current", "step"));
  });

  it("asks a Solana payer for a NEAR refund account too", async () => {
    const user = userEvent.setup();
    renderRoute(<PayPage />, { path: "/pay/:id", url: "/pay/demo-mom-gift" });
    await user.click(await screen.findByRole("radio", { name: "SOL on Solana" }));
    expect(screen.getByLabelText("Your Solana address")).toBeInTheDocument();
    expect(screen.getByLabelText("NEAR account for refunds")).toBeInTheDocument();
  });

  it("shows a clear state for an expired pay link", async () => {
    renderRoute(<PayPage />, { path: "/pay/:id", url: "/pay/demo-expired1" });
    expect(await screen.findByText("This pay link has expired")).toBeInTheDocument();
  });
});
