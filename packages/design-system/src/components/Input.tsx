import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn.js";

/**
 * North Star §9.2 — Input.
 *   36 px h, radius-md, 0.5 px subtle border, 2 px brand focus ring.
 *   Tabular-nums on type=number. Suffix slot for unit (₹, kg, mg, %).
 */

type Size = "sm" | "md" | "lg";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  inputSize?: Size;
  /** Right-side adornment (₹, %, kg, etc.). */
  trailing?: ReactNode | undefined;
  /** Left-side adornment (icon). */
  leading?: ReactNode | undefined;
  invalid?: boolean | undefined;
}

const sizeStyles: Record<Size, string> = {
  sm: "h-7 text-[12px]",
  md: "h-9 text-[13px]",
  lg: "h-11 text-[14px]",
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize = "md", trailing, leading, invalid, className, type = "text", ...rest },
  ref,
) {
  const isNumeric = type === "number" || type === "tel";
  const wrapperBase =
    "inline-flex w-full items-center gap-1.5 rounded-[var(--pc-radius-md)] " +
    "bg-[var(--pc-bg-surface)] px-2.5 " +
    "border transition-colors duration-[var(--pc-duration-instant)] " +
    "focus-within:ring-2 focus-within:ring-[var(--pc-brand-primary)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--pc-bg-canvas)]";
  const borderClass = invalid
    ? "border-[var(--pc-state-danger)]"
    : "border-[var(--pc-border-subtle)] hover:border-[var(--pc-border-default)]";
  return (
    <span className={cn(wrapperBase, sizeStyles[inputSize], borderClass, className)}>
      {leading ? (
        <span aria-hidden className="text-[var(--pc-text-tertiary)] inline-flex">{leading}</span>
      ) : null}
      <input
        ref={ref}
        type={type}
        aria-invalid={invalid || undefined}
        className={cn(
          "flex-1 bg-transparent outline-none placeholder:text-[var(--pc-text-tertiary)]",
          "text-[var(--pc-text-primary)]",
          isNumeric && "pc-tabular",
        )}
        {...rest}
      />
      {trailing ? (
        <span aria-hidden className="text-[var(--pc-text-tertiary)] inline-flex pc-tabular">{trailing}</span>
      ) : null}
    </span>
  );
});
