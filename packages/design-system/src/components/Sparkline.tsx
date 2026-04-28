import { useMemo } from "react";

/**
 * North Star §9.9 — Sparkline.
 *   24 px h, 2 px stroke brand-primary, area fill brand-soft, no axis/grid.
 *   We avoid a Recharts dependency for simple sparklines (faster mount,
 *   smaller bundle); we render an inline SVG. For full charts use Recharts.
 */

export interface SparklineProps {
  data: readonly number[];
  width?: number;
  height?: number;
  /** "brand" | "saffron" | "warning" | "danger" | "info" — semantic. */
  tone?: "brand" | "saffron" | "warning" | "danger" | "info";
  /** Filled area under the line. */
  filled?: boolean;
  /** 'aria-label' for screen readers — concise summary of the trend. */
  ariaLabel?: string;
}

const toneStroke: Record<NonNullable<SparklineProps["tone"]>, string> = {
  brand: "var(--pc-brand-primary)",
  saffron: "var(--pc-accent-saffron)",
  warning: "var(--pc-state-warning)",
  danger: "var(--pc-state-danger)",
  info: "var(--pc-state-info)",
};

const toneFill: Record<NonNullable<SparklineProps["tone"]>, string> = {
  brand: "var(--pc-brand-primary-soft)",
  saffron: "var(--pc-accent-saffron-soft)",
  warning: "var(--pc-state-warning-bg)",
  danger: "var(--pc-state-danger-bg)",
  info: "var(--pc-state-info-bg)",
};

export function Sparkline({
  data,
  width = 80,
  height = 24,
  tone = "brand",
  filled = true,
  ariaLabel,
}: SparklineProps): JSX.Element {
  const { d, area } = useMemo(() => {
    if (data.length === 0) return { d: "", area: "" };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const stepX = data.length === 1 ? 0 : width / (data.length - 1);
    const points = data.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return [x, y] as const;
    });
    const lineD = points
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" ");
    const last = points[points.length - 1];
    const first = points[0];
    if (!last || !first) return { d: lineD, area: "" };
    const areaD =
      `${lineD} L${last[0].toFixed(2)},${height} L${first[0].toFixed(2)},${height} Z`;
    return { d: lineD, area: areaD };
  }, [data, width, height]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? `Trend, ${data.length} data points`}
    >
      {filled ? <path d={area} fill={toneFill[tone]} /> : null}
      <path d={d} fill="none" stroke={toneStroke[tone]} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
