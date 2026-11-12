import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { ToastProvider } from "../components/ui";

/** Renders `element` at `path` (a route pattern) for the URL `url`, with all app providers. */
export function renderRoute(element: ReactNode, { path, url, extraRoutes }: { path: string; url: string; extraRoutes?: { path: string; element: ReactNode }[] }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path={path} element={element} />
            {extraRoutes?.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
