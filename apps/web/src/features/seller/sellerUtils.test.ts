import { describe, expect, it } from "vitest";
import { links, type Order } from "@doorstep/shared";
import { matchesFilter, matchesSearch, parseDeliveryPass, safeNext, whatsappShareUrl } from "./sellerUtils";

const SIG = "45J2LTOmqR1JKIyM9QTTE0SXEw9oTAPlat+H1DwqlYcDufOFWLabjP2uzFCEndz6eoQga8OAofa9ont7LZqUCA==";

describe("parseDeliveryPass", () => {
  it("reads the order id and converts the base64url signature back to base64", () => {
    const link = links.confirm("https://doorstep.app", "abcDEF12345", SIG);
    expect(parseDeliveryPass(link, "abcDEF12345")).toEqual({ ok: true, id: "abcDEF12345", signature: SIG });
  });

  it("rejects passes for another order, garbage and damaged signatures", () => {
    expect(parseDeliveryPass(links.confirm("https://d.app", "otherOrder99", SIG), "abcDEF12345")).toMatchObject({ ok: false, error: expect.stringMatching(/different order/) });
    expect(parseDeliveryPass("hello")).toMatchObject({ ok: false });
    expect(parseDeliveryPass("https://d.app/pay/abcDEF12345")).toMatchObject({ ok: false });
    expect(parseDeliveryPass("https://d.app/confirm/abcDEF12345#sig=short")).toMatchObject({ ok: false, error: expect.stringMatching(/damaged/) });
  });
});

describe("filters and search", () => {
  const order = (status: Order["status"], item = "Makhana") =>
    ({ id: "demo-order-01", status, item, delivery: { area: "Noida" }, buyer: { phoneMasked: "+91 98•••••210" }, buyerPhone: "+91 98765 43210" }) as unknown as Order & {
      buyerPhone: string;
    };

  it("maps tabs to statuses", () => {
    expect(matchesFilter(order("Funded"), "action")).toBe(true);
    expect(matchesFilter(order("Disputed"), "action")).toBe(true);
    expect(matchesFilter(order("Shipped"), "action")).toBe(false);
    expect(matchesFilter(order("Shipped"), "transit")).toBe(true);
    expect(matchesFilter(order("Expired"), "completed")).toBe(true);
    expect(matchesFilter(order("Draft"), "all")).toBe(true);
  });

  it("searches item, id, area and phone digits", () => {
    expect(matchesSearch(order("Funded", "Peri peri makhana"), "peri")).toBe(true);
    expect(matchesSearch(order("Funded"), "demo-order")).toBe(true);
    expect(matchesSearch(order("Funded"), "noida")).toBe(true);
    expect(matchesSearch(order("Funded"), "43210")).toBe(true);
    expect(matchesSearch(order("Funded"), "cheese")).toBe(false);
  });
});

describe("misc", () => {
  it("only redirects inside the seller app after login", () => {
    expect(safeNext("/seller/orders/abc")).toBe("/seller/orders/abc");
    expect(safeNext("https://evil.example")).toBe("/seller");
    expect(safeNext("/seller/login")).toBe("/seller");
    expect(safeNext(null)).toBe("/seller");
  });

  it("builds a WhatsApp share link with the pay link inside", () => {
    const url = whatsappShareUrl({ item: "Makhana", priceUnits: "2000000", payLink: "https://d.app/pay/abcDEF12345" }, "Eraya Foods", 84.2);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(url.slice("https://wa.me/?text=".length));
    expect(text).toContain("https://d.app/pay/abcDEF12345");
    expect(text).toContain("2.00 USDC");
    expect(text).toContain("₹168");
  });
});
