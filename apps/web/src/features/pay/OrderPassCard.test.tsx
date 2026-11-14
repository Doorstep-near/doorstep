import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getOrCreateKey, seedToBase64Url } from "../../lib/buyerKey";
import { OrderPassCard, whatsappPassLink } from "./parts";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";

describe("order pass: Send to my WhatsApp", () => {
  it("opens the WhatsApp app with the full private link and a do-not-forward warning", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE);
    const key = getOrCreateKey("ord-1");
    render(<OrderPassCard orderId="ord-1" buyerKey={key} webUrl="https://shop.example" />);
    const href = screen.getByRole("link", { name: "Send to my WhatsApp" }).getAttribute("href")!;
    expect(href.startsWith("whatsapp://send?text=")).toBe(true);
    const text = decodeURIComponent(href.slice("whatsapp://send?text=".length));
    expect(text).toContain(`https://shop.example/o/ord-1#k=${seedToBase64Url(key)}`);
    expect(text).toMatch(/Don't forward it to anyone, including the shop/);
  });

  it("isn't shown on a desktop, where Copy link is the way", () => {
    render(<OrderPassCard orderId="ord-2" buyerKey={getOrCreateKey("ord-2")} webUrl="https://shop.example" />);
    expect(screen.queryByRole("link", { name: "Send to my WhatsApp" })).not.toBeInTheDocument();
  });

  it("keeps the link out of any web address", () => {
    expect(whatsappPassLink("https://shop.example/o/x#k=SEED")).not.toMatch(/^https?:/);
  });
});
