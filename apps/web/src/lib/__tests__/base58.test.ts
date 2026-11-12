import { describe, expect, it } from "vitest";
import { base58Decode, base58Encode } from "../base58";

describe("base58", () => {
  it("encodes known vectors", () => {
    expect(base58Encode(new TextEncoder().encode("Hello World!"))).toBe("2NEpo7TZRRrLZSi2U");
    expect(base58Encode(Uint8Array.from([0, 0, 0, 1, 2, 3]))).toBe("111Ldp");
    expect(base58Encode(new Uint8Array())).toBe("");
  });

  it("keeps leading zero bytes as '1's", () => {
    expect(base58Encode(Uint8Array.from([0]))).toBe("1");
    expect(base58Encode(Uint8Array.from([0, 0, 255]))).toBe("115Q");
  });

  it("round-trips random bytes", () => {
    for (let i = 0; i < 50; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(1 + (i % 40)));
      if (i % 5 === 0) bytes[0] = 0;
      expect(Array.from(base58Decode(base58Encode(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base58Decode("0OIl")).toThrow(/Bad base58/);
  });
});
