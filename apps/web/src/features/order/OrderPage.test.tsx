import { messages, base64ToBase64Url } from "@doorstep/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../test/utils";

vi.mock("../../lib/env", async (orig) => ({ ...(await orig<typeof import("../../lib/env")>()), isMock: true }));

import { loadKey, seedToBase64Url, signMessage } from "../../lib/buyerKey";
import { mockSettings, mockTransport, resetMock } from "../../lib/mock";
import ConfirmPage from "../confirm/ConfirmPage";
import OrderPage from "./OrderPage";

beforeEach(async () => {
  mockSettings.delayScale = 0;
  resetMock();
  await mockTransport.request({ method: "GET", path: "/config" }); // seed demo data + demo buyer keys
});

describe("buyer order page", () => {
  it("confirms delivery with “I received it” and starts the protection window", async () => {
    const user = userEvent.setup();
    renderRoute(<OrderPage />, { path: "/o/:id", url: "/o/demo-on-way01" });
    expect(await screen.findByRole("heading", { name: "Your order is on its way" })).toBeInTheDocument();
    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Order progress" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /I received it/ }));
    const dialog = screen.getByRole("dialog", { name: "Confirm you have your order?" });
    await user.click(within(dialog).getByRole("button", { name: "Yes, I have it" }));

    expect(await screen.findByRole("heading", { name: "Delivered" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Protection window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Report a problem/ })).toBeInTheDocument();
  });

  it("shows the delivery pass QR and a 6-digit delivery code", async () => {
    const user = userEvent.setup();
    renderRoute(<OrderPage />, { path: "/o/:id", url: "/o/demo-to-ship1" });
    await user.click(await screen.findByRole("button", { name: /Show delivery pass/ }));
    expect(screen.getByText("Only show this when the parcel is in your hands")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Delivery pass QR code" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Show a 6-digit code instead/ }));
    expect(await screen.findByLabelText(/^Delivery code \d \d \d \d \d \d$/)).toBeInTheDocument();
  });

  it("reports a problem during the protection window", async () => {
    const user = userEvent.setup();
    renderRoute(<OrderPage />, { path: "/o/:id", url: "/o/demo-window01" });
    await user.click(await screen.findByRole("button", { name: /Report a problem/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Report problem" }));
    expect(await screen.findByRole("heading", { name: "Problem reported — under review" })).toBeInTheDocument();
  });

  it("imports the key from an order-pass link and strips the fragment", async () => {
    const key = loadKey("demo-to-ship1")!;
    const seed = seedToBase64Url(key);
    localStorage.removeItem("doorstep:key:demo-to-ship1");
    renderRoute(<OrderPage />, { path: "/o/:id", url: `/o/demo-to-ship1#k=${seed}` });
    expect(await screen.findByRole("button", { name: /Show delivery pass/ })).toBeInTheDocument();
    expect(loadKey("demo-to-ship1")?.publicKey).toBe(key.publicKey);
    expect(await screen.findByText("Order pass saved on this device")).toBeInTheDocument();
  });

  it("is view-only without the buyer key", async () => {
    localStorage.removeItem("doorstep:key:demo-to-ship1");
    renderRoute(<OrderPage />, { path: "/o/:id", url: "/o/demo-to-ship1" });
    expect(await screen.findByText("Viewing only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show delivery pass/ })).not.toBeInTheDocument();
  });

  it("shows a receipt for a completed order", async () => {
    renderRoute(<OrderPage />, { path: "/o/:id", url: "/o/demo-paid-out1" });
    expect(await screen.findByRole("heading", { name: "Order complete" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Receipt" })).toBeInTheDocument();
  });
});

describe("confirm page (delivery-pass QR)", () => {
  async function passFor(id: string) {
    const res = await mockTransport.request({ method: "GET", path: `/orders/${id}` });
    const order = res.body as { chainOrderId: string; escrow: string };
    return base64ToBase64Url(signMessage(loadKey(id)!, messages.delivered(order.chainOrderId, order.escrow)));
  }

  it("confirms delivery from the signature in the fragment", async () => {
    const sig = await passFor("demo-on-way01");
    renderRoute(<ConfirmPage />, { path: "/confirm/:id", url: `/confirm/demo-on-way01#sig=${sig}` });
    expect(await screen.findByRole("heading", { name: "Delivery confirmed" })).toBeInTheDocument();
    expect(screen.getByText(/Payout after the protection window/)).toBeInTheDocument();
  });

  it("rejects a pass signed for another order", async () => {
    const sig = await passFor("demo-to-ship1");
    renderRoute(<ConfirmPage />, { path: "/confirm/:id", url: `/confirm/demo-on-way01#sig=${sig}` });
    expect(await screen.findByRole("heading", { name: "This delivery pass doesn't match the order" })).toBeInTheDocument();
  });

  it("explains an incomplete link", async () => {
    renderRoute(<ConfirmPage />, { path: "/confirm/:id", url: "/confirm/demo-on-way01" });
    expect(await screen.findByRole("heading", { name: "This link is incomplete" })).toBeInTheDocument();
  });

  it("treats an already-confirmed order as done", async () => {
    const sig = await passFor("demo-on-way01");
    await mockTransport.request({ method: "POST", path: "/demo/orders/demo-on-way01/advance" }); // picked up -> delivered
    renderRoute(<ConfirmPage />, { path: "/confirm/:id", url: `/confirm/demo-on-way01#sig=${sig}` });
    expect(await screen.findByRole("heading", { name: "Delivery was already confirmed" })).toBeInTheDocument();
  });
});
