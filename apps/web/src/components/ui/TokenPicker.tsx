import { clsx } from "clsx";
import type { Token } from "@doorstep/shared";
import { Check, ChevronRight, Search, SearchX } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { chainInfo, chainName } from "../../lib/chains";
import { Skeleton } from "./Feedback";
import { Sheet } from "./Sheet";

// ------------------------------------------------------------------ icons

const TOKEN_STYLE: Record<string, { bg: string; glyph: string; fg?: string }> = {
  USDC: { bg: "#2775CA", glyph: "$" },
  "USDC.e": { bg: "#2775CA", glyph: "$" },
  USDT: { bg: "#26A17B", glyph: "₮" },
  DAI: { bg: "#F5AC37", glyph: "◈" },
  ETH: { bg: "#627EEA", glyph: "Ξ" },
  WETH: { bg: "#627EEA", glyph: "Ξ" },
  BTC: { bg: "#F7931A", glyph: "₿" },
  WBTC: { bg: "#F7931A", glyph: "₿" },
  SOL: { bg: "#9945FF", glyph: "◎" },
  NEAR: { bg: "#111827", glyph: "N" },
  DOGE: { bg: "#C2A633", glyph: "Ð" },
  XRP: { bg: "#23292F", glyph: "✕" },
  BNB: { bg: "#F0B90B", glyph: "B", fg: "#1a1a1a" },
};

