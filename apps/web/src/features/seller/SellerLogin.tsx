import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Eye, EyeOff, FlaskConical, KeyRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useDocumentTitle } from "../../components/layout/Layout";
import { Banner, Button, ButtonLink, Card, Field, Input, Logo, ThemeToggle } from "../../components/ui";
import { api, errorMessage, isApiError, sellerToken } from "../../lib/api";
import { isMock, setSandbox } from "../../lib/env";
import { useAppSettings } from "../../lib/query";
import { safeNext } from "./sellerUtils";

export default function SellerLogin() {
  useDocumentTitle("Seller sign-in");
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { demoMode, config } = useAppSettings();

  const existing = sellerToken.get();
  const [token, setToken] = useState(isMock ? "demo" : "");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const touched = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // In demo mode the token is "demo": prefill it once config arrives (unless the person typed).
  useEffect(() => {
    if (demoMode && !touched.current && !token) setToken("demo");
  }, [demoMode, token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = token.trim();
    if (!value) {
      setError("Enter your seller token");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setOffline(false);
    sellerToken.set(value);
    try {
      await api.seller.summary();
      qc.removeQueries({ queryKey: ["seller"] });
      navigate(next, { replace: true });
    } catch (err) {
      sellerToken.clear();
      if (isApiError(err, "network")) setOffline(true);
      setError(isApiError(err, "unauthorized") ? "That token isn't right. Check it and try again." : errorMessage(err));
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-[calc(100dvh-2.25rem)] flex-col bg-bg">
      <div className="absolute top-3 right-3">
        <ThemeToggle />
      </div>
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex justify-center">
            <Logo />
          </div>
          <Card padding="lg" raised>
            <div className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <KeyRound aria-hidden className="size-5" />
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-text">Seller sign-in</h1>
            <p className="mt-1 text-sm text-text-2">
              {config?.shopName ? (
                <>
                  Manage orders for <span className="font-medium text-text">{config.shopName}</span>.
                </>
              ) : (
                "Create pay links, ship orders and get paid on delivery."
              )}
            </p>

            {demoMode && (
              <Banner tone="warning" icon={FlaskConical} className="mt-5">
                Demo mode — the seller token is <span className="mono font-semibold">demo</span>. We've filled it in for you.
              </Banner>
            )}

            <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4" noValidate>
              <Field label="Seller token" error={error} hint={!error ? "Set as SELLER_TOKEN when the API was deployed." : undefined}>
                {(a11y) => (
                  <div className="relative">
                    <Input
                      {...a11y}
                      ref={inputRef}
                      type={show ? "text" : "password"}
                      autoComplete="current-password"
                      spellCheck={false}
                      autoCapitalize="none"
                      value={token}
                      onChange={(e) => {
                        touched.current = true;
                        setToken(e.target.value);
                        setError(null);
                      }}
                      className="pr-12 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((s) => !s)}
                      aria-label={show ? "Hide token" : "Show token"}
                      aria-pressed={show}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-text-3 hover:text-text"
                    >
                      {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
                    </button>
                  </div>
                )}
              </Field>
              {offline && !isMock && (
                <Banner
                  tone="info"
                  title="Can't reach the Doorstep API"
                  action={
                    <Button size="sm" variant="secondary" onClick={() => setSandbox(true, "/seller/login")}>
                      Explore with sample data
                    </Button>
                  }
                >
                  The backend may not be running. You can still try the full flow with sample data stored in your browser.
                </Banner>
              )}
              <Button type="submit" size="lg" block loading={busy} loadingText="Signing in…" iconRight={<ArrowRight aria-hidden className="size-4" />}>
                Sign in
              </Button>
            </form>

            {existing && (
              <div className="mt-4 border-t border-border pt-4 text-center">
                <ButtonLink to={next} variant="ghost" size="sm">
                  Continue to dashboard
                </ButtonLink>
              </div>
            )}
          </Card>

          <p className="mt-6 text-center text-sm text-text-3">
            {isMock ? (
              <>Sample data lives only in this browser. </>
            ) : (
              <>
                No backend handy?{" "}
                <button type="button" onClick={() => setSandbox(true, "/seller/login")} className="font-medium text-brand underline-offset-2 hover:underline">
                  Explore with sample data
                </button>
                .{" "}
              </>
            )}
            <Link to="/" className="font-medium text-text-2 underline-offset-2 hover:underline">
              About Doorstep
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
