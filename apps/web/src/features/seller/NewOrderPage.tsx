import { clsx } from "clsx";
import { CreateOrderRequest, inrEstimate, usdcToUnits, type DeliveryMethod, type SellerOrder } from "@doorstep/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Bike, CalendarClock, Hand, MapPin, MessageCircle, Package, ShieldCheck, Timer, Undo2 } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ProtectedBadge, useDocumentTitle } from "../../components/layout/Layout";
import {
  Amount,
  Banner,
  Button,
  ButtonAnchor,
  Card,
  CheckAnimation,
  CopyField,
  Field,
  Input,
  QrCode,
  SegmentedControl,
  Sheet,
  Textarea,
} from "../../components/ui";
import { api, errorMessage, isApiError } from "../../lib/api";
import { formatDate, formatDateTime, toLocalInput } from "../../lib/format";
import { qk, useAppSettings, useSellerMe } from "../../lib/query";
import { METHOD_LABEL, whatsappShareUrl } from "./sellerUtils";

type FieldKey = "item" | "note" | "price" | "phone" | "method" | "address" | "area" | "deliverBy";
type Errors = Partial<Record<FieldKey, string>>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface FormState {
  item: string;
  note: string;
  price: string;
  phone: string;
  method: DeliveryMethod;
  address: string;
  area: string;
  deliverBy: string;
}

function initialForm(): FormState {
  const d = new Date(Date.now() + 3 * DAY);
  d.setMinutes(0, 0, 0);
  return { item: "", note: "", price: "", phone: "", method: "borzo", address: "", area: "", deliverBy: toLocalInput(d) };
}

const FIELD_FROM_PATH: Record<string, FieldKey> = {
  item: "item",
  note: "note",
  priceUnits: "price",
  buyerPhone: "phone",
  deliveryMethod: "method",
  deliveryAddress: "address",
  deliveryArea: "area",
  deliverBy: "deliverBy",
};

function parsePrice(price: string): string | null {
  const cleaned = price.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!cleaned) return null;
  try {
    return usdcToUnits(cleaned);
  } catch {
    return null;
  }
}

/** Validates the form with the shared schema; returns the request or field errors. */
export function validateOrderForm(f: FormState, now = Date.now()): { ok: true; req: CreateOrderRequest } | { ok: false; errors: Errors } {
  const errors: Errors = {};
  const priceUnits = parsePrice(f.price);
  if (!f.price.trim()) errors.price = "Enter a price";
  else if (!priceUnits) errors.price = "Enter a price like 12.50 (up to 6 decimals)";

  const deliverByMs = f.deliverBy ? new Date(f.deliverBy).getTime() : NaN;
  if (Number.isNaN(deliverByMs)) errors.deliverBy = "Pick a deliver-by date";
  else if (deliverByMs < now + 2 * HOUR) errors.deliverBy = "Give at least 2 hours to deliver";
  else if (deliverByMs > now + 30 * DAY) errors.deliverBy = "Deliver-by can be at most 30 days away";
  // The schema's address refinement only runs once every other field is valid, so check it here too.
  if (f.method === "borzo" && !f.address.trim()) errors.address = "Borzo needs the full delivery address";

  const candidate = {
    item: f.item,
    note: f.note.trim() || undefined,
    priceUnits: priceUnits ?? "0",
    buyerPhone: f.phone,
    deliveryMethod: f.method,
    deliveryAddress: f.address.trim() || undefined,
    deliveryArea: f.area.trim() || undefined,
    deliverBy: Number.isNaN(deliverByMs) ? "" : new Date(deliverByMs).toISOString(),
  };
  const parsed = CreateOrderRequest.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = FIELD_FROM_PATH[String(issue.path[0] ?? "")];
      if (!key || errors[key]) continue;
      if (key === "item") errors.item = f.item.trim() ? "Keep it under 120 characters" : "Enter what you're selling";
      else if (key === "phone") errors.phone = f.phone.trim() ? "Enter a valid phone number, e.g. +91 98765 43210" : "Enter the buyer's phone number";
      else if (key === "price") errors.price = priceUnits ? "Minimum price is 0.10 USDC" : (errors.price ?? "Enter a price");
      else if (key === "address") errors.address = "Borzo needs the full delivery address";
      else if (key === "deliverBy") errors.deliverBy ??= "Pick a deliver-by date";
      else errors[key] = issue.message;
    }
  }
  if (Object.keys(errors).length || !parsed.success) return { ok: false, errors };
  return { ok: true, req: parsed.data };
}

