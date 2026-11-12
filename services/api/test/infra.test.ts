import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Db } from "../src/db";
import { loadSignerFile, nearSecretFromJwk, newSigner, verifyEd25519 } from "../src/ed25519";
import { createNearRelayer } from "../src/near/relayer";

const dir = mkdtempSync(join(tmpdir(), "doorstep-api-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("SQLite claims", () => {
  it("only one of two connections to the same file wins a claim; it can be taken again after the TTL", () => {
    const path = join(dir, "claims.sqlite");
    const a = new Db(path);
    const b = new Db(path);
    expect(a.claim("release:x", 1000, 60_000)).toBe(true);
    expect(b.claim("release:x", 1001, 60_000)).toBe(false);
    expect(a.claim("release:x", 1002, 60_000)).toBe(false);
    expect(b.claim("release:x", 61_001, 60_000)).toBe(true);
    expect(b.claim("refund:x", 1000, 60_000)).toBe(true);
    a.close();
    b.close();
  });
});

describe("relayer key file", () => {
  it("builds a near-api-js signer from a NEAR credentials file without touching the network", async () => {
    const key = newSigner();
    const file = join(dir, "relayer.json");
    writeFileSync(file, JSON.stringify({ account_id: "relayer.test.near", public_key: key.publicKey, private_key: nearSecretFromJwk(key.jwk) }), { mode: 0o600 });
    const r = await createNearRelayer({ network: "mainnet", rpcUrl: "http://127.0.0.1:9", accountId: "relayer.test.near", keyFile: file, contractId: "escrow.test.near" });
    expect(r.publicKey).toBe(key.publicKey);
    // The same file also works as a checker-style signer.
    const s = loadSignerFile(file);
    expect(s.publicKey).toBe(key.publicKey);
    expect(verifyEd25519(key.publicKey, "x", s.sign("x"))).toBe(true);
  });
});

describe("scripts/add-relayer-key.sh helper", () => {
  it("writes the key file with mode 0600 and prints only the public key", async () => {
    const { execFileSync } = await import("node:child_process");
    const file = join(dir, "gen", "relayer.json");
    const script = readFileSync(new URL("../../../scripts/add-relayer-key.sh", import.meta.url), "utf8");
    const helper = /<<'NODE'\n([\s\S]*?)\nNODE/.exec(script)![1]!;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", helper, file, "relayer.test.near"], { encoding: "utf8" }).trim();
    expect(out).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.public_key).toBe(out);
    expect(out).not.toContain(saved.private_key.slice(8, 20));
    expect(loadSignerFile(file).publicKey).toBe(out);
  });
});
