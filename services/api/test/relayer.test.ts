import { describe, expect, it } from "vitest";
import { GAS_DEFAULT_TGAS, GAS_PAYOUT_TGAS, LiveEscrow, orderIdFromResult } from "../src/near/escrow";
import { cleanNearError, parseOutcome, QueuedRelayer, type FunctionCaller } from "../src/near/relayer";
import { rpcViewer } from "../src/near/rpc";
import { ChainError } from "../src/errors";
import { ESCROW, fakeFetch } from "./helpers";

const TGAS = 10n ** 12n;
const ok = (value?: unknown, logs: string[] = []) => ({
  transaction: { hash: "TxHash111" },
  status: { SuccessValue: value === undefined ? "" : Buffer.from(JSON.stringify(value)).toString("base64") },
  receipts_outcome: [{ outcome: { logs } }],
});

function stubAccount(respond: (method: string) => unknown = () => ok()) {
  const calls: Parameters<FunctionCaller["functionCall"]>[0][] = [];
  const caller: FunctionCaller = {
    functionCall: async (opts) => {
      calls.push(opts);
      return respond(opts.methodName) as never;
    },
  };
  return { caller, calls };
}

describe("relayer calls: method, args, gas", () => {
  const sig = "A".repeat(86) + "==";

  it("sends every escrow method with the contract's argument names, 0 deposit, and the right gas", async () => {
    const { caller, calls } = stubAccount((m) => (m === "create_order" ? ok("7") : ok()));
    const escrow = new LiveEscrow(ESCROW, async () => null as never, new QueuedRelayer(caller, ESCROW));

    const created = await escrow.createOrder({ seller: "shop.near", price: "2000000", deadline_ms: "1794571200000", buyer_pk: "ed25519:abc", buyer_refund: "buyer.near" });
    await escrow.markShipped("7", "borzo:123");
    await escrow.confirmByBuyer("7", sig);
    await escrow.confirmByChecker("7", "borzo:123", 1794485404, sig);
    await escrow.raiseComplaint("7", sig);
    await escrow.release("7");
    await escrow.refund("7");

    expect(created.orderId).toBe("7");
    expect(created.hash).toBe("TxHash111");
    expect(calls.map((c) => [c.contractId, c.methodName, c.gas, c.attachedDeposit])).toEqual([
      [ESCROW, "create_order", 30n * TGAS, 0n],
      [ESCROW, "mark_shipped", 30n * TGAS, 0n],
      [ESCROW, "confirm_by_buyer", 30n * TGAS, 0n],
      [ESCROW, "confirm_by_checker", 30n * TGAS, 0n],
      [ESCROW, "raise_complaint", 30n * TGAS, 0n],
      [ESCROW, "release", 100n * TGAS, 0n],
      [ESCROW, "refund", 100n * TGAS, 0n],
    ]);
    expect(calls.map((c) => c.args)).toEqual([
      { seller: "shop.near", price: "2000000", deadline_ms: "1794571200000", buyer_pk: "ed25519:abc", buyer_refund: "buyer.near" },
      { order_id: "7", courier_ref: "borzo:123" },
      { order_id: "7", signature: sig },
      { order_id: "7", courier_ref: "borzo:123", signed_at: "1794485404", signature: sig },
      { order_id: "7", signature: sig },
      { order_id: "7" },
      { order_id: "7" },
    ]);
    expect(GAS_DEFAULT_TGAS).toBe(30);
    expect(GAS_PAYOUT_TGAS).toBe(100);
  });

  it("reads the order id from the return value, or from the order_created event", () => {
    expect(orderIdFromResult({ hash: "h", value: "12", logs: [] })).toBe("12");
    const log = 'EVENT_JSON:{"standard":"doorstep","version":"1.0.0","event":"order_created","data":[{"order_id":"9","seller":"s.near"}]}';
    expect(orderIdFromResult({ hash: "h", value: null, logs: ["other", log] })).toBe("9");
    expect(() => orderIdFromResult({ hash: "h", value: null, logs: [] })).toThrow();
    expect(parseOutcome(ok("5", [log]))).toEqual({ hash: "TxHash111", value: "5", logs: [log] });
  });

  it("serialises transactions through one queue (nonce safety)", async () => {
    let active = 0;
    let maxActive = 0;
    const caller: FunctionCaller = {
      functionCall: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return ok() as never;
      },
    };
    const relayer = new QueuedRelayer(caller, ESCROW);
    await Promise.all([1, 2, 3, 4, 5].map((i) => relayer.call("mark_shipped", { order_id: String(i), courier_ref: "hand" }, 30)));
    expect(maxActive).toBe(1);
  });

  it("turns contract panics into ChainError with the panic text, and keeps the queue alive", async () => {
    let n = 0;
    const caller: FunctionCaller = {
      functionCall: async () => {
        if (n++ === 0) throw Object.assign(new Error("Transaction X failed. Smart contract panicked: Order is not delivered"), { context: { transactionHash: "BadTx" } });
        return ok() as never;
      },
    };
    const relayer = new QueuedRelayer(caller, ESCROW);
    const err = await relayer.call("release", { order_id: "1" }, 100).catch((e) => e);
    expect(err).toBeInstanceOf(ChainError);
    expect(err.message).toBe("Order is not delivered");
    expect(err.txHash).toBe("BadTx");
    await expect(relayer.call("release", { order_id: "2" }, 100)).resolves.toMatchObject({ hash: "TxHash111" });
    expect(cleanNearError("plain")).toBe("plain");
  });
});

describe("RPC view helper", () => {
  it("sends a call_function query and decodes the JSON result", async () => {
    const result = Buffer.from(JSON.stringify({ id: "1", status: "Created" }));
    const { fn, requests } = fakeFetch({ "POST /": () => ({ jsonrpc: "2.0", id: "doorstep", result: { result: [...result] } }) });
    const view = rpcViewer("https://rpc.example.org/", fn);
    await expect(view(ESCROW, "get_order", { order_id: "1" })).resolves.toEqual({ id: "1", status: "Created" });
    const params = (requests[0]!.body as { params: Record<string, string> }).params;
    expect(params.request_type).toBe("call_function");
    expect(params.account_id).toBe(ESCROW);
    expect(params.method_name).toBe("get_order");
    expect(JSON.parse(Buffer.from(params.args_base64!, "base64").toString())).toEqual({ order_id: "1" });
  });

  it("raises ChainError on RPC errors", async () => {
    const { fn } = fakeFetch({ "POST /": () => ({ jsonrpc: "2.0", id: "doorstep", result: { error: "wasm execution failed" } }) });
    await expect(rpcViewer("https://rpc.example.org/", fn)(ESCROW, "get_order", {})).rejects.toBeInstanceOf(ChainError);
  });
});
