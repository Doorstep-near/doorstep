import { screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../test/utils";

vi.mock("../../lib/env", async (orig) => ({ ...(await orig<typeof import("../../lib/env")>()), isMock: true }));

import { mockSettings } from "../../lib/mock";
import LandingPage from "./LandingPage";

beforeAll(() => {
  mockSettings.delayScale = 0;
});

describe("LandingPage", () => {
  it("renders the hero, trust model and calls to action", () => {
    renderRoute(<LandingPage />, { path: "/", url: "/" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pay any shop with any crypto. They get paid when it reaches your door.");
    expect(screen.getAllByRole("button", { name: "Try the demo" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /view on github/i })).toHaveAttribute("href", "https://github.com/Doorstep-near/doorstep");
    expect(screen.getByRole("heading", { name: "What the buyer's QR removes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What our checker still holds" })).toBeInTheDocument();
    // In the sandbox there's a shortcut to the demo pay link.
    expect(screen.getByRole("link", { name: /see the buyer's pay page/i })).toHaveAttribute("href", "/pay/demo-mom-gift");
  });

  it("shows live numbers from GET /stats", async () => {
    renderRoute(<LandingPage />, { path: "/", url: "/" });
    const stats = screen.getByRole("region", { name: "Live numbers" });
    // Seeded sample data: 8 orders past Draft, 36.60 USDC ever funded, 9.00 USDC released.
    expect(await within(stats).findByText("8")).toBeInTheDocument();
    expect(within(stats).getByText("36.60")).toBeInTheDocument();
    expect(within(stats).getByText("9.00")).toBeInTheDocument();
  });
});
