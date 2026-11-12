import { clsx } from "clsx";
import type { OrderStatus } from "@doorstep/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FastForward, FlaskConical, RotateCcw } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { isMock } from "../../lib/env";
import { useAppSettings } from "../../lib/query";
import { isFinal } from "../../lib/status";
import { Button, useToast } from "../../components/ui";

const NEXT_STEP: Record<OrderStatus, string> = {
  Draft: "Buyer opens the link",
  Created: "Simulate the buyer's payment",
  Funded: "Seller ships the order",
  Shipped: "Courier picks up, then delivers",
  Delivered: "End the window & pay out",
  Disputed: "Decided by the escrow owner",
  Released: "Finished",
  Refunded: "Finished",
  Expired: "Finished",
};

/** Floating panel on order pages so anyone can click through the whole flow. */
export function DemoControls({ orderId, status, blockedReason }: { orderId: string; status: OrderStatus | undefined; blockedReason?: string | null }) {
  const { demoMode } = useAppSettings();
  // Open by default on wider screens; a compact pill on phones so it never covers the page.
  const [open, setOpen] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 640px)").matches);
  const qc = useQueryClient();
  const { toast } = useToast();

  const advance = useMutation({
    mutationFn: () => api.demo.advance(orderId),
    onSuccess: (order) => {
      qc.setQueryData(["order", orderId], order);
      void qc.invalidateQueries({ queryKey: ["order", orderId] });
      void qc.invalidateQueries({ queryKey: ["seller"] });
      toast({ title: "Advanced one step", description: `Order is now ${order.status}.`, tone: "info" });
    },
    onError: (e) => toast({ title: "Couldn't advance", description: errorMessage(e), tone: "error" }),
  });

  if (!demoMode) return null;
  const done = status ? isFinal(status) : false;
  const blocked = blockedReason ?? (status === "Disputed" ? "Disputes are resolved by the escrow owner, not the demo." : null);

  return (
    <aside aria-label="Demo controls" className={clsx("fixed right-3 bottom-3 z-30 sm:right-5 sm:bottom-5", open ? "w-[calc(100%-1.5rem)] max-w-[300px]" : "w-auto")}>
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-raised">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-[13px] font-semibold text-text hover:bg-surface-2"
        >
          <span className="flex size-6 items-center justify-center rounded-md bg-waiting-bg text-waiting">
            <FlaskConical aria-hidden className="size-3.5" />
          </span>
          Demo controls
          <ChevronDown aria-hidden className={clsx("ml-auto size-4 text-text-3 transition-transform", !open && "rotate-180")} />
        </button>
        {open && (
          <div className="border-t border-border px-3.5 pt-3 pb-3.5">
            <p className="text-xs text-text-3">
              Next: <span className="font-medium text-text-2">{status ? NEXT_STEP[status] : "…"}</span>
            </p>
            {blocked && <p className="mt-1.5 text-xs text-text-2">{blocked}</p>}
            <Button
              size="sm"
              block
              className="mt-2.5"
              icon={<FastForward aria-hidden className="size-4" />}
              loading={advance.isPending}
              disabled={!status || done || !!blocked}
              onClick={() => advance.mutate()}
            >
              {done ? "Order finished" : "Advance one step"}
            </Button>
            {isMock && (
              <button
                type="button"
                onClick={async () => {
                  const { resetMock } = await import("../../lib/mock");
                  resetMock();
                  qc.clear();
                  window.location.assign("/seller");
                }}
                className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded text-xs text-text-3 hover:text-text"
              >
                <RotateCcw aria-hidden className="size-3" /> Reset sample data
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
