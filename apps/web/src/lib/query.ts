import { QueryClient, useQuery } from "@tanstack/react-query";
import type { AppConfig, Order } from "@doorstep/shared";
import { INTENTS_APP_URL } from "@doorstep/shared";
import { api, isApiError } from "./api";
import { isMock } from "./env";
import { isFinal } from "./status";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        retry: (count, err) => {
          if (isApiError(err) && err.status >= 400 && err.status < 500) return false;
          return count < 2;
        },
        retryDelay: (n) => Math.min(800 * 2 ** n, 4_000),
      },
      mutations: { retry: false },
    },
  });
}

export const qk = {
  config: ["config"] as const,
  tokens: ["tokens"] as const,
  stats: ["stats"] as const,
  order: (id: string) => ["order", id] as const,
  sellerOrders: ["seller", "orders"] as const,
  sellerOrder: (id: string) => ["seller", "order", id] as const,
  sellerSummary: ["seller", "summary"] as const,
};

export function useConfigQuery() {
  return useQuery({ queryKey: qk.config, queryFn: api.config, staleTime: Infinity });
}

export interface AppSettings {
  config: AppConfig | undefined;
  loading: boolean;
  demoMode: boolean;
  inrPerUsd: number;
  webUrl: string;
  explorerTxUrl: string;
  intentsAppUrl: string;
}

/** Config with safe fallbacks while it loads (or if the API is down). */
export function useAppSettings(): AppSettings {
  const q = useConfigQuery();
  const c = q.data;
  return {
    config: c,
    loading: q.isPending,
    demoMode: isMock || !!c?.demoMode,
    inrPerUsd: c?.inrPerUsd ?? 84,
    webUrl: c?.webUrl ?? window.location.origin,
    explorerTxUrl: c?.explorerTxUrl ?? "https://nearblocks.io/txns/",
    intentsAppUrl: c?.intentsAppUrl ?? INTENTS_APP_URL,
  };
}

export function useTokens() {
  return useQuery({ queryKey: qk.tokens, queryFn: api.tokens, staleTime: 5 * 60_000 });
}

/** Public order view. `poll` in ms while the order is still moving. */
export function useOrder(id: string, poll: number | false | ((o: Order | undefined) => number | false) = false) {
  return useQuery({
    queryKey: qk.order(id),
    queryFn: () => api.orders.get(id),
    refetchInterval: (q) => {
      const o = q.state.data;
      if (typeof poll === "function") return poll(o);
      if (!poll) return false;
      return o && isFinal(o.status) ? false : poll;
    },
  });
}
