// "Continue with NEAR Mobile / Meteor / HOT": the seller's wallet signs a one-time
// message (NEP-413); the backend checks it and returns a session for that shop.
import { evmSignInMessage, type SellerSession } from "@doorstep/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Banner, Button, ButtonAnchor } from "../../components/ui";
import { api, errorMessage, isApiError, sellerToken } from "../../lib/api";
import { NEAR_WALLETS, signChallenge, type NearWalletId } from "../../lib/nearWallet";
import { isMobileBrowser, signPersonalMessage, useInjectedWallet, walletAddress, walletAppLinks, walletErrorMessage, WalletError } from "../../lib/wallet";

/** Stores the session like a seller token and opens the dashboard. */
export function useStartSession() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (s: SellerSession, to = "/seller") => {
    sellerToken.set(s.token);
    qc.removeQueries({ queryKey: ["seller"] });
    navigate(to, { replace: true });
  };
}

export function NearWalletButtons({
  shop,
  validate,
  onSession,
  verb = "Continue with",
}: {
  /** Set for sign-up: creates the shop if the account has none. */
  shop?: { name: string; area?: string };
  /** Runs before the wallet opens; return false to stop (e.g. a missing shop name). */
  validate?: () => boolean;
  onSession: (s: SellerSession) => void;
  verb?: string;
}) {
  const [busy, setBusy] = useState<NearWalletId | "evm" | null>(null);
  const [error, setError] = useState<ReactNode>(null);
  const evm = useInjectedWallet();
  const signUp = shop ? { shop } : {};

  async function run(id: NearWalletId | "evm", signIn: () => Promise<SellerSession>) {
    if (validate && !validate()) return;
    setBusy(id);
    setError(null);
    try {
      onSession(await signIn());
    } catch (e) {
      if (isApiError(e, "not_found")) {
        setError(
          <>
            There's no shop for this NEAR account yet.{" "}
            <Link to="/seller/signup" className="font-semibold underline underline-offset-2">
              Create your shop
            </Link>
          </>,
        );
      } else if (id === "evm" && !isApiError(e)) {
        setError(e instanceof WalletError ? e.message : walletErrorMessage(e));
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(null);
    }
  }

  // NEAR wallets sign our challenge with NEP-413.
  const pick = (id: NearWalletId) =>
    run(id, async () => {
      const challenge = await api.seller.auth.challenge();
      const sig = await signChallenge(id, challenge);
      return api.seller.auth.near({ ...sig, nonce: challenge.nonce, ...signUp });
    });

  // MetaMask & co. sign the challenge text with personal_sign; the 0x address is the payout account.
  const pickEvm = () =>
    run("evm", async () => {
      const challenge = await api.seller.auth.challenge();
      const address = await walletAddress(evm!);
      const signature = await signPersonalMessage(evm!, address, evmSignInMessage(challenge.nonce, challenge.recipient));
      return api.seller.auth.evm({ address, signature, nonce: challenge.nonce, ...signUp });
    });

  return (
    <div className="flex flex-col gap-2.5">
      {NEAR_WALLETS.map((w) => (
        <Button
          key={w.id}
          variant={w.id === "near-mobile-wallet" ? "primary" : "secondary"}
          size="lg"
          block
          icon={<Wallet aria-hidden className="size-4" />}
          loading={busy === w.id}
          loadingText="Waiting for your wallet…"
          disabled={busy !== null && busy !== w.id}
          onClick={() => pick(w.id)}
          title={w.hint}
        >
          {verb} {w.name}
        </Button>
      ))}
      {evm ? (
        <Button
          variant="secondary"
          size="lg"
          block
          icon={<Wallet aria-hidden className="size-4" />}
          loading={busy === "evm"}
          loadingText="Waiting for your wallet…"
          disabled={busy !== null && busy !== "evm"}
          onClick={pickEvm}
          title="MetaMask, Coinbase Wallet, Rabby or another browser wallet. Payouts go to this 0x address in NEAR Intents."
        >
          {verb} MetaMask
        </Button>
      ) : isMobileBrowser() ? (
        <ButtonAnchor href={walletAppLinks(window.location.href)[0]!.href} variant="secondary" size="lg" block icon={<Wallet aria-hidden className="size-4" />}>
          Open in MetaMask
        </ButtonAnchor>
      ) : (
        <Button variant="secondary" size="lg" block disabled icon={<Wallet aria-hidden className="size-4" />} title="Install MetaMask or another browser wallet, or use a NEAR wallet above.">
          MetaMask (not installed)
        </Button>
      )}
      {error && (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      )}
      <p className="text-xs text-text-3">Your wallet signs a one-time message to prove you own the account. It costs nothing and moves no money.</p>
    </div>
  );
}
