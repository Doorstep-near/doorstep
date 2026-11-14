import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoute } from "../../test/utils";
import { sellerToken } from "../../lib/api";
import { mockSettings, resetMock } from "../../lib/mock";
import NewOrderPage from "./NewOrderPage";
import SellerDashboard from "./SellerDashboard";
import SellerOrderPage from "./SellerOrderPage";

// Route every request to the in-browser mock API.
vi.mock("../../lib/env", async (orig) => ({ ...(await orig<typeof import("../../lib/env")>()), isMock: true }));

beforeEach(() => {
  mockSettings.delayScale = 0;
  resetMock();
  sellerToken.set("demo");
});

describe("NewOrderPage", () => {
  it("shows field errors on an empty submit", async () => {
    const user = userEvent.setup();
    renderRoute(<NewOrderPage />, { path: "/seller/new", url: "/seller/new" });
    await user.click(screen.getByRole("button", { name: "Create pay link" }));
    expect(await screen.findByText("Enter what you're selling")).toBeInTheDocument();
    expect(screen.getByText("Enter a price")).toBeInTheDocument();
    expect(screen.getByText("Enter the buyer's phone number")).toBeInTheDocument();
    expect(screen.getByText("Borzo needs the full delivery address")).toBeInTheDocument();
    expect(screen.getByLabelText("Item")).toHaveAttribute("aria-invalid", "true");
  });

  it("creates an order and shows the pay link, with a live rupee estimate and preview", async () => {
    const user = userEvent.setup();
    renderRoute(<NewOrderPage />, { path: "/seller/new", url: "/seller/new", extraRoutes: [{ path: "/seller/orders/:id", element: <p>order detail</p> }] });

    await user.type(screen.getByLabelText("Item"), "Peri-peri makhana 250 g");
    await user.type(screen.getByLabelText("Price"), "12.5");
    // ≈₹ next to the price uses config.inrPerUsd (84.2 in the mock): 12.5 × 84.2 = 1,052.5 -> ₹1,053
    expect(await screen.findAllByText(/₹1,05[23]/)).not.toHaveLength(0);
    // The buyer preview mirrors the form.
    expect(within(screen.getByRole("complementary", { name: "Buyer preview" })).getByText("Peri-peri makhana 250 g")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Buyer's phone"), "+91 98765 43210");
    await user.type(screen.getByLabelText(/Delivery address/), "B-42, Sector 50, Noida");
    await user.type(screen.getByLabelText(/Area or city/), "Noida");
    await user.click(screen.getByRole("button", { name: "Create pay link" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("Pay link ready").length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/\/pay\/[A-Za-z0-9_-]{10,}$/)).toBeInTheDocument();
    const wa = within(dialog).getByRole("link", { name: /Share on WhatsApp/ });
    expect(wa.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(within(dialog).getByRole("img", { name: /QR code of the pay link/ })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "View order" }));
    expect(await screen.findByText("order detail")).toBeInTheDocument();
  });
});

describe("SellerDashboard", () => {
  it("lists seeded orders, filters by tab and narrows by search", async () => {
    const user = userEvent.setup();
    renderRoute(<SellerDashboard />, { path: "/seller", url: "/seller" });

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Makhana gift box · 4 flavours")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 9);

    // KPI: 1 to ship + 1 dispute.
    expect(await screen.findByText("1 to ship · 1 dispute")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Needs action/ }));
    await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(1 + 2));
    const filtered = screen.getByRole("table");
    expect(within(filtered).getByText("Himalayan pink salt makhana 500 g")).toBeInTheDocument();
    expect(within(filtered).getByText("Cheese makhana 500 g")).toBeInTheDocument();
    expect(within(filtered).queryByText("Makhana gift box · 4 flavours")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^All/ }));
    await user.type(screen.getByRole("searchbox", { name: "Search orders" }), "jaggery");
    await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2));
    expect(within(screen.getByRole("table")).getByText("Jaggery makhana 200 g × 3")).toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Search orders" }));
    await user.type(screen.getByRole("searchbox", { name: "Search orders" }), "nothing-like-this");
    expect(await screen.findByText("No orders match")).toBeInTheDocument();
  });
});

describe("shop identity", () => {
  it("names the signed-in shop (from its seller token) on the dashboard and in the buyer preview", async () => {
    const { api } = await import("../../lib/api");
    const me = vi.spyOn(api.seller, "me").mockResolvedValue({ id: "spice", name: "Spice Route", account: "spice.near" });
    const { unmount } = renderRoute(<SellerDashboard />, { path: "/seller", url: "/seller" });
    expect(await screen.findByText("Spice Route")).toBeInTheDocument();
    unmount();
    renderRoute(<NewOrderPage />, { path: "/seller/new", url: "/seller/new" });
    expect(await within(screen.getByRole("complementary", { name: "Buyer preview" })).findByText("Spice Route")).toBeInTheDocument();
    expect(me).toHaveBeenCalled();
  });
});

describe("SellerOrderPage", () => {
  it("ships a Funded order by hand and then confirms delivery with the buyer's code", async () => {
    const user = userEvent.setup();
    renderRoute(<SellerOrderPage />, { path: "/seller/orders/:id", url: "/seller/orders/demo-to-ship1" });

    expect(await screen.findByRole("heading", { name: "Paid — ready to ship" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Hand/ }));
    await user.click(screen.getByRole("button", { name: "Mark as handed over" }));
    expect(await screen.findByRole("heading", { name: /confirm at the door/ })).toBeInTheDocument();

    // A wrong code shows the tries left.
    await user.click(screen.getByRole("button", { name: "Confirm delivery" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /Enter code/ }));
    await user.type(within(dialog).getByLabelText("Buyer's delivery code"), "000000");
    await user.click(within(dialog).getByRole("button", { name: "Verify code" }));
    expect(await within(dialog).findByText(/no active code/i)).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown order", async () => {
    renderRoute(<SellerOrderPage />, { path: "/seller/orders/:id", url: "/seller/orders/does-not-exist-123" });
    expect(await screen.findByText("Order not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toBeInTheDocument();
  });
});
