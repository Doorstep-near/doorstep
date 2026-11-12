import { describe, expect, it } from "vitest";
// The scripts' helpers are the ones proven on mainnet (scripts/TEST-RESULTS.md).
import { messages as scriptMessages } from "../../../scripts/lib/near.mjs";
import {
  CreateOrderRequest,
  base64ToBase64Url,
  base64UrlToBase64,
  links,
  messages,
  unitsToUsdc,
  usdcToUnits,
} from "./index";

describe("signed messages match the contract formats", () => {
  it("delivered / complaint / checker are identical to scripts/lib/near.mjs", () => {
    expect(messages.delivered("1", "escrow.shop.near")).toBe(scriptMessages.delivered("1", "escrow.shop.near"));
    expect(messages.complaint("7", "escrow.shop.near")).toBe(scriptMessages.complaint("7", "escrow.shop.near"));
    expect(messages.checker("3", "borzo:991", 1794485404, "escrow.shop.near")).toBe(
      scriptMessages.checker("3", "borzo:991", 1794485404, "escrow.shop.near"),
    );
    expect(messages.delivered("1", "e.near")).toBe("delivered|1|e.near");
  });

  it("refuses a courier ref with a pipe", () => {
    expect(() => messages.checker("1", "a|b", 1, "e.near")).toThrow();
  });
});

describe("money helpers", () => {
  it("converts USDC amounts to units and back", () => {
    expect(usdcToUnits("2")).toBe("2000000");
    expect(usdcToUnits("1.5")).toBe("1500000");
    expect(usdcToUnits("0.000001")).toBe("1");
    expect(() => usdcToUnits("1.0000001")).toThrow();
    expect(() => usdcToUnits("abc")).toThrow();
    expect(unitsToUsdc("2000000")).toBe("2.00");
    expect(unitsToUsdc("2020614", 6)).toBe("2.020614");
    expect(unitsToUsdc("2500000", 6)).toBe("2.50");
  });
});

describe("links", () => {
  it("round-trips signatures through base64url fragments", () => {
    const sig = "45J2LTOmqR1JKIyM9QTTE0SXEw9oTAPlat+H1DwqlYcDufOFWLabjP2uzFCEndz6eoQga8OAofa9ont7LZqUCA==";
    expect(base64UrlToBase64(base64ToBase64Url(sig))).toBe(sig);
    expect(links.confirm("https://doorstep.app", "abcDEF12345", sig)).toMatch(/^https:\/\/doorstep\.app\/confirm\/abcDEF12345#sig=[A-Za-z0-9_-]+$/);
  });
});

describe("request validation", () => {
  it("requires an address for Borzo delivery", () => {
    const base = {
      item: "Roasted makhana 500 g",
      priceUnits: "2000000",
      buyerPhone: "+91 98765 43210",
      deliverBy: new Date(Date.now() + 86400_000).toISOString(),
    };
    expect(CreateOrderRequest.safeParse({ ...base, deliveryMethod: "hand" }).success).toBe(true);
    expect(CreateOrderRequest.safeParse({ ...base, deliveryMethod: "borzo" }).success).toBe(false);
    expect(CreateOrderRequest.safeParse({ ...base, deliveryMethod: "borzo", deliveryAddress: "12 Sector 18, Noida" }).success).toBe(true);
  });
});
