import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4500);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
      info: (message) => push("info", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live sorgt dafür, dass Screenreader die Meldung vorlesen. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:bottom-auto sm:right-0 sm:top-0 sm:items-end"
      >
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className={[
              "pointer-events-auto w-full max-w-sm animate-slide-up rounded-xl px-4 py-3 text-left text-sm font-medium shadow-lg",
              "border backdrop-blur",
              toast.kind === "success"
                ? "border-brand-200 bg-brand-50/95 text-brand-800 dark:border-brand-800 dark:bg-brand-900/80 dark:text-brand-100"
                : toast.kind === "error"
                  ? "border-red-200 bg-red-50/95 text-red-800 dark:border-red-900 dark:bg-red-950/85 dark:text-red-100"
                  : "border-slate-200 bg-white/95 text-slate-800 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-100",
            ].join(" ")}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast muss innerhalb von ToastProvider verwendet werden");
  return context;
}
