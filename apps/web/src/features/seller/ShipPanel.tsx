import type { DeliveryMethod, SellerOrder, ShipQuote, ShipRequest } from "@doorstep/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bike, Hand, MapPin, Package, RefreshCw, Truck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Banner, Button, Field, Input, SegmentedControl, Select, useToast } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { qk } from "../../lib/query";
import { CARRIERS, carrierLabel } from "./sellerUtils";

/** "Ship it" for a Funded order: Borzo quote → book, tracking number, or hand delivery. */
export function ShipPanel({ order }: { order: SellerOrder }) {
  const [method, setMethod] = useState<DeliveryMethod>(order.delivery.method);
  const qc = useQueryClient();
  const { toast } = useToast();

  const ship = useMutation({
    mutationFn: (req: ShipRequest) => api.seller.ship(order.id, req),
    onSuccess: (updated, req) => {
      qc.setQueryData(qk.sellerOrder(order.id), updated);
      void qc.invalidateQueries({ queryKey: qk.sellerOrders });
      void qc.invalidateQueries({ queryKey: qk.sellerSummary });
      void qc.invalidateQueries({ queryKey: qk.order(order.id) });
      toast({
        title: req.method === "borzo" ? "Borzo courier booked" : req.method === "tracking" ? "Marked as shipped" : "Marked as handed over",
        description: "Recorded on NEAR. The buyer can see it now.",
      });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl<DeliveryMethod>
        label="Shipping method"
        value={method}
        onChange={(m) => {
          setMethod(m);
          ship.reset();
        }}
        options={[
          { value: "borzo", label: "Borzo", icon: <Bike aria-hidden className="size-4" /> },
          { value: "tracking", label: "Tracking", icon: <Package aria-hidden className="size-4" /> },
          { value: "hand", label: "Hand", icon: <Hand aria-hidden className="size-4" /> },
        ]}
      />
      {method === "borzo" && <BorzoShip order={order} busy={ship.isPending} onBook={() => ship.mutate({ method: "borzo" })} />}
      {method === "tracking" && <TrackingShip busy={ship.isPending} onShip={(carrier, trackingNumber) => ship.mutate({ method: "tracking", carrier, trackingNumber })} />}
      {method === "hand" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-2">Delivering it yourself (or with your own rider)? Mark it handed over when it leaves the shop. At the door, confirm with the buyer's QR or code.</p>
          <Button size="lg" block icon={<Hand aria-hidden className="size-4" />} loading={ship.isPending} loadingText="Recording…" onClick={() => ship.mutate({ method: "hand" })}>
            Mark as handed over
          </Button>
        </div>
      )}
      {ship.error && (
        <Banner tone="danger" role="alert" title="Couldn't ship this order">
          {errorMessage(ship.error)}
        </Banner>
      )}
    </div>
  );
}

function BorzoShip({ order, busy, onBook }: { order: SellerOrder; busy: boolean; onBook: () => void }) {
  const quote = useMutation({ mutationFn: () => api.seller.shipQuote(order.id, { method: "borzo" }) });
  const q: ShipQuote | undefined = quote.data;

  if (!order.deliveryAddress) {
    return (
      <Banner tone="warning" title="No delivery address on this order">
        Borzo needs a full address. Use a tracking number or hand delivery instead.
      </Banner>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-2/50 p-3.5 text-sm">
        <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-text-3" />
        <div className="min-w-0">
          <p className="font-medium text-text">Drop-off</p>
          <p className="mt-0.5 text-text-2">{order.deliveryAddress}</p>
        </div>
      </div>
      {q ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3" aria-live="polite">
          <div>
            <p className="text-xs font-medium text-text-2">Borzo quote</p>
            <p className="tabular text-xl font-semibold text-text">₹{q.priceInr}</p>
          </div>
          <div className="text-right text-sm text-text-2">
            {q.etaMinutes != null ? (
              <>
                Pickup in <span className="tabular font-semibold text-text">~{q.etaMinutes} min</span>
              </>
            ) : (
              "Pickup time on booking"
            )}
          </div>
        </div>
      ) : null}
      {quote.error && (
        <Banner tone="danger" role="alert">
          {errorMessage(quote.error)}
        </Banner>
      )}
      {q ? (
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button size="lg" block className="sm:flex-1" icon={<Truck aria-hidden className="size-4" />} loading={busy} loadingText="Booking courier…" onClick={onBook}>
            Book Borzo courier
          </Button>
          <Button variant="secondary" size="lg" icon={<RefreshCw aria-hidden className="size-4" />} onClick={() => quote.mutate()} disabled={quote.isPending || busy}>
            Refresh
          </Button>
        </div>
      ) : (
        <Button size="lg" block icon={<Bike aria-hidden className="size-4" />} loading={quote.isPending} loadingText="Getting a quote…" onClick={() => quote.mutate()}>
          Get courier quote
        </Button>
      )}
    </div>
  );
}

function TrackingShip({ busy, onShip }: { busy: boolean; onShip: (carrier: string, trackingNumber: string) => void }) {
  const [carrier, setCarrier] = useState("indiapost");
  const [other, setOther] = useState("");
  const [number, setNumber] = useState("");
  const [errors, setErrors] = useState<{ carrier?: string; number?: string }>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = carrier === "other" ? other.trim().toLowerCase() : carrier;
    const n = number.trim();
    const next: typeof errors = {};
    if (c.length < 2 || c.length > 40) next.carrier = "Enter the carrier's name";
    if (n.length < 4 || n.length > 60) next.number = "Enter the tracking number (at least 4 characters)";
    setErrors(next);
    if (Object.keys(next).length) return;
    onShip(c, n);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <Field label="Carrier" error={carrier !== "other" ? errors.carrier : undefined}>
          {(a) => (
            <Select {...a} value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              {CARRIERS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tracking number" error={errors.number}>
          {(a) => (
            <Input
              {...a}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder={carrier === "indiapost" ? "EE123456789IN" : "Tracking number"}
              autoCapitalize="characters"
              spellCheck={false}
              mono
            />
          )}
        </Field>
      </div>
      {carrier === "other" && (
        <Field label="Carrier name" error={errors.carrier}>
          {(a) => <Input {...a} value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. shadowfax" />}
        </Field>
      )}
      <Button type="submit" size="lg" block icon={<Truck aria-hidden className="size-4" />} loading={busy} loadingText="Recording…">
        Mark shipped with {carrier === "other" ? "tracking" : carrierLabel(carrier)}
      </Button>
    </form>
  );
}
