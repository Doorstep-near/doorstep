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
