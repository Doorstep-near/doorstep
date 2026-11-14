import { clsx } from "clsx";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Globe, LayoutDashboard, LogOut, Menu, Plus, Wallet, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { IconButton, Logo, Sheet, ThemeToggle, buttonClass } from "../../components/ui";
import { api, sellerToken } from "../../lib/api";
import { useAppSettings, useSellerMe } from "../../lib/query";
import { useUnauthorizedRedirect } from "./sellerUtils";

export default function SellerLayout() {
  const location = useLocation();
  if (!sellerToken.get()) {
    return <Navigate to={`/seller/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <SellerShell />;
}

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/seller", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/seller/new", label: "New order", icon: Plus },
];

function initials(name: string) {
  return (
    name
      .replace(/\(.*?\)/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "S"
  );
}

function ShopCard({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/60 px-3 py-2.5">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-semibold text-on-brand">
        {initials(name)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-text">{name}</p>
        <p className="text-xs text-text-3">Seller account</p>
      </div>
    </div>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <li key={to}>
          <NavLink
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                isActive ? "bg-brand-soft text-brand" : "text-text-2 hover:bg-surface-2 hover:text-text",
              )
            }
          >
            <Icon aria-hidden className="size-[18px]" />
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function SecondaryLinks({ intentsAppUrl, onSignOut }: { intentsAppUrl: string; onSignOut: () => void }) {
  const item = "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text";
  return (
    <ul className="flex flex-col gap-1">
      <li>
        <a href={intentsAppUrl} target="_blank" rel="noopener noreferrer" className={item}>
          <Wallet aria-hidden className="size-[18px]" />
          Withdraw funds
          <ArrowUpRight aria-hidden className="ml-auto size-4 text-text-3" />
          <span className="sr-only">(opens NEAR Intents in a new tab)</span>
        </a>
      </li>
      <li>
        <NavLink to="/" className={item}>
          <Globe aria-hidden className="size-[18px]" />
          Public site
        </NavLink>
      </li>
      <li>
        <button type="button" onClick={onSignOut} className={item}>
          <LogOut aria-hidden className="size-[18px]" />
          Sign out
        </button>
      </li>
    </ul>
  );
}

function SellerShell() {
  useUnauthorizedRedirect();
  const { intentsAppUrl } = useAppSettings();
  const shopName = useSellerMe().data?.name ?? "Your shop";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);

  const signOut = () => {
    // Ends a wallet session on the server too (a seller token just gets forgotten here).
    void api.seller.auth.logout().catch(() => {});
    sellerToken.clear();
    qc.removeQueries({ queryKey: ["seller"] });
    setMenuOpen(false);
    navigate("/seller/login", { replace: true });
  };

  return (
    <div className="min-h-[calc(100dvh-var(--banner-h,0px))] lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      {/* Sidebar (≥1024px): the background stretches with the page, the nav sticks. */}
      <aside className="hidden border-r border-border bg-surface lg:block" aria-label="Seller navigation">
        <div className="sticky top-0 flex h-[calc(100dvh-var(--banner-h,0px))] flex-col gap-6 overflow-y-auto px-4 py-5">
        <div className="flex items-center justify-between px-1">
          <Logo to="/seller" />
          <ThemeToggle />
        </div>
        <ShopCard name={shopName} />
        <nav aria-label="Main">
          <NavItems />
        </nav>
        <div className="mt-auto border-t border-border pt-4">
          <SecondaryLinks intentsAppUrl={intentsAppUrl} onSignOut={signOut} />
        </div>
        </div>
      </aside>

      {/* Top bar (<1024px) */}
      <header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur lg:hidden">
        <div className="flex h-14 items-center gap-2 px-4">
          <Logo to="/seller" size="sm" />
          <div className="ml-auto flex items-center gap-1">
            <NavLink to="/seller/new" className={buttonClass("primary", "sm", false, "mr-1")} aria-label="New order">
              <Plus aria-hidden className="size-4" />
              <span>New</span>
            </NavLink>
            <ThemeToggle />
            <IconButton label="Open menu" onClick={() => setMenuOpen(true)} className="-mr-2">
              <Menu aria-hidden className="size-5" />
            </IconButton>
          </div>
        </div>
      </header>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" size="sm">
        <div className="flex flex-col gap-4">
          <ShopCard name={shopName} />
          <nav aria-label="Main">
            <NavItems onNavigate={() => setMenuOpen(false)} />
          </nav>
          <div className="border-t border-border pt-3">
            <SecondaryLinks intentsAppUrl={intentsAppUrl} onSignOut={signOut} />
          </div>
        </div>
      </Sheet>

      <main id="main" className="min-w-0 px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-8">
        <div className="mx-auto w-full max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
