import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../utils/cn.js";
import { useReducedMotion } from "../utils/useReducedMotion.js";
import { IconButton } from "./IconButton.js";

/**
 * North Star §7.4 — Modal / sheet.
 *   Overlay fades 160 ms; sheet scales 0.96 → 1 + opacity 180 ms (modal),
 *   slides 16 px from right (side-sheet).
 *   Esc closes. Locks body scroll while open.
 */

type SheetSide = "modal" | "right";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  side?: SheetSide;
  /** ARIA — required. */
  ariaLabel: string;
  /** Optional title rendered in a small header bar (with × close). */
  title?: ReactNode;
  className?: string;
  /** Width when side=right (default 480 px). */
  width?: number | string;
}

export function Sheet({
  open,
  onClose,
  children,
  side = "modal",
  ariaLabel,
  title,
  className,
  width = 480,
}: SheetProps): JSX.Element {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.16 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            key="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            initial={
              reduce
                ? { opacity: 1 }
                : side === "modal"
                  ? { opacity: 0, scale: 0.96 }
                  : { opacity: 0, x: 16 }
            }
            animate={side === "modal" ? { opacity: 1, scale: 1 } : { opacity: 1, x: 0 }}
            exit={
              reduce
                ? { opacity: 0 }
                : side === "modal"
                  ? { opacity: 0, scale: 0.96 }
                  : { opacity: 0, x: 16 }
            }
            transition={
              reduce
                ? { duration: 0 }
                : { type: "spring", stiffness: 300, damping: 30, mass: 0.8 }
            }
            className={cn(
              "fixed z-50",
              side === "modal" &&
                "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(560px,90vw)]",
              side === "right" && "right-0 top-0 h-full",
              "bg-[var(--pc-bg-surface)] text-[var(--pc-text-primary)]",
              "rounded-[var(--pc-radius-lg)] border border-[var(--pc-border-subtle)]",
              "shadow-[var(--pc-elevation-3)]",
              "flex flex-col overflow-hidden",
              className,
            )}
            style={side === "right" ? { width } : {}}
          >
            {title ? (
              <header className="flex items-center justify-between gap-2 border-b border-[var(--pc-border-subtle)] px-4 py-3">
                <div className="text-[14px] font-medium">{title}</div>
                <IconButton aria-label="Close" size="sm" onClick={onClose}>
                  <span aria-hidden style={{ fontSize: 16 }}>×</span>
                </IconButton>
              </header>
            ) : null}
            <div className="flex-1 overflow-auto p-4">{children}</div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
