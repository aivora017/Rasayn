import {
  forwardRef,
  useCallback,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { cn } from "../utils/cn.js";
import { useReducedMotion } from "../utils/useReducedMotion.js";

/**
 * Liquid-Glass surface v2 — cursor-aware specular, hover-lift transition,
 * refractive edge-light on hover. Compose freely; multi-layer Glass works.
 *
 * NS §3 reference: Apple Liquid Glass — translucency communicates hierarchy.
 *
 *   depth=1 → inline panels (10 px blur, 75% surface)
 *   depth=2 → floating cards above content (16 px blur, 70% surface)
 *   depth=3 → modals / palettes (28 px blur, 80% surface, strong specular)
 *
 *   interactive → adds hover-lift + edge-light + cursor-tracking specular.
 */

type Depth = 1 | 2 | 3;
type Tone = "neutral" | "brand" | "saffron" | "danger" | "info";

export interface GlassProps extends HTMLAttributes<HTMLDivElement> {
  depth?: Depth;
  tone?: Tone;
  as?: "div" | "section" | "article" | "header" | "footer" | "aside" | "nav";
  children?: ReactNode;
  /** Adds hover-lift + cursor-aware specular + edge-light. */
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
  { depth = 1, tone = "neutral", as: As = "div", className, children, interactive, onMouseMove, onMouseLeave, ...rest },
  ref,
) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion();

  const handleMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!interactive || reduce) return;
    const el = innerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    el.style.setProperty("--pc-glass-x", `${x.toFixed(1)}%`);
    el.style.setProperty("--pc-glass-y", `${y.toFixed(1)}%`);
    onMouseMove?.(e);
  }, [interactive, reduce, onMouseMove]);

  const handleLeave = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (interactive && innerRef.current) {
      innerRef.current.style.removeProperty("--pc-glass-x");
      innerRef.current.style.removeProperty("--pc-glass-y");
    }
    onMouseLeave?.(e);
  }, [interactive, onMouseLeave]);

  // Compose ref forwarding
  const setRefs = (el: HTMLDivElement | null) => {
    innerRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as { current: HTMLDivElement | null }).current = el;
  };

  return (
    <As
      ref={setRefs as never}
      onMouseMove={interactive ? handleMove : onMouseMove}
      onMouseLeave={interactive ? handleLeave : onMouseLeave}
      className={cn(
        "relative rounded-[var(--pc-radius-lg)] overflow-hidden",
        DEPTH_STYLES[depth],
        TONE_STYLES[tone],
        interactive && "pc-glass-interactive",
        className,
      )}
      {...rest}
    >
      {/* Static specular highlight — top-left light source */}
      <span aria-hidden className="pc-glass-specular" />
      {/* Cursor-aware glow (only renders on interactive Glass) */}
      {interactive ? <span aria-hidden className="pc-glass-cursor-glow" /> : null}
      <div className="relative z-10">{children}</div>
    </As>
  );
});
