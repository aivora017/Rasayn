import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "../utils/cn.js";
import { useReducedMotion } from "../utils/useReducedMotion.js";

/**
 * North Star §9.1 — Button primitive.
 *
 *   variant: primary | secondary | ghost | danger | saffron
 *   size:    sm (28h) | md (36h, default) | lg (44h, mobile/older-user)
 *
 *   - Spring `snap` on press (scale 0.97).
 *   - Tokens only — no off-palette hex.
 *   - Always shows shortcut chip if `shortcut` prop set.
 *   - Reduced-motion: scale anim disabled.
 *   - aria-label REQUIRED if children is icon-only.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "saffron";
type Size = "sm" | "md" | "lg";

type DOMButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  keyof HTMLMotionProps<"button">
>;

export interface ButtonProps
  extends Omit<HTMLMotionProps<"button">, "children">,
    DOMButtonProps {
  variant?: Variant;
  size?: Size;
  /** Optional shortcut chip rendered on the right (e.g. "⌘S" or "F1"). */
  shortcut?: string | undefined;
  /** Optional leading icon (Lucide). */
  leadingIcon?: ReactNode | undefined;
  /** Optional trailing icon. */
  trailingIcon?: ReactNode | undefined;
  /** Loading state — disables click + shows spinner. */
  loading?: boolean | undefined;
  children?: ReactNode;
}

const sizeStyles: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12px]",
  md: "h-9 px-3.5 text-[13px]",
  lg: "h-11 px-4 text-[14px]",
};

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-[var(--pc-brand-primary)] text-[var(--pc-text-on-brand)] " +
    "hover:bg-[var(--pc-brand-primary-hover)] " +
    "disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "bg-[var(--pc-bg-surface)] text-[var(--pc-text-primary)] " +
    "border border-[var(--pc-border-subtle)] " +
    "hover:border-[var(--pc-border-default)] hover:bg-[var(--pc-bg-surface-2)] " +
    "disabled:opacity-50 disabled:cursor-not-allowed",
  ghost:
    "bg-transparent text-[var(--pc-text-primary)] " +
    "hover:bg-[var(--pc-bg-surface-3)] " +
    "disabled:opacity-50 disabled:cursor-not-allowed",
  danger:
    "bg-[var(--pc-state-danger)] text-white " +
    "hover:opacity-90 " +
    "disabled:opacity-50 disabled:cursor-not-allowed",
  saffron:
    "bg-[var(--pc-accent-saffron)] text-[#412402] " +
    "hover:bg-[var(--pc-accent-saffron-hover)] hover:text-white " +
    "disabled:opacity-50 disabled:cursor-not-allowed",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    shortcut,
    leadingIcon,
    trailingIcon,
    loading,
    disabled,
    children,
    className,
    type = "button",
    ...rest
  },
  ref,
) {
  const reduce = useReducedMotion();
  const isDisabled = Boolean(disabled) || Boolean(loading);

  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={isDisabled}
      whileTap={reduce || isDisabled ? { scale: 1 } : { scale: 0.97 }}
      transition={
        reduce
          ? { duration: 0 }
          : { type: "spring", stiffness: 500, damping: 32, mass: 0.6 }
      }
      className={cn(
        "inline-flex items-center justify-center gap-1.5",
        "rounded-[var(--pc-radius-md)] font-medium",
        "transition-colors duration-[var(--pc-duration-instant)] ease-[var(--pc-easing-ease-out)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pc-brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pc-bg-canvas)]",
        sizeStyles[size],
        variantStyles[variant],
        className,
      )}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : leadingIcon ? (
        <span aria-hidden className="inline-flex shrink-0">
          {leadingIcon}
        </span>
      ) : null}
      {children ? <span className="truncate">{children}</span> : null}
      {trailingIcon ? (
        <span aria-hidden className="inline-flex shrink-0">
          {trailingIcon}
        </span>
      ) : null}
      {shortcut ? (
        <kbd
          className={cn(
            "ml-1 rounded-[var(--pc-radius-sm)] px-1.5 py-0.5 text-[10px] font-medium",
            "bg-black/10 text-current",
          )}
        >
          {shortcut}
        </kbd>
      ) : null}
    </motion.button>
  );
});
