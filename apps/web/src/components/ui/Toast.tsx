import { clsx } from "clsx";
import { CircleCheck, CircleExclamationPoint, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}
interface ToastApi {
  toast: (t: { title: string; description?: string; tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastApi>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const icons = { success: CircleCheck, error: CircleExclamationPoint, info: Info };
const iconTone = { success: "text-success", error: "text-danger", info: "text-transit" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback<ToastApi["toast"]>(
    ({ title, description, tone = "success" }) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-2), { id, title, description, tone }]);
      setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3800);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          aria-relevant="additions"
          className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:top-auto sm:bottom-0 sm:items-start sm:p-6"
        >
          {items.map((t) => {
            const Icon = icons[t.tone];
            return (
              <div
                key={t.id}
                role={t.tone === "error" ? "alert" : "status"}
                className="pointer-events-auto flex w-full max-w-sm animate-rise-in items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-raised"
              >
                <Icon aria-hidden className={clsx("mt-0.5 size-[18px] shrink-0", iconTone[t.tone])} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-text">{t.title}</p>
                  {t.description && <p className="mt-0.5 text-text-2">{t.description}</p>}
                </div>
                <button type="button" onClick={() => dismiss(t.id)} className="-m-1 rounded-md p-1 text-text-3 hover:text-text" aria-label="Dismiss">
                  <X aria-hidden className="size-4" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
