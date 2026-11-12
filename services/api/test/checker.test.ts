import { describe, expect, it } from "vitest";
import { messages } from "@doorstep/shared";
import { Checker } from "../src/checker";
import { signerFromNearSecret, verifyEd25519 } from "../src/ed25519";
import { LiveEscrow } from "../src/near/escrow";
import { b58encode } from "../src/util";
import { ESCROW, StubChain, fixedKey } from "./helpers";

// scripts/lib/near.mjs is the implementation proven on mainnet (scripts/TEST-RESULTS.md).
const nearMjsPath = "../../../scripts/lib/near.mjs";

describe("ed25519 implementation", () => {
  it("matches RFC 8032 test vector 1", () => {
    const seed = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
    const pub = Buffer.from("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex");
    const signer = signerFromNearSecret("ed25519:" + b58encode(Buffer.concat([seed, pub])));
    expect(signer.publicKey).toBe("ed25519:" + b58encode(pub));
    const expected =
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";
    expect(Buffer.from(signer.sign(""), "base64").toString("hex")).toBe(expected);
  });

  it("rejects malformed keys and signatures instead of throwing", () => {
    const k = fixedKey();
    expect(verifyEd25519("ed25519:xyz", "m", k.sign("m"))).toBe(false);
    expect(verifyEd25519(k.publicKey, "m", "not base64!")).toBe(false);
    expect(verifyEd25519(k.publicKey, "m", Buffer.alloc(63).toString("base64"))).toBe(false);
  });
});

describe("checker signature", () => {
  it("signs exactly the contract's checker message with a fixed key, verifiable by the mainnet-proven script helper", async () => {
    const key = fixedKey();
    const chain = new StubChain();
    const escrow = new LiveEscrow(ESCROW, chain.viewer, chain.relayer);
    const signedAt = 1794485404;
    const checker = new Checker(key, escrow, () => signedAt * 1000 + 999);

    await checker.confirm("3", "borzo:991");

    const call = chain.calls[0]!;
    expect(call.method).toBe("confirm_by_checker");
    expect(call.gasTgas).toBe(30);
    expect(call.args).toMatchObject({ order_id: "3", courier_ref: "borzo:991", signed_at: "1794485404" });

    // The literal text from contracts/escrow/src/lib.rs checker_message().
    const exact = `checker|delivered|3|borzo:991|1794485404|${ESCROW}`;
    expect(messages.checker("3", "borzo:991", signedAt, ESCROW)).toBe(exact);
    const signature = call.args.signature as string;
    expect(Buffer.from(signature, "base64")).toHaveLength(64);
    expect(verifyEd25519(key.publicKey, exact, signature)).toBe(true);

    const near = await import(/* @vite-ignore */ nearMjsPath);
    expect(near.verifyMessage(key.publicKey, exact, signature)).toBe(true);
    expect(near.messages.checker("3", "borzo:991", signedAt, ESCROW)).toBe(exact);
    // ed25519 is deterministic: the same fixed key and text always give this signature.
    expect(signature).toBe(key.sign(exact));
    // A different ref, time or contract does not verify.
    expect(verifyEd25519(key.publicKey, `checker|delivered|3|borzo:992|1794485404|${ESCROW}`, signature)).toBe(false);
    expect(verifyEd25519(key.publicKey, `checker|delivered|3|borzo:991|1794485405|${ESCROW}`, signature)).toBe(false);
  });

  it("refuses refs the contract would reject, and refuses to sign without a key", () => {
    const chain = new StubChain();
    const escrow = new LiveEscrow(ESCROW, chain.viewer, chain.relayer);
    const checker = new Checker(fixedKey(), escrow);
    expect(() => checker.sign("1", "a|b", 1)).toThrow();
    expect(() => checker.sign("1", "", 1)).toThrow();
    expect(() => checker.sign("1", "x".repeat(129), 1)).toThrow();
    expect(() => new Checker(null, escrow).sign("1", "hand", 1)).toThrow(/not configured/);
  });

  it("loads the same key from scripts/keys.mjs's JWK format and NEAR's secret format", async () => {
    const near = await import(/* @vite-ignore */ nearMjsPath);
    const k = near.newKey();
    const { signerFromJwk, nearSecretFromJwk } = await import("../src/ed25519");
    const a = signerFromJwk(k.jwk);
    const b = signerFromNearSecret(nearSecretFromJwk(k.jwk));
    expect(a.publicKey).toBe(k.publicKey);
    expect(b.publicKey).toBe(k.publicKey);
    expect(near.verifyMessage(k.publicKey, "hi", b.sign("hi"))).toBe(true);
  });
});
