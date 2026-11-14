import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { inrEstimate } from "@doorstep/shared";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Coins,
  Globe,
  KeyRound,
  Landmark,
  Link2,
  PackageCheck,
  QrCode,
  ShieldCheck,
  Store,
  Timer,
  type LucideIcon,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import {
  ProtectedBadge,
  useDocumentTitle,
} from "../../components/layout/Layout";
import {
  Button,
  ButtonAnchor,
  ButtonLink,
  Card,
  GitHubIcon,
  Logo,
  Skeleton,
  ThemeToggle,
  TokenIcon,
} from "../../components/ui";
import { api } from "../../lib/api";
import { env, isMock, setSandbox } from "../../lib/env";
import { usdc } from "../../lib/format";
import { qk, useAppSettings } from "../../lib/query";

const CONTRACT_URL = `${env.githubUrl}/tree/main/contracts/escrow`;
const DEMO_PAY_PATH = "/pay/demo-mom-gift";

/**
 * "Try the demo": the demo sign-in (token "demo" pre-filled). Uses the API's demo mode if it
 * has one, otherwise sample data in the browser. Real shops use "Sign in" / "Start selling".
 */
function useTryDemo() {
  const navigate = useNavigate();
  const { demoMode, loading } = useAppSettings();
  return () => {
    if (demoMode || loading) navigate("/seller/login");
    else setSandbox(true, "/seller/login");
  };
}

/** True on the live (real-money) site: show the real seller sign-in and sign-up. */
function useLiveSite() {
  const { demoMode, loading } = useAppSettings();
  return !isMock && !demoMode && !loading;
}

// ------------------------------------------------------------------ page