function hashColor(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 33 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 42%)`;
}

export function TokenIcon({ symbol, chain, size = 36 }: { symbol: string; chain?: string; size?: number }) {
  const style = TOKEN_STYLE[symbol] ?? { bg: hashColor(symbol), glyph: symbol.slice(0, 1).toUpperCase() };
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-hidden>
      <span
        className="flex size-full items-center justify-center rounded-full font-semibold ring-1 ring-black/5 dark:ring-white/15"
        style={{ background: style.bg, color: style.fg ?? "#fff", fontSize: size * 0.44 }}
      >
        {style.glyph}
      </span>
      {chain && <ChainDot chain={chain} size={Math.round(size * 0.44)} className="absolute -right-0.5 -bottom-0.5 ring-2 ring-surface" />}
    </span>
  );
}

export function ChainDot({ chain, size = 16, className }: { chain: string; size?: number; className?: string }) {
  const info = chainInfo(chain);
  return (
    <span
      aria-hidden
      className={clsx("inline-flex items-center justify-center rounded-full font-bold text-white", className)}
      style={{ width: size, height: size, background: info.color, fontSize: Math.max(8, size * 0.55) }}
    >
      {info.name.slice(0, 1)}
    </span>
  );
}

/** "● Base" network pill. */
export function NetworkBadge({ chain, className }: { chain: string; className?: string }) {
  return (
    <span className={clsx("inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-[13px] font-medium text-text", className)}>
      <ChainDot chain={chain} size={14} />
      {chainName(chain)}
    </span>
  );
}

// ------------------------------------------------------------------ search

export function searchTokens(tokens: Token[], query: string): Token[] {
  const q = query.trim().toLowerCase();
  const score = (t: Token) => {
    const sym = t.symbol.toLowerCase();
    const chain = chainName(t.chain).toLowerCase();
    if (!q) return t.popular ? 0 : 1;
    if (sym === q) return 0;
    if (sym.startsWith(q)) return 1;
    if (chain.startsWith(q) || t.chain.toLowerCase() === q) return 2;
    if (sym.includes(q) || chain.includes(q) || `${sym} ${chain}`.includes(q) || `${sym} on ${chain}`.includes(q)) return 3;
    return -1;
  };
  return tokens
    .map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || Number(b.t.popular) - Number(a.t.popular) || a.t.symbol.localeCompare(b.t.symbol) || chainName(a.t.chain).localeCompare(chainName(b.t.chain)))
    .map((x) => x.t);
}

// Popular tiles, in this order when available: the stablecoins people hold most, then the majors.
const TILE_PRIORITY = ["USDC:base", "USDC:arb", "USDT:tron", "ETH:eth", "SOL:sol", "BTC:btc", "NEAR:near", "USDC:sol", "USDC:eth", "USDT:eth", "USDC:near", "ETH:base", "ETH:arb"];

export function popularTiles(tokens: Token[], max: number): Token[] {
  const rank = (t: Token) => {
    const i = TILE_PRIORITY.indexOf(`${t.symbol}:${t.chain}`);
    return i < 0 ? TILE_PRIORITY.length : i;
  };
  return tokens
    .filter((t) => t.popular)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .slice(0, max)
    .map((x) => x.t);
}

const fmtPrice = (p: number) =>
  p >= 1000 ? `$${Math.round(p).toLocaleString("en-US")}` : p >= 1 ? `$${p.toFixed(2)}` : p >= 0.01 ? `$${p.toFixed(3)}` : `$${p.toPrecision(2)}`;

// ------------------------------------------------------------------ picker

export interface TokenPickerProps {
  tokens: Token[] | undefined;
  value: string | null;
  onChange: (token: Token) => void;
  loading?: boolean;
  /** How many popular tiles to show before "More". */
  max?: number;
  labelledBy?: string;
}

export function TokenPicker({ tokens, value, onChange, loading, max = 7, labelledBy }: TokenPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = tokens?.find((t) => t.assetId === value) ?? null;

  const tiles = useMemo(() => {
    const popular = popularTiles(tokens ?? [], max);
    if (selected && !popular.some((t) => t.assetId === selected.assetId)) popular.splice(popular.length - 1, 1, selected);
    return popular;
  }, [tokens, max, selected]);

  const results = useMemo(() => searchTokens(tokens ?? [], query), [tokens, query]);

  if (loading || !tokens) {
    return (
      <div className="grid grid-cols-4 gap-2" aria-busy="true" aria-label="Loading tokens">
        {Array.from({ length: max + 1 }, (_, i) => (
          <Skeleton key={i} className="h-[84px] rounded-xl" />
        ))}
      </div>
    );
  }

  const pick = (t: Token) => {
    onChange(t);
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-4 gap-2">
        {tiles.map((t) => {
          const isSel = t.assetId === value;
          return (
            <button
              key={t.assetId}
              type="button"
              role="radio"
              aria-checked={isSel}
              aria-label={`${t.symbol} on ${chainName(t.chain)}`}
              onClick={() => onChange(t)}
              className={clsx(
                "relative flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-xl border px-1 py-2.5 text-center transition-[border-color,background-color,box-shadow] duration-150",
                isSel ? "border-brand bg-brand-soft shadow-[0_0_0_1px_var(--color-brand)]" : "border-border bg-surface shadow-card hover:border-border-strong hover:bg-surface-2",
              )}
            >
              {isSel && (
                <span className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-brand text-on-brand" aria-hidden>
                  <Check className="size-3" strokeWidth={3} />
                </span>
              )}
              <TokenIcon symbol={t.symbol} chain={t.chain} size={30} />
              <span className="leading-tight">
                <span className="block text-[13px] font-semibold text-text">{t.symbol}</span>
                <span className="block truncate text-[11px] text-text-3">{chainName(t.chain)}</span>
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border-strong bg-surface-2/50 px-1 py-2.5 text-center text-text-2 transition-colors hover:border-brand hover:text-brand"
        >
          <Search aria-hidden className="size-5" />
          <span className="text-[13px] font-semibold">More</span>
          <span className="text-[11px] text-text-3">{tokens.length} tokens</span>
        </button>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Choose a token" description="Any token on any chain — it's converted to USDC for you." initialFocus={searchRef} size="md">
        <div className="sticky top-0 z-10 -mx-5 bg-surface px-5 pb-3">
          <label htmlFor="token-search" className="sr-only">
            Search token or network
          </label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-3" />
            <input
              id="token-search"
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search token or network"
              autoComplete="off"
              className="h-11 w-full rounded-lg border border-border bg-surface-2 pr-3 pl-9 text-base text-text placeholder:text-text-3 focus:border-brand"
            />
          </div>
        </div>
        {results.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center text-sm text-text-2">
            <SearchX aria-hidden className="mb-2 size-6 text-text-3" />
            No tokens match “{query}”.
          </div>
        ) : (
          <ul className="-mx-2 flex flex-col" aria-label="Tokens">
            {results.slice(0, 120).map((t) => {
              const isSel = t.assetId === value;
              return (
                <li key={t.assetId}>
                  <button
                    type="button"
                    onClick={() => pick(t)}
                    aria-current={isSel || undefined}
                    className={clsx("flex min-h-14 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2", isSel && "bg-brand-soft")}
                  >
                    <TokenIcon symbol={t.symbol} chain={t.chain} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-text">{t.symbol}</span>
                      <span className="block text-xs text-text-3">on {chainName(t.chain)}</span>
                    </span>
                    {t.priceUsd != null && <span className="tabular text-xs text-text-3">{fmtPrice(t.priceUsd)}</span>}
                    {isSel ? <Check aria-label="Selected" className="size-4 text-brand" /> : <ChevronRight aria-hidden className="size-4 text-text-3" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </>
  );
}
