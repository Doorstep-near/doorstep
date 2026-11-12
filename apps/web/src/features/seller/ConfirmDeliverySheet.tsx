import type { SellerOrder } from "@doorstep/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CameraOff, ClipboardPaste, Hash, Link2, LoaderCircle, ScanLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type QrScannerType from "qr-scanner";
import { Banner, Button, Field, Input, SegmentedControl, Sheet, Textarea, useToast } from "../../components/ui";
import { api, errorMessage, isApiError } from "../../lib/api";
import { qk } from "../../lib/query";
import { parseDeliveryPass } from "./sellerUtils";

type Mode = "scan" | "paste" | "code";

const canUseCamera = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

export function ConfirmDeliverySheet({ open, onClose, order }: { open: boolean; onClose: () => void; order: SellerOrder }) {
  const [mode, setMode] = useState<Mode>(() => (canUseCamera() ? "scan" : "code"));
  const qc = useQueryClient();
  const { toast } = useToast();

  const done = useCallback(() => {
    toast({ title: "Delivery confirmed", description: "You're paid automatically after the protection window.", tone: "success" });
    void qc.invalidateQueries({ queryKey: qk.sellerOrder(order.id) });
    void qc.invalidateQueries({ queryKey: qk.sellerOrders });
    void qc.invalidateQueries({ queryKey: qk.sellerSummary });
    void qc.invalidateQueries({ queryKey: qk.order(order.id) });
    onClose();
  }, [qc, toast, order.id, onClose]);

  const confirmSig = useMutation({ mutationFn: (signature: string) => api.orders.confirm(order.id, { signature }), onSuccess: done });
  const verifyCode = useMutation({ mutationFn: (code: string) => api.seller.verifyOtp(order.id, { code }), onSuccess: done });

  useEffect(() => {
    if (!open) {
      confirmSig.reset();
      verifyCode.reset();
    }
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Confirm delivery" description="Use the buyer's delivery pass, or the 6-digit code from their order page." size="md">
      <div className="flex flex-col gap-4">
        <SegmentedControl<Mode>
          label="How to confirm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "scan", label: "Scan QR", icon: <ScanLine aria-hidden className="size-4" /> },
            { value: "paste", label: "Paste link", icon: <Link2 aria-hidden className="size-4" /> },
            { value: "code", label: "Enter code", icon: <Hash aria-hidden className="size-4" /> },
          ]}
        />
        {mode === "scan" && (
          <ScanPane
            orderId={order.id}
            busy={confirmSig.isPending}
            error={confirmSig.error ? errorMessage(confirmSig.error) : null}
            onPass={(sig) => confirmSig.mutate(sig)}
            onFallback={setMode}
          />
        )}
        {mode === "paste" && <PastePane orderId={order.id} busy={confirmSig.isPending} serverError={confirmSig.error ? errorMessage(confirmSig.error) : null} onPass={(sig) => confirmSig.mutate(sig)} />}
        {mode === "code" && <CodePane busy={verifyCode.isPending} error={verifyCode.error} onSubmit={(code) => verifyCode.mutate(code)} />}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ scan

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  const msg = typeof e === "string" ? e : e instanceof Error ? e.message : "";
  if (name === "NotAllowedError" || /denied|permission/i.test(msg)) return "Camera access is blocked. Allow it in your browser settings, or paste the link or enter the code instead.";
  if (name === "NotFoundError" || /not found|no camera/i.test(msg)) return "No camera found on this device. Paste the link or enter the code instead.";
  if (/unsupported|secure/i.test(msg)) return "This browser can't use the camera here (it needs HTTPS). Paste the link or enter the code instead.";
  return "The camera couldn't start. Paste the link or enter the code instead.";
}