export default function LandingPage() {
  useDocumentTitle("Pay any shop with any crypto");
  return (
    <div className="flex min-h-dvh flex-col">
      <TopNav />
      <main id="main" className="flex-1">
        <Hero />
        <LiveStats />
        <HowItWorks />
        <TrustPoints />
        <IndiaStory />
        <TrustModel />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

// ------------------------------------------------------------------ nav

function TopNav() {
  const tryDemo = useTryDemo();
  const live = useLiveSite();
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6"
      >
        <Logo />
        <div className="ml-8 hidden items-center gap-1 md:flex">
          <a
            href="#how-it-works"
            className="rounded-lg px-3 py-2 text-sm font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            How it works
          </a>
          <a
            href="#trust-model"
            className="rounded-lg px-3 py-2 text-sm font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            Trust model
          </a>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <a
            href={env.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Doorstep on GitHub (opens in a new tab)"
            className="hidden size-10 items-center justify-center rounded-lg text-text-2 transition-colors hover:bg-surface-2 hover:text-text sm:inline-flex"
          >
            <GitHubIcon className="size-[18px]" />
          </a>
          <ThemeToggle />
          {live && (
            <ButtonLink
              to="/seller/login"
              variant="ghost"
              size="sm"
              className="ml-1"
            >
              Sign in
            </ButtonLink>
          )}
          <Button size="sm" onClick={tryDemo} className="ml-1">
            Try the demo
          </Button>
        </div>
      </nav>
    </header>
  );
}

// ------------------------------------------------------------------ hero

function Hero() {
  const tryDemo = useTryDemo();
  const live = useLiveSite();
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative overflow-hidden"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 60% at 78% 35%, var(--color-brand-soft), transparent 70%), radial-gradient(40% 40% at 10% 0%, var(--color-surface-2), transparent 70%)",
        }}
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-16 sm:px-6 sm:pt-16 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16 lg:pt-24 lg:pb-24">
        <div className="animate-rise-in">
          <span className="inline-flex h-7 items-center gap-2 rounded-full border border-border bg-surface px-3 text-xs font-medium text-text-2 shadow-card">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden />
            Built on NEAR Intents
          </span>
          <h1
            id="hero-heading"
            className="mt-5 text-3xl leading-[1.15] font-semibold tracking-[-0.025em] text-balance text-text sm:text-5xl sm:leading-[1.08]"
          >
            Pay any shop with any crypto.{" "}
            <span className="text-brand">
              They get paid when it reaches your door.
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-pretty text-text-2 sm:text-lg sm:leading-8">
            Your payment waits in a NEAR smart contract and is released only
            when delivery is proven. Not delivered on time? Automatic refund.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              size="lg"
              onClick={tryDemo}
              iconRight={<ArrowRight aria-hidden className="size-4" />}
            >
              Try the demo
            </Button>
            {live && (
              <ButtonLink
                to="/seller/signup"
                variant="secondary"
                size="lg"
                icon={<Store aria-hidden className="size-[18px]" />}
              >
                Start selling
              </ButtonLink>
            )}
            <ButtonAnchor
              href={env.githubUrl}
              target="_blank"
              variant="secondary"
              size="lg"
              icon={<GitHubIcon className="size-[18px]" />}
            >
              View on GitHub
            </ButtonAnchor>
          </div>
          {isMock && (
            <p className="mt-4 text-sm text-text-2">
              Or{" "}
              <Link
                to={DEMO_PAY_PATH}
                className="font-medium text-brand underline-offset-2 hover:underline"
              >
                see the buyer's pay page
              </Link>
              .
            </p>
          )}
          <p className="mt-6 flex items-center gap-2 text-sm text-text-3">
            <BadgeCheck aria-hidden className="size-4 shrink-0 text-brand" />
            Pay-in through 1Click and payout to the shop proven on NEAR mainnet.
          </p>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

/** A static, labelled illustration of the buyer's pay screen built from real components. */
function HeroVisual() {
  const { inrPerUsd } = useAppSettings();
  const tiles = [
    { symbol: "USDC", chain: "base", label: "Base", selected: true },
    { symbol: "USDT", chain: "tron", label: "Tron" },
    { symbol: "ETH", chain: "eth", label: "Ethereum" },
    { symbol: "SOL", chain: "sol", label: "Solana" },
  ];
  const progress = ["Payment seen", "Converted to USDC", "Held safely"];
  return (
    <figure className="relative mx-auto w-full max-w-[400px] lg:mr-0">
      <figcaption className="sr-only">
        Illustration: a Doorstep pay page for Eraya Foods. A makhana gift box
        costs 12.00 USDC; the buyer picks USDC on Base, and the payment shows as
        held safely.
      </figcaption>
      <div aria-hidden className="relative">
        <Card padding="none" raised className="overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-waiting-bg text-sm font-bold text-waiting">
                EF
              </span>
              <div>
                <p className="text-sm font-semibold text-text">Eraya Foods</p>
                <p className="text-xs text-text-3">Delhi</p>
              </div>
            </div>
            <ProtectedBadge />
          </div>
          <div className="px-5 pt-4 pb-5">
            <p className="text-sm text-text-2">Makhana gift box · 4 flavours</p>
            <p className="mt-0.5 text-xs text-text-3">
              “For Mom — Happy Diwali!”
            </p>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="tabular text-4xl font-semibold tracking-tight text-text">
                12.00
              </span>
              <span className="text-base font-semibold text-text-2">USDC</span>
            </div>
            <p className="tabular text-sm text-text-3">
              ≈ {inrEstimate("12000000", inrPerUsd)}
            </p>

            <p className="mt-5 text-xs font-semibold tracking-wide text-text-3 uppercase">
              Pay with
            </p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {tiles.map((t) => (
                <div
                  key={t.symbol + t.chain}
                  className={clsx(
                    "flex flex-col items-center gap-1 rounded-xl border px-1 py-2",
                    t.selected
                      ? "border-brand bg-brand-soft shadow-[0_0_0_1px_var(--color-brand)]"
                      : "border-border bg-surface",
                  )}
                >
                  <TokenIcon symbol={t.symbol} chain={t.chain} size={26} />
                  <span className="text-[11px] leading-tight font-semibold text-text">
                    {t.symbol}
                  </span>
                  <span className="text-[10px] leading-tight text-text-3">
                    {t.label}
                  </span>
                </div>
              ))}
            </div>

            <ol className="mt-5 flex flex-col gap-2.5 rounded-xl bg-surface-2 p-3.5">
              {progress.map((p, i) => (
                <li key={p} className="flex items-center gap-2.5 text-sm">
                  <span className="flex size-5 items-center justify-center rounded-full bg-brand text-on-brand">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                  <span
                    className={clsx(
                      i === progress.length - 1
                        ? "font-semibold text-text"
                        : "text-text-2",
                    )}
                  >
                    {p}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </Card>
        <div className="absolute -bottom-6 -left-4 hidden animate-rise-in items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-raised sm:flex lg:-left-10">
          <span className="flex size-9 items-center justify-center rounded-full bg-success-bg text-success">
            <PackageCheck className="size-[18px]" />
          </span>
          <div>
            <p className="text-sm font-semibold text-text">Delivered to Mom</p>
            <p className="tabular text-xs text-text-3">Shop paid 12.00 USDC</p>
          </div>
        </div>
      </div>
    </figure>
  );
}

// ------------------------------------------------------------------ live numbers

function LiveStats() {
  const q = useQuery({
    queryKey: qk.stats,
    queryFn: api.stats,
    staleTime: 30_000,
    retry: 1,
  });
  const { demoMode } = useAppSettings();
  const stats: { label: string; value: string | undefined; unit?: string }[] = [
    {
      label: "Orders on Doorstep",
      value: q.data ? q.data.orders.toLocaleString("en-US") : undefined,
    },
    {
      label: "Protected in escrow so far",
      value: q.data ? usdc(q.data.protectedUnits) : undefined,
      unit: "USDC",
    },
    {
      label: "Released to shops",
      value: q.data ? usdc(q.data.releasedUnits) : undefined,
      unit: "USDC",
    },
  ];
  return (
    <section
      aria-labelledby="stats-heading"
      className="mx-auto max-w-6xl px-4 sm:px-6"
    >
      <Card padding="none" className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span
            className={clsx(
              "size-2 rounded-full",
              q.isError ? "bg-text-3" : "animate-pulse-dot bg-brand text-brand",
            )}
            aria-hidden
          />
          <h2
            id="stats-heading"
            className="text-xs font-semibold tracking-wide text-text-2 uppercase"
          >
            Live numbers
          </h2>
          {demoMode && (
            <span className="ml-auto text-xs font-medium text-waiting">
              Demo data, not real orders
            </span>
          )}
        </div>
        <dl className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {stats.map((s) => (
            <div key={s.label} className="px-5 py-5">
              <dt className="text-sm text-text-2">{s.label}</dt>
              <dd className="mt-1.5 flex h-9 items-baseline gap-1.5">
                {q.isPending ? (
                  <Skeleton className="h-8 w-28" />
                ) : (
                  <>
                    <span className="tabular text-3xl font-semibold tracking-tight text-text">
                      {s.value ?? "—"}
                    </span>
                    {s.value && s.unit && (
                      <span className="text-sm font-semibold text-text-2">
                        {s.unit}
                      </span>
                    )}
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  );
}

// ------------------------------------------------------------------ how it works

function SectionHeading({
  id,
  eyebrow,
  title,
  sub,
}: {
  id: string;
  eyebrow: string;
  title: string;
  sub?: ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-semibold text-brand">{eyebrow}</p>
      <h2
        id={id}
        className="mt-2 text-2xl font-semibold tracking-tight text-balance text-text sm:text-3xl"
      >
        {title}
      </h2>
      {sub && <p className="mt-3 text-base leading-7 text-text-2">{sub}</p>}
    </div>
  );
}

const STEPS: { icon: LucideIcon; title: string; body: string; tech: string }[] =
  [
    {
      icon: Link2,
      title: "The shop sends a pay link",
      body: "Item, price in USDC, deliver-by date. The buyer opens it on any phone — no app, no account.",
      tech: "create_order",
    },
    {
      icon: Coins,
      title: "You pay with any token, on any chain",
      body: "NEAR Intents converts it into exactly the price in USDC and locks it in the escrow contract.",
      tech: "1Click → ft_on_transfer",
    },
    {
      icon: PackageCheck,
      title: "Delivery proven, shop paid",
      body: "Show your delivery pass at the door and the shop is paid. Not delivered by the deadline? Automatic refund.",
      tech: "confirm_by_buyer → release",
    },
  ];

function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-heading"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-20 sm:px-6 sm:pt-28"
    >
      <SectionHeading
        id="how-heading"
        eyebrow="How it works"
        title="Prepaid for the shop. Pay-on-delivery for you."
      />
      <ol className="mt-10 grid gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <Card className="h-full">
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <s.icon aria-hidden className="size-5" />
                </span>
                <span className="tabular text-sm font-semibold text-text-3">
                  0{i + 1}
                </span>
              </div>
              <h3 className="mt-5 text-base font-semibold text-text">
                {s.title}
              </h3>
              <p className="mt-1.5 text-sm leading-6 text-text-2">{s.body}</p>
              <p className="mt-4 inline-flex rounded-md bg-surface-2 px-2 py-1">
                <code className="mono text-[12px] text-text-2">{s.tech}</code>
              </p>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ------------------------------------------------------------------ trust points

const POINTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Globe,
    title: "Any token on any chain",
    body: "USDC on Base, USDT on Tron, ETH, SOL, BTC, NEAR and more. NEAR Intents handles the conversion.",
  },
  {
    icon: Landmark,
    title: "Held by a smart contract, not by us",
    body: "The USDC sits in an open-source NEAR escrow contract. Doorstep never holds your money.",
  },
  {
    icon: QrCode,
    title: "Released by delivery proof",
    body: "Your signed QR at the door, a courier's delivered report, or a 6-digit code. No proof, no payout.",
  },
];

function TrustPoints() {
  return (
    <section
      aria-label="Why it's safe"
      className="mx-auto max-w-6xl px-4 pt-6 sm:px-6"
    >
      <ul className="grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
        {POINTS.map((p) => (
          <li key={p.title} className="flex gap-4 bg-surface p-5 sm:p-6">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success-bg text-success">
              <p.icon aria-hidden className="size-[18px]" />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold text-text">{p.title}</h3>
              <p className="mt-1 text-sm leading-6 text-text-2">{p.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ India story

function IndiaStory() {
  return (
    <section
      aria-labelledby="india-heading"
      className="mx-auto max-w-6xl px-4 pt-20 sm:px-6 sm:pt-28"
    >
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionHeading
            id="india-heading"
            eyebrow="Why it matters"
            title="Cash on delivery, without the cash"
            sub={
              <>
                In India, cash-on-delivery orders fail 25–30% of the time;
                prepaid orders fail 2–3%. Doorstep is prepaid for the seller's
                peace of mind and cash-on-delivery for the buyer's: the money is
                already there, and it only moves when the parcel arrives.
              </>
            }
          />
          <blockquote className="mt-8 rounded-xl border-l-4 border-brand bg-surface px-5 py-4 shadow-card">
            <p className="text-[15px] leading-7 text-text">
              Eraya Foods in Delhi sells makhana. Send a gift box to Mom in
              Noida and pay with the crypto you already hold, from anywhere.
              Eraya gets a guaranteed order; you know the money is released only
              when Mom has it.
            </p>
          </blockquote>
        </div>
        <Card padding="lg">
          <h3 className="text-sm font-semibold text-text">
            How often an order fails to complete
          </h3>
          <p className="mt-0.5 text-xs text-text-3">
            Typical rates for Indian e-commerce
          </p>
          <div className="mt-6 flex flex-col gap-5">
            <RateBar
              label="Cash on delivery"
              range="25–30%"
              width="92%"
              tone="danger"
            />
            <RateBar label="Prepaid" range="2–3%" width="9%" tone="success" />
          </div>
          <div className="mt-7 flex items-start gap-3 rounded-lg bg-brand-soft px-4 py-3 text-sm text-text">
            <ShieldCheck
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-brand"
            />
            <p>
              Doorstep orders are prepaid — but the buyer keeps the protection
              of paying on delivery.
            </p>
          </div>
          <p className="mt-4 text-xs text-text-3">
            Source:{" "}
            <a
              className="underline underline-offset-2 hover:text-text"
              href="https://razorpay.com/blog/cash-on-delivery/"
              target="_blank"
              rel="noreferrer"
            >
              Razorpay, “Cash on delivery and its challenges”
            </a>
          </p>
        </Card>
      </div>
    </section>
  );
}

function RateBar({
  label,
  range,
  width,
  tone,
}: {
  label: string;
  range: string;
  width: string;
  tone: "danger" | "success";
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-text">{label}</span>
        <span
          className={clsx(
            "tabular font-semibold",
            tone === "danger" ? "text-danger" : "text-success",
          )}
        >
          {range}
        </span>
      </div>
      <div
        className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2"
        role="presentation"
      >
        <div
          className={clsx(
            "h-full rounded-full",
            tone === "danger" ? "bg-danger" : "bg-success",
          )}
          style={{ width }}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ trust model

const TRUST: {
  icon: LucideIcon;
  tone: string;
  title: string;
  body: ReactNode;
}[] = [
  {
    icon: ShieldCheck,
    tone: "bg-success-bg text-success",
    title: "What the buyer's QR removes",
    body: (
      <>
        Your browser makes a key that never leaves your device. When you sign
        “delivered” with it — by showing the QR at the door or tapping “I
        received it” — the contract checks the signature itself. Nobody else,
        not the shop and not Doorstep, can fake that proof or move the money.
      </>
    ),
  },
  {
    icon: KeyRound,
    tone: "bg-waiting-bg text-waiting",
    title: "What our checker still holds",
    body: (
      <>
        When delivery is proven by a courier report or a 6-digit code,
        Doorstep's checker key signs it. A compromised checker could mark an
        order delivered — so the complaint window exists, and the contract owner
        can rotate the checker key at any time.
      </>
    ),
  },
  {
    icon: Timer,
    tone: "bg-transit-bg text-transit",
    title: "The complaint window",
    body: (
      <>
        After delivery, the buyer can report a problem before the shop is paid.
        The money stays locked in the contract, and the owner resolves the
        dispute to the buyer or the shop.
      </>
    ),
  },
  {
    icon: Undo2,
    tone: "bg-neutral-bg text-neutral",
    title: "Refunds don't need us",
    body: (
      <>
        If delivery isn't proven by the deadline, anyone can call{" "}
        <code className="mono text-[12px]">refund</code> on the contract. The
        USDC goes back to the buyer's refund account inside NEAR Intents,
        withdrawable to any chain.
      </>
    ),
  },
];

function TrustModel() {
  return (
    <section
      id="trust-model"
      aria-labelledby="trust-heading"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-20 sm:px-6 sm:pt-28"
    >
      <SectionHeading
        id="trust-heading"
        eyebrow="Trust model"
        title="What you trust, honestly"
        sub="Doorstep removes most of the trust from buying online, but not all of it. Here's exactly where it sits."
      />
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {TRUST.map((t) => (
          <Card key={t.title} as="article" className="h-full">
            <span
              className={clsx(
                "flex size-10 items-center justify-center rounded-xl",
                t.tone,
              )}
            >
              <t.icon aria-hidden className="size-5" />
            </span>
            <h3 className="mt-4 text-base font-semibold text-text">
              {t.title}
            </h3>
            <p className="mt-1.5 text-sm leading-6 text-text-2">{t.body}</p>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-sm text-text-2">
        Read the contract:{" "}
        <a
          href={CONTRACT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand underline-offset-2 hover:underline"
        >
          contracts/escrow on GitHub
        </a>
        . Every order also has a public proof page with each on-chain step.
      </p>
    </section>
  );
}

// ------------------------------------------------------------------ final CTA + footer

function FinalCta() {
  const tryDemo = useTryDemo();
  const live = useLiveSite();
  return (
    <section
      aria-labelledby="cta-heading"
      className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28"
    >
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface px-6 py-10 shadow-card sm:px-10 sm:py-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 90% at 100% 0%, var(--color-brand-soft), transparent 70%)",
          }}
        />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h2
              id="cta-heading"
              className="text-2xl font-semibold tracking-tight text-text sm:text-3xl"
            >
              See the whole flow in two minutes
            </h2>
            <p className="mt-2 text-base text-text-2">
              Create an order as the shop, pay it as the buyer, confirm delivery
              and watch the payout. No wallet needed in demo mode.
              {live &&
                " Running a shop? Sign up with NEAR Mobile, Meteor, HOT or MetaMask."}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              onClick={tryDemo}
              iconRight={<ArrowRight aria-hidden className="size-4" />}
            >
              Try the demo
            </Button>
            {live && (
              <ButtonLink
                to="/seller/signup"
                variant="secondary"
                size="lg"
                icon={<Store aria-hidden className="size-[18px]" />}
              >
                Start selling
              </ButtonLink>
            )}
            <ButtonAnchor
              href={env.githubUrl}
              target="_blank"
              variant="secondary"
              size="lg"
              icon={<GitHubIcon className="size-[18px]" />}
            >
              GitHub
            </ButtonAnchor>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-text-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <Logo size="sm" />
          <span>Built for the NEAR Hackathon on NEAR Intents.</span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={env.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-text"
          >
            <GitHubIcon className="size-4" />
            GitHub
          </a>
          <Link to="/seller" className="hover:text-text">
            Seller app
          </Link>
          <span>MIT licence</span>
        </div>
      </div>
    </footer>
  );
}
