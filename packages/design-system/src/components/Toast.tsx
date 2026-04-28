import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../utils/cn.js";
import { useReducedMotion } from "../utils/useReducedMotion.js";

/**
 * North Star §9.7 — Toast.
 *   Top-right, max-width 380, elevation-2, slide-in 160 ms, auto-dismiss 4s.
 *   Stack max 3, oldest collapses.
 *
 *   <Toaster /> mounts the visual surface. <ToasterProvider> exposes useToast.
 */

export type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (t: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 3;
const DISMISS_MS = 4000;

export function ToasterProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const reduce = useReducedMotion();

  const toast = useCallback((t: Omit<ToastItem, "id">) => {
    idRef.current += 1;
    const id = idRef.current;
    setItems((prev) => {
      const next = [...prev, { ...t, id }];
      if (next.length > MAX_TOASTS) next.shift();
      return next;
    });
    setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }, DISMISS_MS);
  }, []);

  // Keyboard dismiss-all: Esc.
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setItems([]);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed top-4 right-4 z-50 flex flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              role="status"
              initial={reduce ? { opacity: 1, x: 0 } : { opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 300, damping: 30, mass: 0.8 }
              }
              className={cn(
                "pointer-events-auto w-[380px] max-w-[90vw]",
                "rounded-[var(--pc-radius-lg)] border p-3 px-4",
                "shadow-[var(--pc-elevation-2)]",
                item.variant === "success" &&
                  "bg-[var(--pc-state-success-bg)] border-transparent text-[var(--pc-state-success)]",
                item.variant === "error" &&
                  "bg-[var(--pc-state-danger-bg)] border-transparent text-[var(--pc-state-danger)]",
                item.variant === "info" &&
                  "bg-[var(--pc-state-info-bg)] border-transparent text-[var(--pc-state-info)]",
              )}
            >
              <div className="text-[13px] font-medium">{item.title}</div>
              {item.description ? (
                <div className="text-[12px] mt-1 opacity-80">{item.description}</div>
              ) : null}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToasterProvider>");
  return ctx;
}
