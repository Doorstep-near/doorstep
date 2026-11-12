// Exact texts that get signed with ed25519. The first three must match the
// escrow contract byte for byte (contracts/escrow/src/lib.rs: delivered_message,
// complaint_message, checker_message) and scripts/lib/near.mjs.
// Signatures travel as standard base64 of the 64 signature bytes.

export const messages = {
  /** Buyer: "I have the parcel". Submitted with confirm_by_buyer. */
  delivered: (chainOrderId: string, contract: string) => `delivered|${chainOrderId}|${contract}`,

  /** Buyer: "something is wrong". Submitted with raise_complaint inside the window. */
  complaint: (chainOrderId: string, contract: string) => `complaint|${chainOrderId}|${contract}`,

  /**
   * Checker service: delivery proven by a courier or a 6-digit code.
   * `courierRef` is 1-128 chars without "|"; it must equal the order's stored
   * courier_ref when one is set. `signedAt` is unix seconds.
   */
  checker: (chainOrderId: string, courierRef: string, signedAt: number | string, contract: string) => {
    if (courierRef.includes("|")) throw new Error("courierRef cannot contain |");
    return `checker|delivered|${chainOrderId}|${courierRef}|${signedAt}|${contract}`;
  },

  /**
   * App-level only (never sent to the contract): the buyer asks the API to
   * reveal a 6-digit delivery code. Proves the request comes from the buyer's
   * key, so the seller cannot read the code from the public order view.
   * `signedAt` is unix seconds; the API accepts it for 5 minutes.
   */
  otpReveal: (chainOrderId: string, contract: string, signedAt: number | string) =>
    `otp|${chainOrderId}|${contract}|${signedAt}`,
} as const;
