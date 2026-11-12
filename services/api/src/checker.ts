// The delivery checker: signs messages.checker(...) with its own ed25519 key
// and submits confirm_by_checker. The key never appears in logs.
import { messages } from "@doorstep/shared";
import type { Ed25519Signer } from "./ed25519";
import { AppError } from "./errors";
import type { Escrow, TxResult } from "./near/escrow";

export const CHECKER_REF_RE = /^[^|]{1,128}$/;

export class Checker {
  constructor(
    private signer: Ed25519Signer | null,
    private escrow: Escrow,
    private now: () => number = Date.now,
  ) {}

  get publicKey(): string | null {
    return this.signer?.publicKey ?? null;
  }

  /** Builds and signs the exact text the contract checks. */
  sign(chainOrderId: string, courierRef: string, signedAt: number): string {
    if (!this.signer) throw new AppError("internal", "Checker key is not configured (CHECKER_KEY_FILE)");
    if (!CHECKER_REF_RE.test(courierRef)) throw new AppError("invalid_input", "Courier reference must be 1-128 characters without |");
    return this.signer.sign(messages.checker(chainOrderId, courierRef, signedAt, this.escrow.account));
  }

  async confirm(chainOrderId: string, courierRef: string): Promise<TxResult> {
    const signedAt = Math.floor(this.now() / 1000);
    const signature = this.sign(chainOrderId, courierRef, signedAt);
    return this.escrow.confirmByChecker(chainOrderId, courierRef, signedAt, signature);
  }
}
