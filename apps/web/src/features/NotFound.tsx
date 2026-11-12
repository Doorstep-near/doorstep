import { ArrowLeft, MapPinOff, Store } from "lucide-react";
import { BuyerLayout, useDocumentTitle } from "../components/layout/Layout";
import { ButtonLink } from "../components/ui";

export default function NotFound() {
  useDocumentTitle("Page not found");
  return (
    <BuyerLayout>
      <section aria-labelledby="nf-title" className="flex min-h-[60dvh] flex-col items-center justify-center text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <MapPinOff aria-hidden className="size-7" />
        </span>
        <p className="tabular mt-6 text-sm font-semibold text-text-3">404</p>
        <h1 id="nf-title" className="mt-1 text-2xl font-semibold tracking-tight text-text">
          This page doesn't exist
        </h1>
        <p className="mt-2 max-w-xs text-[15px] leading-6 text-text-2">
          The link may be mistyped or out of date. If someone sent you a pay link, ask them to send it again.
        </p>
        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <ButtonLink to="/" icon={<ArrowLeft aria-hidden className="size-4" />}>
            Go home
          </ButtonLink>
          <ButtonLink to="/seller" variant="secondary" icon={<Store aria-hidden className="size-4" />}>
            Open the seller app
          </ButtonLink>
        </div>
      </section>
    </BuyerLayout>
  );
}