const FIELD_ORDER: FieldKey[] = ["item", "note", "price", "phone", "method", "address", "area", "deliverBy"];

export default function NewOrderPage() {
  useDocumentTitle("New order");
  const { inrPerUsd } = useAppSettings();
  const me = useSellerMe().data;
  const shopName = me?.name ?? "Your shop";
  const maxUnits = me?.maxPriceUnits ? BigInt(me.maxPriceUnits) : null;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<SellerOrder | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] || (key === "method" && e.address) ? { ...e, [key]: undefined, ...(key === "method" ? { address: undefined } : {}) } : e));
  };

  const priceUnits = parsePrice(form.price);
  const minDeliverBy = useMemo(() => toLocalInput(new Date(Date.now() + 2 * HOUR)), []);
  const maxDeliverBy = useMemo(() => toLocalInput(new Date(Date.now() + 30 * DAY)), []);

  const create = useMutation({
    mutationFn: (req: CreateOrderRequest) => api.seller.createOrder(req),
    onSuccess: (order) => {
      setCreated(order);
      void qc.invalidateQueries({ queryKey: qk.sellerOrders });
      void qc.invalidateQueries({ queryKey: qk.sellerSummary });
    },
    onError: (err) => {
      const field = isApiError(err) ? FIELD_FROM_PATH[String(err.details?.field ?? "")] : undefined;
      if (field) {
        setErrors((e) => ({ ...e, [field]: errorMessage(err) }));
        focusField(field);
      } else setFormError(errorMessage(err));
    },
  });

  function focusField(key: FieldKey) {
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[data-field="${key}"]`)?.focus());
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const result = validateOrderForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      const first = FIELD_ORDER.find((k) => result.errors[k]);
      if (first) focusField(first);
      return;
    }
    setErrors({});
    create.mutate(result.req);
  }

  function reset() {
    setCreated(null);
    setForm(initialForm());
    setErrors({});
    create.reset();
    focusField("item");
  }

  const borzo = form.method === "borzo";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/seller" className="inline-flex min-h-9 items-center gap-1.5 rounded text-sm font-medium text-text-2 hover:text-text">
          <ArrowLeft aria-hidden className="size-4" /> Dashboard
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text sm:text-3xl">New order</h1>
        <p className="mt-1 text-sm text-text-2">Create a protected pay link. Your buyer pays with any crypto; you're paid in USDC once it's delivered.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <Card as="section" padding="none" aria-label="Order details">
          <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col">
            {formError && (
              <div className="px-5 pt-5 sm:px-6">
                <Banner tone="danger" role="alert" title="Couldn't create the order">
                  {formError}
                </Banner>
              </div>
            )}

            <fieldset className="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6">
              <legend className="float-left mb-1 w-full text-base font-semibold text-text">What you're selling</legend>
              <Field label="Item" error={errors.item}>
                {(a) => (
                  <Input {...a} data-field="item" value={form.item} onChange={(e) => set("item", e.target.value)} maxLength={120} placeholder="Roasted makhana — Himalayan salt, 500 g" autoComplete="off" />
                )}
              </Field>
              <Field label="Note for the buyer" optional error={errors.note} hint="Shown on the buyer's pay page.">
                {(a) => <Textarea {...a} data-field="note" value={form.note} onChange={(e) => set("note", e.target.value)} maxLength={500} rows={2} placeholder="For Mom — Happy Diwali!" />}
              </Field>
              <Field
                label="Price"
                error={errors.price}
                aside={priceUnits ? <span className="tabular">≈ {inrEstimate(priceUnits, inrPerUsd)}</span> : null}
                hint={
                  maxUnits && priceUnits && BigInt(priceUnits) > maxUnits
                    ? `During the beta, new shops can take orders up to ${Number(maxUnits) / 1e6} USDC.`
                    : `You receive exactly this in USDC. Minimum 0.10${maxUnits ? `, beta maximum ${Number(maxUnits) / 1e6}` : ""}.`
                }
              >
                {(a) => (
                  <Input
                    {...a}
                    data-field="price"
                    value={form.price}
                    onChange={(e) => set("price", e.target.value)}
                    inputMode="decimal"
                    placeholder="12.00"
                    trailing="USDC"
                    className="tabular text-lg font-semibold"
                    autoComplete="off"
                  />
                )}
              </Field>
            </fieldset>

            <fieldset className="flex flex-col gap-5 border-t border-border px-5 py-5 sm:px-6 sm:py-6">
              <legend className="sr-only">Buyer and delivery</legend>
              <p aria-hidden className="text-base font-semibold text-text">
                Buyer &amp; delivery
              </p>
              <Field label="Buyer's phone" error={errors.phone} hint="Include the country code, e.g. +91. The buyer sees it masked.">
                {(a) => (
                  <Input {...a} data-field="phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 98765 43210" autoComplete="tel" inputMode="tel" />
                )}
              </Field>
              <div className="flex flex-col gap-1.5">
                <span id="method-label" className="text-sm font-medium text-text">
                  Delivery method
                </span>
                <SegmentedControl<DeliveryMethod>
                  label="Delivery method"
                  value={form.method}
                  onChange={(v) => set("method", v)}
                  options={[
                    { value: "hand", label: "Hand", icon: <Hand aria-hidden className="size-4" />, description: "You deliver" },
                    { value: "borzo", label: "Borzo", icon: <Bike aria-hidden className="size-4" />, description: "Same-day courier" },
                    { value: "tracking", label: "Tracking", icon: <Package aria-hidden className="size-4" />, description: "Any carrier" },
                  ]}
                />
              </div>
              <Field
                label="Delivery address"
                optional={!borzo}
                error={errors.address}
                hint={borzo ? "Borzo picks up from your shop and drops here. Only you and the courier see it." : "Private — only you see it."}
              >
                {(a) => (
                  <Textarea
                    {...a}
                    data-field="address"
                    value={form.address}
                    onChange={(e) => set("address", e.target.value)}
                    maxLength={300}
                    rows={2}
                    placeholder="B-42, Sector 50, Noida, Uttar Pradesh 201301"
                    autoComplete="street-address"
                  />
                )}
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Area or city" optional error={errors.area} hint="Shown publicly, e.g. Noida.">
                  {(a) => <Input {...a} data-field="area" value={form.area} onChange={(e) => set("area", e.target.value)} maxLength={60} placeholder="Noida" autoComplete="address-level2" />}
                </Field>
                <Field label="Deliver by" error={errors.deliverBy} hint="Not delivered by then? The buyer is refunded automatically.">
                  {(a) => (
                    <Input
                      {...a}
                      data-field="deliverBy"
                      type="datetime-local"
                      value={form.deliverBy}
                      min={minDeliverBy}
                      max={maxDeliverBy}
                      onChange={(e) => set("deliverBy", e.target.value)}
                    />
                  )}
                </Field>
              </div>
            </fieldset>

            <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-2/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-xs text-text-3">Nothing goes on chain until the buyer opens the link.</p>
              <Button type="submit" size="lg" loading={create.isPending} loadingText="Creating…">
                Create pay link
              </Button>
            </div>
          </form>
        </Card>

        <aside className="lg:sticky lg:top-8" aria-label="Buyer preview">
          <p className="mb-2 text-xs font-semibold tracking-wide text-text-3 uppercase">What your buyer sees</p>
          <BuyerPreview form={form} priceUnits={priceUnits} shopName={shopName} inrPerUsd={inrPerUsd} />
        </aside>
      </div>

      <Sheet open={!!created} onClose={reset} title="Pay link ready" size="md" hideTitle>
        {created && (
          <SuccessContent
            order={created}
            shopName={shopName}
            inrPerUsd={inrPerUsd}
            onView={() => navigate(`/seller/orders/${created.id}`)}
            onAnother={reset}
          />
        )}
      </Sheet>
    </div>
  );
}

function BuyerPreview({ form, priceUnits, shopName, inrPerUsd }: { form: FormState; priceUnits: string | null; shopName: string; inrPerUsd: number }) {
  const deliverBy = form.deliverBy && !Number.isNaN(new Date(form.deliverBy).getTime()) ? new Date(form.deliverBy).toISOString() : null;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-bg shadow-raised" aria-live="off">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3">
        <span className="truncate text-sm font-semibold text-text">{shopName}</span>
        <ProtectedBadge className="shrink-0" />
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
          <p className={clsx("text-[15px] font-semibold", form.item.trim() ? "text-text" : "text-text-3")}>{form.item.trim() || "Your item"}</p>
          {form.note.trim() && <p className="mt-1 text-sm text-text-2 italic">“{form.note.trim()}”</p>}
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-xs font-medium text-text-3">You pay</p>
            {priceUnits ? (
              <Amount units={priceUnits} inrPerUsd={inrPerUsd} size="lg" className="mt-1" />
            ) : (
              <p className="mt-1 text-3xl font-semibold tracking-tight text-text-3 tabular">
                0.00 <span className="text-base text-text-3">USDC</span>
              </p>
            )}
          </div>
          <div className="mt-4 flex flex-col gap-1.5 text-sm text-text-2">
            <span className="flex items-center gap-2">
              <CalendarClock aria-hidden className="size-4 text-text-3" />
              {deliverBy ? `Delivered by ${formatDate(deliverBy)}` : "Pick a deliver-by date"}
            </span>
            <span className="flex items-center gap-2">
              <MapPin aria-hidden className="size-4 text-text-3" />
              {METHOD_LABEL[form.method]}
              {form.area.trim() ? ` · ${form.area.trim()}` : ""}
            </span>
          </div>
        </div>
        <ul className="flex flex-col gap-2 rounded-xl bg-surface-2/70 p-3.5 text-[13px] text-text-2">
          <li className="flex gap-2">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
            Held safely in a NEAR smart contract
          </li>
          <li className="flex gap-2">
            <Timer aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
            Released only when delivery is proven
          </li>
          <li className="flex gap-2">
            <Undo2 aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
            {deliverBy ? `Not delivered by ${formatDateTime(deliverBy)}? Automatic refund` : "Not delivered on time? Automatic refund"}
          </li>
        </ul>
      </div>
    </div>
  );
}

function SuccessContent({ order, shopName, inrPerUsd, onView, onAnother }: { order: SellerOrder; shopName: string; inrPerUsd: number; onView: () => void; onAnother: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <CheckAnimation size={64} className="mt-1" />
      <h2 className="mt-3 text-xl font-semibold text-text">Pay link ready</h2>
      <p className="mt-1 max-w-sm text-sm text-text-2">
        Send it to your buyer. You'll see the payment here the moment it lands — then ship.
      </p>
      <div className="mt-4 w-full text-left">
        <CopyField label="Pay link" value={order.payLink} />
      </div>
      <div className="mt-3 flex w-full flex-col gap-2">
        <ButtonAnchor href={whatsappShareUrl(order, shopName, inrPerUsd)} target="_blank" block size="lg" icon={<MessageCircle aria-hidden className="size-4" />}>
          Share on WhatsApp
        </ButtonAnchor>
        <ButtonAnchor href={order.payLink} target="_blank" variant="ghost" block iconRight={<ArrowUpRight aria-hidden className="size-4" />}>
          Open buyer view
        </ButtonAnchor>
      </div>
      <div className="mt-4 flex flex-col items-center gap-2">
        <QrCode value={order.payLink} label={`QR code of the pay link for ${order.item}`} size={160} />
        <p className="text-xs text-text-3">Buyer can scan this to pay</p>
      </div>
      <div className="mt-5 flex w-full flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row">
        <Button variant="secondary" block onClick={onAnother}>
          Create another
        </Button>
        <Button block onClick={onView}>
          View order
        </Button>
      </div>
    </div>
  );
}
