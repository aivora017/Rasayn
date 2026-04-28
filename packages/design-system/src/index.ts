// PharmaCare Pro Design System — public surface.
// Source of truth: docs/design/NORTH_STAR.md (ratified ADR-0029).

// Tokens
export * as tokens from "./tokens.js";
export {
  springs,
  durations,
  easings,
  spacing,
  typeScale,
  radius,
  color,
} from "./tokens.js";
export type {
  SpacingToken,
  TypeToken,
  RadiusToken,
  ColorToken,
} from "./tokens.js";

// Theme
export { ThemeProvider, useTheme } from "./theme/ThemeProvider.js";
export type { ThemeMode, ResolvedTheme } from "./theme/ThemeProvider.js";

// Utils
export { cn } from "./utils/cn.js";
export { useReducedMotion } from "./utils/useReducedMotion.js";
export { formatINR, formatINRCompact, formatNumber, formatPct } from "./utils/format.js";

// i18n
export { initI18n, SUPPORTED_LOCALES, LOCALE_LABELS } from "./i18n/index.js";
export type { Locale } from "./i18n/index.js";

// Components
export { Button } from "./components/Button.js";
export type { ButtonProps } from "./components/Button.js";
export { IconButton } from "./components/IconButton.js";
export type { IconButtonProps } from "./components/IconButton.js";
export { Input } from "./components/Input.js";
export type { InputProps } from "./components/Input.js";
export { Card, CardKpi } from "./components/Card.js";
export type { CardProps, CardKpiProps } from "./components/Card.js";
export { Badge } from "./components/Badge.js";
export type { BadgeProps, BadgeVariant } from "./components/Badge.js";
export { Skeleton } from "./components/Skeleton.js";
export type { SkeletonProps } from "./components/Skeleton.js";
export { Sheet } from "./components/Sheet.js";
export type { SheetProps } from "./components/Sheet.js";
export { ToasterProvider, useToast } from "./components/Toast.js";
export type { ToastVariant } from "./components/Toast.js";
export { Sparkline } from "./components/Sparkline.js";
export type { SparklineProps } from "./components/Sparkline.js";
export { Heatmap } from "./components/Heatmap.js";
export type { HeatmapProps, HeatmapTone } from "./components/Heatmap.js";
export { ThemeToggle } from "./components/ThemeToggle.js";
export {
  CommandPalette,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "./components/CommandPalette.js";
export type { CommandPaletteProps } from "./components/CommandPalette.js";
// State-of-the-art primitives
export { Glass } from "./components/Glass.js";
export type { GlassProps } from "./components/Glass.js";
export { AmbientMesh } from "./components/AmbientMesh.js";
export type { AmbientMeshProps } from "./components/AmbientMesh.js";
export { NumberFlip } from "./components/NumberFlip.js";
export type { NumberFlipProps } from "./components/NumberFlip.js";
export { SparkArea, SparkLine, TrendChart } from "./components/SparkChart.js";
export type { SparkTone } from "./components/SparkChart.js";
export { Illustration } from "./components/Illustration.js";
export type { IllustrationProps, IllustrationName } from "./components/Illustration.js";
export { LocaleSwitcher } from "./components/LocaleSwitcher.js";
export type { LocaleSwitcherProps } from "./components/LocaleSwitcher.js";
