import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn.js";

/**
 * North Star §9.3 — Card primitive.
 *
 *   bg-surface, 0.5 px subtle border, radius-lg, padding 16/20.
 *   Hover → border-default, 80 ms ease.
 *   Variants: default (raised-flat) | recessed (bg-surface-2) | brand (brand-soft tint).
 */

type Variant = "default" | "recessed" | "brand";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  /** Render as <section> with an aria-label/labelledby. */
  as?: "div" | "section" | "article";
  children?: ReactNode;
}

const variantStyles: Record<Variant, string> = {
  default:
    "bg-[var(--pc-bg-surface)] border border-[var(--pc-border-subtle)] " +
    "hover:border-[var(--pc-border-default)]",
  recessed:
    "bg-[var(--pc-bg-surface-2)] border border-transparent",
  brand:
    "bg-[var(--pc-brand-primary-soft)] border border-transparent " +
    "text-[var(--pc-brand-primary-hover)]",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "default", as: As = "div", className, children, ...rest },
  ref,
) {
  return (
    <As
      ref={ref as never}
      className={cn(
        "rounded-[var(--pc-radius-lg)] p-4 px-5",
        "transition-colors duration-[var(--pc-duration-instant)]",
        variantStyles[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
});

/** Optional title row: 13 px secondary uppercase label + 22 px tabular value. */
export interface CardKpiProps {
  label: ReactNode;
  value: ReactNode;
  /** "▲ +12%" / "▼ −2%" — color via state-success / state-warning / state-danger. */
  trend?: ReactNode | undefined;
  /** Optional sparkline element rendered below. */
  sparkline?: ReactNode | undefined;
  className?: string | undefined;
}

export function CardKpi({ label, value, trend, sparkline, className }: CardKpiProps): JSX.Element {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span
        className="text-[11px] uppercase tracking-[0.5px] text-[var(--pc-text-secondary)]"
      >
        {label}
      </span>
      <span className="pc-tabular text-[22px] font-medium leading-tight text-[var(--pc-text-primary)]">
        {value}
      </span>
      {trend ? (
        <span className="text-[11px] text-[var(--pc-text-secondary)]">{trend}</span>
      ) : null}
      {sparkline ? <div className="mt-2">{sparkline}</div> : null}
    </div>
  );
}
