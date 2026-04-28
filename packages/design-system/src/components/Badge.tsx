import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn.js";

/**
 * North Star §9.4 — Badge / Chip.
 *
 *   pill, 11 px / 500, semantic bg + same-family 800 text.
 *   variants encode meaning — never decoration.
 */

export type BadgeVariant =
  | "neutral"
  | "brand"
  | "saffron"
  | "success"
  | "warning"
  | "danger"
  | "info";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children?: ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  neutral:
    "bg-[var(--pc-bg-surface-2)] text-[var(--pc-text-secondary)]",
  brand:
    "bg-[var(--pc-brand-primary-soft)] text-[var(--pc-brand-primary-hover)]",
  saffron:
    "bg-[var(--pc-accent-saffron-soft)] text-[var(--pc-accent-saffron-hover)]",
  success:
    "bg-[var(--pc-state-success-bg)] text-[var(--pc-state-success)]",
  warning:
    "bg-[var(--pc-state-warning-bg)] text-[var(--pc-state-warning)]",
  danger:
    "bg-[var(--pc-state-danger-bg)] text-[var(--pc-state-danger)]",
  info:
    "bg-[var(--pc-state-info-bg)] text-[var(--pc-state-info)]",
};

export function Badge({
  variant = "neutral",
  className,
  children,
  ...rest
}: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--pc-radius-pill)]",
        "px-2 py-0.5 text-[11px] font-medium leading-none",
        variantStyles[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
