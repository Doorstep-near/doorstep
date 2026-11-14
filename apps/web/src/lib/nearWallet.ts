// Seller sign-in with a NEAR wallet: the wallet signs our one-time challenge (NEP-413).
// The wallet code is loaded only when a seller picks a wallet, so other pages stay light.
import type { AuthChallenge } from "@doorstep/shared";
import type { WalletSelector } from "@near-wallet-selector/core";

export type NearWalletId = "near-mobile-wallet" | "meteor-wallet" | "here-wallet";

export const NEAR_WALLETS: { id: NearWalletId; name: string; hint: string }[] = [
  { id: "near-mobile-wallet", name: "NEAR Mobile", hint: "Scan the QR code with the NEAR Mobile app, or open it on this phone" },
  { id: "meteor-wallet", name: "Meteor", hint: "Meteor extension or web wallet" },
  { id: "here-wallet", name: "HOT", hint: "HOT wallet app or Telegram" },
];

let selector: Promise<WalletSelector> | null = null;

function getSelector(): Promise<WalletSelector> {
  selector ??= (async () => {
    // The wallet libraries expect Node's Buffer and `global`; browsers don't have them.
    const { Buffer } = await import("buffer");
    const g = globalThis as { Buffer?: unknown; global?: unknown; process?: unknown };
    g.Buffer ??= Buffer;
    g.global ??= globalThis;
    g.process ??= { env: {}, browser: true, version: "", nextTick: (fn: () => void) => queueMicrotask(fn) };
    const [{ setupWalletSelector }, { setupNearMobileWallet }, { setupMeteorWallet }, { setupHereWallet }] = await Promise.all([
      import("@near-wallet-selector/core"),
      import("@near-wallet-selector/near-mobile-wallet"),
      import("@near-wallet-selector/meteor-wallet"),
      import("@near-wallet-selector/here-wallet"),
    ]);
    return setupWalletSelector({
      network: "mainnet",
      modules: [
        // NEAR Mobile's relay accepts only public https addresses here; leave them out on localhost.
        setupNearMobileWallet(
          window.location.protocol === "https:"
            ? { dAppMetadata: { name: "Doorstep", logoUrl: `${window.location.origin}/favicon.svg`, url: window.location.origin } }
            : {},
        ),
        setupMeteorWallet(),
        setupHereWallet(),
      ],
    });
  })().catch((e) => {
    selector = null; // let the next click try again
    throw e;
  });
  return selector;
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface NearSignature {
  accountId: string;
  publicKey: string;
  signature: string;
}

/** Asks the chosen wallet to sign the challenge. Resolves with the account, key and signature. */
export async function signChallenge(walletId: NearWalletId, c: AuthChallenge): Promise<NearSignature> {
  const wallet = await (await getSelector()).wallet(walletId);
  if (!("signMessage" in wallet) || typeof wallet.signMessage !== "function") throw new Error("This wallet can't sign messages. Try another one.");
  // Wallets expect the nonce as a Buffer (available once getSelector() has run).
  const { Buffer } = await import("buffer");
  const res = await wallet.signMessage({ message: c.message, recipient: c.recipient, nonce: Buffer.from(fromBase64(c.nonce)) as never });
  if (!res) throw new Error("The wallet didn't return a signature. Please try again.");
  return { accountId: res.accountId, publicKey: res.publicKey, signature: res.signature };
}
