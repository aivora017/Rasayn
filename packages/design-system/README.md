# @pharmacare/design-system

Canonical design tokens, theme provider, and primitives for PharmaCare Pro.

**Source of truth:** `docs/design/NORTH_STAR.md` v1.0 (ratified by ADR-0029, Apr 27 2026). Read it before contributing.

## Surface (v0.1.0 — P1 foundation)

| Export | Purpose |
|---|---|
| `tokens.css` (CSS) | Every CSS variable from North Star §4–§7 (color, spacing, radius, elevation, type scale, motion durations) |
| `tailwind.css` (CSS) | Tailwind 4 `@theme` bridge — `bg-pc-brand`, `text-pc-text`, `shadow-pc-1`, etc. |
| `springs`, `durations`, `easings`, `spacing`, `typeScale`, `radius`, `color` (TS) | JS-side tokens for Motion + computed styles |
| `<ThemeProvider>` / `useTheme()` | Light / dark / system, persisted, prefers-color-scheme aware |
| `useReducedMotion()` | `prefers-reduced-motion` hook (binding per North Star §7.5) |
| `cn()` | classNames + tailwind-merge |
| `formatINR / formatINRCompact / formatNumber / formatPct` | en-IN locale formatters; integers in paise |
| `<Button>` | primary / secondary / ghost / danger / saffron, sm/md/lg, shortcut chip, spring-snap on press |
| `<Card>` / `<CardKpi>` | bordered surface card + KPI sub-component (label/value/trend/sparkline) |
| `<Badge>` | semantic pill (neutral/brand/saffron/success/warning/danger/info) |
| `<Skeleton>` | rect/pill/circle, breathing animation, role=status |

## Definition of Design-Done — §17 of North Star

Every UI PR must paste this checklist into the PR body, all 18 boxes ticked, before merge:

- [ ] Visual matches §3 aesthetic and §13 per-screen brief
- [ ] All colors are tokens — no hex literals in source
- [ ] All spacing is from §6.1 8 px scale — no off-scale magic numbers
- [ ] Typography uses §5.2 scale — no off-scale font sizes
- [ ] Light + dark mode both correct
- [ ] Empty / loading (skeleton) / success / error states all implemented
- [ ] Spring tokens from §7.2 used; durations within §7.1 budget
- [ ] Motion only on `opacity` and `transform`
- [ ] `prefers-reduced-motion` honored — verified by toggling OS setting in test
- [ ] Keyboard contract: every action ≤ 2 keystrokes, focus visible, tab order correct
- [ ] WCAG 2.2 AA contrast verified (axe-core or Stark in CI)
- [ ] No icon-only buttons missing aria-label
- [ ] Indian rupee numbers use `Intl.NumberFormat("en-IN")` and `Paise` integers
- [ ] Devanagari/Gujarati strings render with correct line-height multiplier
- [ ] Trust signals from §10 visible on owner-facing screens
- [ ] No anti-patterns from §14
- [ ] Vitest + RTL coverage on new components
- [ ] Cold start <3 s and per-screen p95 interaction <250 ms verified

## Anti-patterns (banned at review)

- Off-palette hex literals in source — use `var(--pc-*)` or `color.*`
- Off-grid spacing — use `spacing[n]` or Tailwind `*-pc-*` classes
- `<Button>` with icon-only children but no `aria-label`
- Spinners for content loading — use `<Skeleton>`
- `width` / `height` / `top` / `left` animations — use transform / opacity / `layout` prop
- Pure-white `#FFFFFF` backgrounds — use `var(--pc-bg-canvas)` (warm)
