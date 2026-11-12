import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Outlet, RouterProvider, ScrollRestoration } from "react-router";
import { DemoBanner } from "./components/layout/Layout";
import { Spinner, ToastProvider } from "./components/ui";
import { createQueryClient } from "./lib/query";
import LandingPage from "./features/landing/LandingPage";
import PayPage from "./features/pay/PayPage";
import OrderPage from "./features/order/OrderPage";
import ConfirmPage from "./features/confirm/ConfirmPage";
import NotFound from "./features/NotFound";

// Seller app and proof page load on demand; the buyer path stays in the main bundle.
const ProofPage = lazy(() => import("./features/proof/ProofPage"));
const SellerLogin = lazy(() => import("./features/seller/SellerLogin"));
const SellerLayout = lazy(() => import("./features/seller/SellerLayout"));
const SellerDashboard = lazy(() => import("./features/seller/SellerDashboard"));
const NewOrderPage = lazy(() => import("./features/seller/NewOrderPage"));
const SellerOrderPage = lazy(() => import("./features/seller/SellerOrderPage"));

function PageFallback() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <Spinner className="size-6" label="Loading page" />
    </div>
  );
}

const lazyPage = (node: ReactNode) => <Suspense fallback={<PageFallback />}>{node}</Suspense>;

function RootLayout() {
  return (
    <>
      <a href="#main" className="sr-only z-50 rounded-lg bg-surface px-4 py-2 text-sm font-medium text-text shadow-raised focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <DemoBanner />
      <Outlet />
      <ScrollRestoration />
    </>
  );
}

export const routes = [
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <LandingPage /> },
      { path: "/pay/:id", element: <PayPage /> },
      { path: "/o/:id", element: <OrderPage /> },
      { path: "/confirm/:id", element: <ConfirmPage /> },
      { path: "/proof/:id", element: lazyPage(<ProofPage />) },
      { path: "/seller/login", element: lazyPage(<SellerLogin />) },
      {
        path: "/seller",
        element: lazyPage(<SellerLayout />),
        children: [
          { index: true, element: lazyPage(<SellerDashboard />) },
          { path: "new", element: lazyPage(<NewOrderPage />) },
          { path: "orders/:id", element: lazyPage(<SellerOrderPage />) },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];

const router = createBrowserRouter(routes);
const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
