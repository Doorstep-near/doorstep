// One NEAR account signs every escrow call with a function-call access key
// limited to the escrow. All transactions go through one queue so nonces
// never race.
import nearApi from "near-api-js";
import { ChainError } from "../errors";
import { loadNearSecret } from "../ed25519";
import type { TxResult } from "./escrow";

export interface Relayer {
  call(method: string, args: Record<string, unknown>, gasTgas: number): Promise<TxResult>;
}

/** The slice of near-api-js's Account we use (lets tests stub it). */
export interface FunctionCaller {
  functionCall(opts: {
    contractId: string;
    methodName: string;
    args: Record<string, unknown>;
    gas: bigint;
    attachedDeposit: bigint;
  }): Promise<Outcome>;
}

interface Outcome {
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
  status?: { SuccessValue?: string } | string;
  receipts_outcome?: { outcome?: { logs?: string[] } }[];
}

export function parseOutcome(o: Outcome): TxResult {
  const hash = o.transaction?.hash ?? o.transaction_outcome?.id ?? "";
  const logs = (o.receipts_outcome ?? []).flatMap((r) => r.outcome?.logs ?? []);
  let value: unknown = null;
  const sv = typeof o.status === "object" ? o.status?.SuccessValue : undefined;
  if (sv) {
    const text = Buffer.from(sv, "base64").toString("utf8");
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
  }
  return { hash, value, logs };
}

export class QueuedRelayer implements Relayer {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private caller: FunctionCaller,
    private contractId: string,
  ) {}

  call(method: string, args: Record<string, unknown>, gasTgas: number): Promise<TxResult> {
    const run = async () => {
      try {
        const outcome = await this.caller.functionCall({
          contractId: this.contractId,
          methodName: method,
          args,
          gas: BigInt(gasTgas) * 10n ** 12n,
          attachedDeposit: 0n,
        });
        return parseOutcome(outcome);
      } catch (e) {
        if (e instanceof ChainError) throw e;
        const err = e as Error & { context?: { transactionHash?: string } };
        throw new ChainError(cleanNearError(err.message ?? String(e)), err.context?.transactionHash);
      }
    };
    const p = this.tail.then(run, run);
    this.tail = p.catch(() => undefined);
    return p;
  }
}

/** "Smart contract panicked: Order is not delivered" -> "Order is not delivered". */
export function cleanNearError(message: string): string {
  const m = /Smart contract panicked: (.*)/.exec(message);
  return (m?.[1] ?? message).slice(0, 300);
}

/** Relayer that refuses every call (live mode without a key file). */
export class MissingRelayer implements Relayer {
  constructor(private reason: string) {}
  async call(): Promise<TxResult> {
    throw new ChainError(this.reason);
  }
}

export async function createNearRelayer(opts: {
  network: string;
  rpcUrl: string;
  accountId: string;
  keyFile: string;
  contractId: string;
}): Promise<{ relayer: Relayer; publicKey: string }> {
  const { Account, Connection, InMemorySigner, KeyPair, keyStores, providers } = nearApi;
  const keyPair = KeyPair.fromString(loadNearSecret(opts.keyFile) as Parameters<typeof KeyPair.fromString>[0]);
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(opts.network, opts.accountId, keyPair);
  const provider = new providers.JsonRpcProvider({ url: opts.rpcUrl });
  const connection = new Connection(opts.network, provider, new InMemorySigner(keyStore), `jsvm.${opts.network}`);
  const account = new Account(connection, opts.accountId);
  return {
    relayer: new QueuedRelayer(account as unknown as FunctionCaller, opts.contractId),
    publicKey: keyPair.getPublicKey().toString(),
  };
}
