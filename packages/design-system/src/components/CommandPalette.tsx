import { Command } from "cmdk";
import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../utils/cn.js";
import { useReducedMotion } from "../utils/useReducedMotion.js";

/**
 * North Star §9.5 — Command palette (cmdk).
 *   Modal at elevation-3, max-width 640, top: 20vh.
 *   Sections: Recent / Screens / Products / Customers / Bills / Settings / AI.
 *
 *   We expose a generic shell — the host wires the items.
 *
 *   Open with Ctrl/Cmd+K — handled by the host (App).
 */

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Placeholder for the search input. */
  placeholder?: string;
}

export function CommandPalette({
  open,
  onClose,
  children,
  placeholder = "Search products, customers, bills, screens…",
}: CommandPaletteProps): JSX.Element {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="cmdk-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.12 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            aria-hidden
          />
          <motion.div
            key="cmdk-shell"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30, mass: 0.7 }}
            className="fixed left-1/2 top-[18vh] z-[60] -translate-x-1/2 w-[min(640px,92vw)]"
          >
            <Command
              label="Command palette"
              className={cn(
                "flex flex-col rounded-[var(--pc-radius-lg)]",
                "bg-[var(--pc-bg-surface)] text-[var(--pc-text-primary)]",
                "border border-[var(--pc-border-subtle)]",
                "shadow-[var(--pc-elevation-3)]",
                "overflow-hidden",
              )}
            >
              <Command.Input
                autoFocus
                placeholder={placeholder}
                className={cn(
                  "h-12 w-full bg-transparent px-4",
                  "border-b border-[var(--pc-border-subtle)]",
                  "text-[14px] outline-none placeholder:text-[var(--pc-text-tertiary)]",
                )}
              />
              <Command.List className="max-h-[60vh] overflow-auto p-1">
                <Command.Empty className="px-4 py-8 text-center text-[13px] text-[var(--pc-text-secondary)]">
                  Nothing found. Try a different word.
                </Command.Empty>
                {children}
              </Command.List>
            </Command>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * Group + Item helpers — re-exports of cmdk primitives so consumers
 * import everything from one place.
 */
export const CommandGroup = Command.Group;
export const CommandItem = Command.Item;
export const CommandSeparator = Command.Separator;
