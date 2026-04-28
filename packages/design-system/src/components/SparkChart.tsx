import { useId } from "react";
import {
  AreaChart,
  Area,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceDot,
} from "recharts";
import { cn } from "../utils/cn.js";

/**
 * Real Recharts-based spark + trend chart with brand-aware tone, gradient
 * fill, optional period-comparison ghost line, and a hover-crosshair tooltip.
 *
 * Three modes:
 *   - <SparkArea> — small inline area sparkline with gradient (replaces the
 *     hand-rolled SVG sparkline)
 *   - <SparkLine> — same shape, line only, no fill
 *   - <TrendChart> — full-size chart with axes, comparison line, dot markers
 */

export type SparkTone = "brand" | "saffron" | "warning" | "danger" | "info";

interface SparkPoint {
  /** X-axis label (date / day / hour). */
  x: string | number;
  /** Y value. */
  y: number;
  /** Optional comparison value (e.g. last-week same-day). */
  yPrev?: number;
}

const TONE_HEX: Record<SparkTone, string> = {
  brand: "#0F6E56",
  saffron: "#EF9F27",
  warning: "#BA7517",
  danger: "#A32D2D",
  info: "#185FA5",
};

/** Tiny inline area sparkline. */
export function SparkArea({
  data,
  tone = "brand",
  width = "100%",
  height = 40,
  ariaLabel,
}: {
  data: readonly number[];
  tone?: SparkTone;
  width?: number | string;
  height?: number | string;
  ariaLabel?: string;
}): JSX.Element {
  const id = useId();
  const points: SparkPoint[] = data.map((y, i) => ({ x: i, y }));
  const hex = TONE_HEX[tone];

  return (
    <div role="img" aria-label={ariaLabel ?? "trend"} style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={hex} stopOpacity={0.45} />
              <stop offset="100%" stopColor={hex} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="y"
            stroke={hex}
            strokeWidth={1.75}
            fill={`url(#grad-${id})`}
            isAnimationActive={false}
            dot={false}
            activeDot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Inline sparkline, line only, no fill. */
export function SparkLine({
  data,
  tone = "brand",
  width = "100%",
  height = 24,
  ariaLabel,
}: {
  data: readonly number[];
  tone?: SparkTone;
  width?: number | string;
  height?: number | string;
  ariaLabel?: string;
}): JSX.Element {
  const points: SparkPoint[] = data.map((y, i) => ({ x: i, y }));
  const hex = TONE_HEX[tone];
  return (
    <div role="img" aria-label={ariaLabel ?? "trend"} style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 1, right: 1, bottom: 1, left: 1 }}>
          <Line
            type="monotone"
            dataKey="y"
            stroke={hex}
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Full-size chart with axes, comparison ghost line, hover crosshair. */
export function TrendChart({
  data,
  tone = "brand",
  height = 200,
  showComparison = false,
  formatY,
  formatX,
  className,
  ariaLabel,
}: {
  data: readonly SparkPoint[];
  tone?: SparkTone;
  height?: number;
  showComparison?: boolean;
  formatY?: (v: number) => string;
  formatX?: (v: string | number) => string;
  className?: string;
  ariaLabel?: string;
}): JSX.Element {
  const id = useId();
  const hex = TONE_HEX[tone];
  const todayIdx = data.length - 1;
  const todayPt = data[todayIdx];

  return (
    <div role="img" aria-label={ariaLabel ?? "trend chart"} className={cn(className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data as SparkPoint[]} margin={{ top: 8, right: 8, bottom: 18, left: 8 }}>
          <defs>
            <linearGradient id={`tgrad-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={hex} stopOpacity={0.30} />
              <stop offset="100%" stopColor={hex} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="x"
            {...(formatX ? { tickFormatter: formatX } : {})}
            stroke="var(--pc-text-tertiary)"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          {showComparison ? (
            <Line
              type="monotone"
              dataKey="yPrev"
              stroke={hex}
              strokeOpacity={0.35}
              strokeDasharray="3 4"
              strokeWidth={1.25}
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          <Area
            type="monotone"
            dataKey="y"
            stroke={hex}
            strokeWidth={2}
            fill={`url(#tgrad-${id})`}
            isAnimationActive={true}
            animationDuration={600}
            dot={false}
          />
          {todayPt ? (
            <ReferenceDot x={todayPt.x} y={todayPt.y} r={4} fill={hex} stroke="var(--pc-bg-surface)" strokeWidth={2} />
          ) : null}
          <Tooltip
            cursor={{ stroke: hex, strokeOpacity: 0.4, strokeWidth: 1 }}
            contentStyle={{
              background: "var(--pc-bg-surface)",
              border: "1px solid var(--pc-border-subtle)",
              borderRadius: 8,
              fontSize: 12,
              padding: "6px 10px",
              boxShadow: "var(--pc-elevation-2)",
            }}
            labelStyle={{ color: "var(--pc-text-secondary)", fontSize: 10 }}
            formatter={(v: number) => [formatY ? formatY(v) : v, ""]}
            labelFormatter={(l) => (formatX ? formatX(l) : String(l))}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
