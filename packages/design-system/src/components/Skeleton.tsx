import type { HTMLAttributes } from "react";
import { cn } from "../utils/cn.js";

/**
 * North Star §9.6 — Skeleton.
 *
 *   bg-surface-3, breathing animation 1500 ms ease-in-out infinite.
 *   Reduced-motion: stays static.
 *   NEVER use spinners for content loading. (Spinners only on Button loading.)
 */

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Pre-set width helpers; or pass className. */
  width?: number | string;
  height?: number | string;
  /** "rect" (default radius-md), "pill", "circle". */
  shape?: "rect" | "pill" | "circle";
}

export function Skeleton({
  width,
  height,
  shape = "rect",
  className,
  style,
  ...rest
}: SkeletonProps): JSX.Element {
  const radiusClass =
    shape === "pill"
      ? "rounded-[var(--pc-radius-pill)]"
      : shape === "circle"
        ? "rounded-full"
        : "rounded-[var(--pc-radius-md)]";
  return (
    <div
      role="status"
      aria-label="Loading"
      aria-busy="true"
      className={cn(
        "pc-skeleton bg-[var(--pc-bg-surface-3)]",
        radiusClass,
        className,
      )}
      style={{
        width,
        height: height ?? 16,
        ...style,
      }}
      {...rest}
    />
  );
}
