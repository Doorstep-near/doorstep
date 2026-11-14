// "Start selling": a shop signs up with its NEAR wallet. The wallet's account is both
// the login and the payout account (paid inside NEAR Intents, withdrawable to any chain).
import { CircleCheck, Store } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { useDocumentTitle } from "../../components/layout/Layout";
import {
  Banner,
  ButtonLink,
  Card,
  Field,
  Input,
  Logo,
  ThemeToggle,
} from "../../components/ui";
import { isMock } from "../../lib/env";
import { useAppSettings } from "../../lib/query";
import { NearWalletButtons, useStartSession } from "./NearSignIn";

const POINTS = [
  "Buyers pay upfront with any crypto, from any chain. You see the money locked before you ship.",
  "You're paid in USDC to your NEAR account when the buyer confirms delivery. Withdraw to any chain.",
  "Beta: orders up to 25 USDC while we grow.",
];

export default function SellerSignup() {
  useDocumentTitle("Start selling");
  const startSession = useStartSession();
  const { demoMode } = useAppSettings();
  const practice = isMock || demoMode;
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const validate = () => {
    if (name.trim().length < 2) {
      setNameError("Enter your shop's name");
      nameRef.current?.focus();
      return false;
    }
    return true;
  };

  return (
    <div className="relative flex min-h-[calc(100dvh-2.25rem)] flex-col bg-bg">
      <div className="absolute top-3 right-3">
        <ThemeToggle />
      </div>
      <main
        id="main"
        className="flex flex-1 items-center justify-center px-4 py-12"
      >
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex justify-center">
            <Logo />
          </div>
          <Card padding="lg" raised>
            <div className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <Store aria-hidden className="size-5" />
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-text">
              Start selling on Doorstep
            </h1>
            <p className="mt-1 text-sm text-text-2">
              Get paid before you ship, and only once the parcel reaches your
              buyer. No more cash-on-delivery losses.
            </p>

            <ul className="mt-4 flex flex-col gap-2">
              {POINTS.map((p) => (
                <li
                  key={p}
                  className="flex items-start gap-2 text-sm text-text-2"
                >
                  <CircleCheck
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-brand"
                  />
                  {p}
                </li>
              ))}
            </ul>

            {practice ? (
              <div className="mt-5 flex flex-col gap-4">
                <Banner tone="warning" title="This is the practice demo">
                  Real shops sign up on the live Doorstep app with NEAR Mobile,
                  Meteor, HOT or MetaMask. Here you can try a sample shop
                  instead.
                </Banner>
                <ButtonLink to="/seller/login" size="lg" block>
                  Open the demo shop
                </ButtonLink>
              </div>
            ) : (
              <div className="mt-5 flex flex-col gap-4">
                <Field label="Shop name" error={nameError}>
                  {(a11y) => (
                    <Input
                      {...a11y}
                      ref={nameRef}
                      value={name}
                      maxLength={80}
                      autoComplete="organization"
                      placeholder="e.g. Eraya Foods"
                      onChange={(e) => {
                        setName(e.target.value);
                        setNameError(null);
                      }}
                    />
                  )}
                </Field>
                <Field
                  label="City or area"
                  optional
                  hint="Shown to buyers, e.g. Delhi."
                >
                  {(a11y) => (
                    <Input
                      {...a11y}
                      value={area}
                      maxLength={60}
                      placeholder="e.g. Delhi"
                      onChange={(e) => setArea(e.target.value)}
                    />
                  )}
                </Field>
                <NearWalletButtons
                  verb="Create shop with"
                  shop={{
                    name: name.trim(),
                    ...(area.trim() ? { area: area.trim() } : {}),
                  }}
                  validate={validate}
                  onSession={(s) => startSession(s)}
                />
              </div>
            )}
          </Card>

          <p className="mt-6 text-center text-sm text-text-3">
            Already have a shop?{" "}
            <Link
              to="/seller/login"
              className="font-medium text-brand underline-offset-2 hover:underline"
            >
              Sign in
            </Link>
            {" · "}
            <Link
              to="/"
              className="font-medium text-text-2 underline-offset-2 hover:underline"
            >
              About Doorstep
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
