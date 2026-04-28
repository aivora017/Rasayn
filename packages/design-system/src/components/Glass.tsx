import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn.js";

/**
 * Liquid-Glass surface — translucent panel with backdrop blur, layered
 * specular ring, and depth-aware shadow. Falls back to solid surface where
 * backdrop-filter is unsupported.
 *
 * NS §3 reference: Apple Liquid Glass — translucency communicates hierarchy.
 *
 * depth=1 → dialogs and inline panels (10 px blur, 60% surface)
 * depth=2 → floating cards above content (16 px blur, 70% surface)
 * depth=3 → modal / palette (28 px blur, 80% surface, strong specular)
 */

type Depth = 1 | 2 | 3;
type Tone = "neutral" | "brand" | "saffron" | "danger" | "info";

export interface GlassProps extends HTMLAttributes<HTMLDivElement> {
  depth?: Depth;
  tone?: Tone;
  as?: "div" | "section" | "article" | "header" | "footer" | "aside" | "nav";
  children?: ReactNode;
  /** When true, renders interactive cursor — used for tappable cards. */
  interactive?: boolean;
}

const DEPTH_STYLES: Record<Depth, string> = {
  1: "pc-glass-1",
  2: "pc-glass-2",
  3: "pc-glass-3",
};

const TONE_STYLES: Record<Tone, string> = {
  neutral: "",
  brand: "pc-glass-brand",
  saffron: "pc-glass-saffron",
  danger: "pc-glass-danger",
  info: "pc-glass-info",
};

export const Glass = forwardRef<HTMLDivElement, GlassProps>(function Glass(
  { depth = 1, tone = "neutral", as: As = "div", className, children, interactive, ...rest },
  ref,
) {
  return (
    <As
      ref={ref as never}
      className={cn(
        "relative rounded-[var(--pc-radius-lg)] overflow-hidden",
        DEPTH_STYLES[depth],
        TONE_STYLES[tone],
        interactive && "cursor-pointer transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0",
        className,
      )}
      {...rest}
    >
      {/* Specular highlight — top-left light source */}
      <span aria-hidden className="pc-glass-specular" />
      <div className="relative z-10">{children}</div>
    </As>
  );
});
