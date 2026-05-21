"use client";

/** 全局 toast 通知。 */

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { cn } from "@/lib/utils";

interface Toast {
  id: number;
  title?: string;
  description?: string;
  variant?: "default" | "destructive" | "success";
}

interface ToastContextValue {
  show: (toast: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((cur) => [...cur, { id, ...toast }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto w-80 rounded-2xl border bg-card p-4 shadow-soft",
              t.variant === "destructive"
                ? "border-crimson-300"
                : t.variant === "success"
                ? "border-emerald-300"
                : "border-border"
            )}
          >
            {t.title && (
              <div className="text-sm font-semibold text-ink">{t.title}</div>
            )}
            {t.description && (
              <div className="mt-1 text-sm text-muted">{t.description}</div>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
