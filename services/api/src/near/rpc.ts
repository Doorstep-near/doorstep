import { ChainError } from "../errors";

export type Viewer = <T>(contract: string, method: string, args: Record<string, unknown>) => Promise<T>;

/** Read-only contract call over NEAR JSON-RPC (same request as scripts/lib/near.mjs). */
export function rpcViewer(rpcUrl: string, fetchFn: typeof fetch = fetch): Viewer {
  return async <T>(contract: string, method: string, args: Record<string, unknown>): Promise<T> => {
    let body: { error?: unknown; result?: { error?: string; result?: number[] } };
    try {
      const res = await fetchFn(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "doorstep",
          method: "query",
          params: {
            request_type: "call_function",
            // "optimistic" so we see our own relayer transactions right away (the
            // relayer waits for execution); NEAR's doomslug makes reverts negligible.
            finality: "optimistic",
            account_id: contract,
            method_name: method,
            args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      body = (await res.json()) as typeof body;
    } catch (e) {
      throw new ChainError(`NEAR RPC unreachable: ${(e as Error).message}`);
    }
    if (body.error) throw new ChainError(`RPC error on ${method}: ${JSON.stringify(body.error).slice(0, 300)}`);
    if (body.result?.error) throw new ChainError(`View ${method} failed: ${body.result.error}`);
    const text = Buffer.from(body.result?.result ?? []).toString("utf8");
    return (text ? JSON.parse(text) : null) as T;
  };
}

/** "full" for a full-access key, "function" for a function-call key, "none" if the account has no such key. */
export type AccessKeyKind = "full" | "function" | "none";
export type AccessKeyChecker = (accountId: string, publicKey: string) => Promise<AccessKeyKind>;

/** Reads an access key over NEAR JSON-RPC (view_access_key). */
export function rpcAccessKey(rpcUrl: string, fetchFn: typeof fetch = fetch): AccessKeyChecker {
  return async (accountId, publicKey) => {
    let body: { error?: unknown; result?: { error?: string; permission?: unknown } };
    try {
      const res = await fetchFn(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "doorstep",
          method: "query",
          params: { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      body = (await res.json()) as typeof body;
    } catch (e) {
      throw new ChainError(`NEAR RPC unreachable: ${(e as Error).message}`);
    }
    // Unknown account or key: the RPC answers with an error.
    if (body.error || body.result?.error) return "none";
    const p = body.result?.permission;
    if (p === "FullAccess") return "full";
    return p ? "function" : "none";
  };
}
