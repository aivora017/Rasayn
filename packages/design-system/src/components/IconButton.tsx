import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "../utils/cn.js";
import { useReducedMotion } from "../utils/useReducedMotion.js";

/** Icon-only button. ALWAYS requires aria-label (NS §14 anti-pattern). */

type Size = "sm" | "md" | "lg";
type Variant = "ghost" | "outline" | "solid";

type DOMProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof HTMLMotionProps<"button">>;

export interface IconButtonProps
  extends Omit<HTMLMotionProps<"button">, "children">,
    DOMProps {
  size?: Size;
  variant?: Variant;
  /** REQUIRED — icon-only buttons must announce purpose. */
  "aria-label": string;
  children: ReactNode;
}

const sizeMap: Record<Size, string> = {
  sm: "h-7 w-7 text-[14px]",
  md: "h-9 w-9 text-[16px]",
  lg: "h-11 w-11 text-[18px]",
};

const variantMap: Record<Variant, string> = {
  ghost:
    "bg-transparent text-[var(--pc-text-secondary)] hover:bg-[var(--pc-bg-surface-3)] hover:text-[var(--pc-text-primary)]",
  outline:
    "bg-[var(--pc-bg-surface)] text-[var(--pc-text-primary)] " +
    "border border-[var(--pc-border-subtle)] hover:border-[var(--pc-border-default)]",
  solid:
    "bg-[var(--pc-brand-primary)] text-[var(--pc-text-on-brand)] hover:bg-[var(--pc-brand-primary-hover)]",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = "md", variant = "ghost", className, children, type = "button", disabled, ...rest },
  ref,
) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={disabled}
      whileTap={reduce || disabled ? { scale: 1 } : { scale: 0.94 }}
      transition={{ type: "spring", stiffness: 500, damping: 32, mass: 0.6 }}
      className={cn(
        "inline-flex items-center justify-center rounded-[var(--pc-radius-md)]",
        "transition-colors duration-[var(--pc-duration-instant)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pc-brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pc-bg-canvas)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        sizeMap[size],
        variantMap[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
});
