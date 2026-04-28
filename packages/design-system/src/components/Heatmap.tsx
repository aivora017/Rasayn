import { cn } from "../utils/cn.js";

/**
 * 8-column heatmap grid for SKU image health, expiry buckets, etc.
 * Color encodes meaning per NS §4.2 — never decoration.
 */

export type HeatmapTone = "ok" | "warn" | "danger" | "muted";

export interface HeatmapProps {
  cells: readonly HeatmapTone[];
  cols?: number;
  className?: string;
  ariaLabel: string;
}

const toneColor: Record<HeatmapTone, string> = {
  ok: "var(--pc-state-success)",
  warn: "var(--pc-state-warning)",
  danger: "var(--pc-state-danger)",
  muted: "var(--pc-bg-surface-3)",
};

export function Heatmap({ cells, cols = 8, className, ariaLabel }: HeatmapProps): JSX.Element {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={cn("grid gap-[3px]", className)}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {cells.map((c, i) => (
        <span
          key={i}
          className="aspect-square rounded-[3px]"
          style={{ background: toneColor[c] }}
          aria-hidden
        />
      ))}
    </div>
  );
}
