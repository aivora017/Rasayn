/**
 * PharmaCare Pro — Design Tokens (TypeScript)
 *
 * Source of truth: docs/design/NORTH_STAR.md §4–§7 (ratified ADR-0029).
 *
 * Use these for any value that JavaScript/Motion needs to consume.
 * Visual values that are CSS-renderable live in tokens.css; this module
 * exports values for Motion springs, JS-driven calcs, and TypeScript
 * literal types so off-token usage is a compile error.
 */

// ─── Spring physics tokens (Motion v12) ──────────────────────
// North Star §7.2. Stiffness / damping / mass tuned for desktop.
export const springs = {
  /** Snappy: clicks, toggles, button presses. */
  snap:   { type: "spring" as const, stiffness: 500, damping: 32, mass: 0.6 },
  /** Default: most UI motion — sheets, page transitions, lists. */
  smooth: { type: "spring" as const, stiffness: 300, damping: 30, mass: 0.8 },
  /** Soft: large objects, layout changes. */
  gentle: { type: "spring" as const, stiffness: 180, damping: 26, mass: 1.0 },
  /** Bouncy: success celebrations only. */
  bounce: { type: "spring" as const, stiffness: 400, damping: 18, mass: 0.7 },
} as const;

// ─── Duration tokens (ms) ────────────────────────────────────
export const durations = {
  instant: 80,
  fast:    160,
  base:    220,
  slow:    320,
} as const;

// ─── Easing curves (cubic-bezier) ────────────────────────────
export const easings = {
  easeOut:    [0.22, 1, 0.36, 1] as const,
  easeInOut:  [0.45, 0, 0.55, 1] as const,
} as const;

// ─── Spacing scale (px) — 8 px base, 4 px sub ────────────────
export const spacing = {
  0: 0, 2: 2, 4: 4, 6: 6, 8: 8,
  12: 12, 16: 16, 20: 20, 24: 24,
  32: 32, 40: 40, 48: 48,
  64: 64, 80: 80, 96: 96,
} as const;
export type SpacingToken = keyof typeof spacing;

// ─── Type scale (px) ─────────────────────────────────────────
export const typeScale = {
  "2xs": 11, xs: 12, sm: 13, base: 14, md: 16,
  lg: 18, xl: 22, "2xl": 28, "3xl": 36, "4xl": 48,
} as const;
export type TypeToken = keyof typeof typeScale;

// ─── Radius tokens (px) ──────────────────────────────────────
export const radius = {
  sm:   4,
  md:   8,
  lg:   12,
  xl:   16,
  pill: 9999,
} as const;
export type RadiusToken = keyof typeof radius;

// ─── Color tokens (CSS variable references — never raw hex in code) ─
// Use these strings as values for fill / color / background etc.; runtime
// reads the actual hex from tokens.css. Re-themable without rebuild.
export const color = {
  // Brand
  brand:        "var(--pc-brand-primary)",
  brandHover:   "var(--pc-brand-primary-hover)",
  brandSoft:    "var(--pc-brand-primary-soft)",
  saffron:      "var(--pc-accent-saffron)",
  saffronHover: "var(--pc-accent-saffron-hover)",
  saffronSoft:  "var(--pc-accent-saffron-soft)",

  // Surfaces
  canvas:    "var(--pc-bg-canvas)",
  surface:   "var(--pc-bg-surface)",
  surface2:  "var(--pc-bg-surface-2)",
  surface3:  "var(--pc-bg-surface-3)",

  // Text
  textPrimary:   "var(--pc-text-primary)",
  textSecondary: "var(--pc-text-secondary)",
  textTertiary:  "var(--pc-text-tertiary)",
  textOnBrand:   "var(--pc-text-on-brand)",

  // Borders
  borderSubtle:  "var(--pc-border-subtle)",
  borderDefault: "var(--pc-border-default)",
  borderStrong:  "var(--pc-border-strong)",

  // States
  success:   "var(--pc-state-success)",
  successBg: "var(--pc-state-success-bg)",
  warning:   "var(--pc-state-warning)",
  warningBg: "var(--pc-state-warning-bg)",
  danger:    "var(--pc-state-danger)",
  dangerBg:  "var(--pc-state-danger-bg)",
  info:      "var(--pc-state-info)",
  infoBg:    "var(--pc-state-info-bg)",

  // Data viz
  vizA: "var(--pc-viz-a)",
  vizB: "var(--pc-viz-b)",
  vizC: "var(--pc-viz-c)",
  vizD: "var(--pc-viz-d)",
  vizN: "var(--pc-viz-n)",
} as const;
export type ColorToken = keyof typeof color;