function ScanPane({ orderId, busy, error, onPass, onFallback }: { orderId: string; busy: boolean; error: string | null; onPass: (sig: string) => void; onFallback: (m: Mode) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"starting" | "scanning" | "error">("starting");
  const [camError, setCamError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const last = useRef<{ text: string; at: number } | null>(null);
  const handlers = useRef({ onPass, busy, orderId });
  handlers.current = { onPass, busy, orderId };

  useEffect(() => {
    let scanner: QrScannerType | null = null;
    let cancelled = false;
    (async () => {
      try {
        if (!canUseCamera()) throw new Error("unsupported");
        const { default: QrScanner } = await import("qr-scanner");
        if (cancelled || !videoRef.current) return;
        scanner = new QrScanner(
          videoRef.current,
          (result) => {
            const now = Date.now();
            if (handlers.current.busy) return;
            if (last.current && last.current.text === result.data && now - last.current.at < 2500) return;
            last.current = { text: result.data, at: now };
            const parsed = parseDeliveryPass(result.data, handlers.current.orderId);
            if (!parsed.ok) {
              setHint(parsed.error);
              return;
            }
            setHint(null);
            handlers.current.onPass(parsed.signature);
          },
          { preferredCamera: "environment", maxScansPerSecond: 8, returnDetailedScanResult: true },
        );
        await scanner.start();
        if (cancelled) return;
        setState("scanning");
      } catch (e) {
        if (cancelled) return;
        setState("error");
        setCamError(cameraError(e));
      }
    })();
    return () => {
      cancelled = true;
      scanner?.stop();
      scanner?.destroy();
    };
  }, []);

  if (state === "error") {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border-strong bg-surface-2/50 px-5 py-8 text-center">
        <CameraOff aria-hidden className="size-7 text-text-3" />
        <p className="mt-3 max-w-xs text-sm text-text-2">{camError}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => onFallback("paste")}>
            Paste link
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onFallback("code")}>
            Enter code
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} className="size-full object-cover" muted playsInline aria-label="Camera preview for scanning the delivery pass" />
        <div aria-hidden className="pointer-events-none absolute inset-[14%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
        {(state === "starting" || busy) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 text-sm font-medium text-white">
            <LoaderCircle aria-hidden className="size-6 animate-spin" />
            {busy ? "Confirming delivery…" : "Starting camera…"}
          </div>
        )}
      </div>
      <p className="text-center text-sm text-text-2" aria-live="polite">
        {busy ? "Confirming on NEAR…" : hint ?? "Point the camera at the QR on the buyer's phone."}
      </p>
      {error && (
        <Banner tone="danger" role="alert">
          {error} Try scanning again, or use the delivery code.
        </Banner>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ paste

function PastePane({ orderId, busy, serverError, onPass }: { orderId: string; busy: boolean; serverError: string | null; onPass: (sig: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canPaste = typeof navigator !== "undefined" && !!navigator.clipboard?.readText;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseDeliveryPass(value, orderId);
    if (!parsed.ok) return setError(parsed.error);
    setError(null);
    onPass(parsed.signature);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label="Delivery pass link" error={error ?? serverError} hint="The buyer can share it from “Show delivery pass”. It looks like …/confirm/…#sig=…">
        {(a) => (
          <Textarea
            {...a}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            rows={3}
            spellCheck={false}
            autoCapitalize="none"
            placeholder="https://…/confirm/…#sig=…"
            className="font-mono text-[13px]"
          />
        )}
      </Field>
      <div className="flex flex-col gap-2 sm:flex-row">
        {canPaste && (
          <Button
            variant="secondary"
            icon={<ClipboardPaste aria-hidden className="size-4" />}
            onClick={async () => {
              try {
                setValue(await navigator.clipboard.readText());
                setError(null);
              } catch {
                setError("Couldn't read the clipboard. Paste the link into the box instead.");
              }
            }}
          >
            Paste
          </Button>
        )}
        <Button type="submit" block loading={busy} loadingText="Confirming…" className="sm:flex-1">
          Confirm delivery
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ code

function CodePane({ busy, error, onSubmit }: { busy: boolean; error: unknown; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const triesLeft = isApiError(error) && typeof error.details?.triesLeft === "number" ? (error.details.triesLeft as number) : null;
  const serverError = error ? `${errorMessage(error)}${triesLeft !== null && triesLeft > 0 ? ` Tries left: ${triesLeft}.` : ""}` : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setLocalError("Enter the 6-digit code");
    setLocalError(null);
    onSubmit(code);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label="Buyer's delivery code" error={localError ?? serverError} hint="Ask the buyer to open their order page and tap “Show delivery code”.">
        {(a) => (
          <Input
            {...a}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setLocalError(null);
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="••••••"
            className="h-14 text-center font-mono text-2xl tracking-[0.5em] tabular"
            data-autofocus
          />
        )}
      </Field>
      <Button type="submit" size="lg" block loading={busy} loadingText="Checking code…" disabled={code.length !== 6 && !busy}>
        Verify code
      </Button>
    </form>
  );
}
