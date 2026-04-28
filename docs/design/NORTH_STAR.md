# PharmaCare Pro — Design North Star v1.0
**Status:** LOCKED. Rank-2 source of truth (below `PharmaCare_Pro_Build_Playbook_v2.0_Final.docx`, above all other docs).
**Author:** Sourav Shaw, Apr 27, 2026, Kalyan IST.
**Scope:** Binds every UI artifact across `apps/desktop`, `apps/mobile`, `apps/web`. Visual / motion / interaction decisions that conflict with this doc require a new ADR ratified by founder.
**Audience:** future-me, every Claude session, every contractor, every contributor.
**Loading rule:** every session that touches `apps/desktop/src/**`, `apps/mobile/**`, `apps/web/**`, `packages/design-system/**`, or any `*.tsx` / `*.css` / `*.scss` MUST read this doc top-to-bottom before producing a single line.

---

## 0. Why this doc exists

The shipped surface (`apps/desktop/src/styles.css` = 18 lines, raw `<table>`, no design system, no motion, no iconography, no charts) does not match the v2.0 Playbook ambition ("redefine the category, not race Marg on features"). This document is the corrective. It encodes the aesthetic, behavioral, and psychological laws that every screen, component, and interaction must satisfy. **No PR touching UI merges without the §17 checklist green.**

## 1. Mission, in one line

> **Make the Indian independent pharmacy owner feel that the future of their shop arrived in a 200 MB installer — calm, professional, fast, beautiful, and unmistakably built for them.**

Calm beats clever. Density beats minimalism (owners want information). Spring beats linear. Trust beats novelty. Hindi/Marathi/Gujarati typography is first-class, not a translation afterthought. Every animation must justify its existence in the cashier's 2-second budget.

## 2. The Twelve Design Laws (binding, reject any work that violates)

1. **Calm by default, expressive on event.** Idle UI is still and quiet. Motion exists to confirm a state change, not to entertain.
2. **Spring physics, not linear easing, for any movement of an object.** Linear is reserved for progress bars and scrubbing.
3. **Keyboard wins. Mouse follows.** Every primary action has a keyboard path ≤2 keystrokes. Mouse paths exist for discoverability, never as the only path.
4. **Density before whitespace, where the owner expects density.** Pharmacy owners read 200+ rows a day. The Dashboard, Inventory, GRN, Reports must be Tufte-density — sparklines, inline trends, no oceans of empty space. Settings and onboarding are different — those use breathing room.
5. **Color encodes meaning, never decoration.** A green chip means "compliant," a red chip means "blocked," an amber chip means "warn." If a color appears that doesn't encode a state, it's wrong.
6. **Trust > Speed > Beauty > Novelty.** When two values fight, trust wins. A single broken state-indicator beats a thousand polished frames.
7. **Light and dark are equal first-class citizens.** Owner shops are bright daylight noon and dim 11pm-cash-tally. Both modes are tested, both ship.
8. **The Indian rupee is a first-class type, not a string.** ₹ symbol, `en-IN` lakh/crore grouping, paise stored as `Paise` (i64), never floating point in display. ₹1,23,456.78 is the only correct rendering.
9. **Devanagari, Gujarati, Tamil typography is not a CSS afterthought.** Line-height, fall-back stack, font-display: swap, glyph coverage tested. If we ship Hindi mode, Hindi is as crisp as English.
10. **Every screen has all four states: empty, loading (skeleton, not spinner), success, error.** Three-of-four is a bug.
11. **Reduced-motion users get instant cross-fades. No exceptions.** `prefers-reduced-motion: reduce` disables every spring, every parallax, every layout animation.
12. **Compliance auto-checks are visible on the home screen, always.** GST, Schedule H/H1/X, IRN, NDPS, DPCO. The owner never has to dig for "am I legal right now."

## 3. Aesthetic Identity — what PharmaCare Pro looks, sounds, feels like

**One-sentence brand:** Linear's calm + Stripe's sparkline density + Geist's contrast discipline + Apple Liquid Glass's translucency-as-hierarchy + Material 3 Expressive's spring motion — **in Indian pharmacy green and saffron, on the Inter + Mukta type stack.**

**Reference tier (study these, internalize, do not clone):**
- Linear (linear.app/now/behind-the-latest-design-refresh) — calm UI, screenshot-on-screenshot iteration, type discipline, cmd+K dominance.
- Stripe Dashboard — sparklines on KPI cards, Inter at scale, generous whitespace where it matters, trend indicators on every metric.
- Vercel Geist — high-contrast accessible color tokens, monospace for codes, tight component primitives.
- Raycast — keyboard-first, command palette as primary nav, tooltips show shortcut on hover.
- Arc / Warp — dark-first identity, light mode equally polished.
- Apple Liquid Glass (iOS 26 / macOS Tahoe) — translucency communicates hierarchy depth, not decoration. Floating controls over content, not solid blocks.
- Material 3 Expressive — spring physics with stiffness/damping/mass, motion as language not garnish.
- Mercury Bank — financial trust without sterility.
- Notion — bento for canvases, calm typography.

**Reject (do NOT copy):**
- Pure neumorphism (accessibility crisis, low contrast).
- Decorative glassmorphism — blur only when it separates UI hierarchy from content.
- Neo-brutalism for healthcare — wrong tonal register, breaks trust.
- Marg ERP / GoFrugal / Medeil — every visual cue from these is a tell of "I am old software."
- Generic admin-template look (Tabler, AdminLTE, Dashtail, Material Dashboard) — instant "WordPress-tier."

**Aesthetic signature (the three things a designer should be able to identify PharmaCare Pro by, even with logo removed):**
1. **Pharmacy-green (`#0F6E56`) primary, with saffron (`#EF9F27`) momentum accents.** Not a blue healthcare app.
2. **Inline sparklines + lakh/crore Indian-grouping numbers on every KPI.** Numbers are protagonists.
3. **Spring-physics motion with a 220 ms median duration.** Springs feel hand-tuned, never preset.

## 4. Color System

### 4.1 Foundation — why these and not others

We do **not** lead with the healthcare-default blue (60% of healthcare apps already do; we differentiate). We anchor on **pharmacy-green** (the green pharmacy cross is the universal Indian pharmacy mark — instant cultural recognition, "healing, growth, calm"). We use **saffron** as cultural-warmth accent (auspicious in Hindu/Sikh/Buddhist culture, signals momentum and CTA). **Deep teal** carries financial-trust weight. **White surfaces are warm-toned** (#FAF9F6) not pure-white — pure white in Indian context can read funereal in solemn moments. **Red is reserved for hard-block danger only** because in Indian culture red is also auspicious; misusing it confuses signal.

### 4.2 The palette (canonical hex; never invent off-palette colors)

#### Brand
| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand-primary` | `#0F6E56` (Pharmacy Green 600) | `#5DCAA5` (Green 200) | Logo, primary buttons, active nav, brand surfaces |
| `--brand-primary-hover` | `#085041` | `#9FE1CB` | Hover state on primary |
| `--brand-primary-soft` | `#E1F5EE` | `#04342C` | Tinted backgrounds, badges, selected rows |
| `--accent-saffron` | `#EF9F27` | `#FAC775` | CTA momentum, "ship it" actions, festive moments |
| `--accent-saffron-soft` | `#FAEEDA` | `#412402` | Saffron-tinted backgrounds |

#### Neutrals
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg-canvas` | `#FAF9F6` (warm white) | `#0B0F0E` (near-black, warm) | App canvas |
| `--bg-surface` | `#FFFFFF` | `#141918` | Cards, modals |
| `--bg-surface-2` | `#F5F3EE` | `#1A201F` | Recessed surfaces, table headers |
| `--bg-surface-3` | `#EDEAE2` | `#222827` | Inputs, hover states |
| `--text-primary` | `#0F1715` | `#F1EFE8` | Body text |
| `--text-secondary` | `#4F5754` | `#B4B2A9` | Labels, captions |
| `--text-tertiary` | `#7A8079` | `#7B7E78` | Hints, placeholder |
| `--text-on-brand` | `#FFFFFF` | `#04342C` | Text on primary fill |
| `--border-subtle` | `#E5E1D6` | `#2A2F2D` | 0.5px default borders |
| `--border-default` | `#D3D1C7` | `#3A413E` | Hover/focus borders |
| `--border-strong` | `#888780` | `#5F5E5A` | Emphasis borders |

#### Semantic (state)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--state-success` | `#1D9E75` | `#5DCAA5` | OK, compliant, in-stock |
| `--state-success-bg` | `#E1F5EE` | `#04342C` | Success badges |
| `--state-warning` | `#BA7517` | `#EF9F27` | 90-day expiry, IRN retrying, margin drift |
| `--state-warning-bg` | `#FAEEDA` | `#412402` | Warning badges |
| `--state-danger` | `#A32D2D` | `#E24B4A` | Hard-block: expired, DPCO violation, license missing |
| `--state-danger-bg` | `#FCEBEB` | `#501313` | Danger badges |
| `--state-info` | `#185FA5` | `#85B7EB` | Informational notices, links |
| `--state-info-bg` | `#E6F1FB` | `#042C53` | Info badges |

#### Data viz (categorical, NOT cycled like a rainbow)
| Slot | Light hex | Dark hex | Reserved for |
|---|---|---|---|
| Series A (primary) | `#0F6E56` | `#5DCAA5` | Sales (the dominant series) |
| Series B | `#534AB7` (purple 600) | `#AFA9EC` | Margin, secondary metrics |
| Series C | `#EF9F27` | `#FAC775` | GST, tax, regulatory |
| Series D | `#185FA5` | `#85B7EB` | Customers, suppliers, third-party |
| Neutral | `#888780` | `#B4B2A9` | Baseline, totals, "other" |

**Rules of color use** (binding):
- Text on a colored fill uses the same family's 800/900 stop, never `#000` or `var(--text-primary)`.
- Color never carries meaning alone. A red row also has an icon and a text label. WCAG 1.4.1.
- Maximum 3 ramps per screen. The dashboard already uses brand + saffron + neutrals; adding purple and amber for charts is the cap.
- Borders are 0.5px / 1px solid. Never 2px except to highlight a recommended/featured option.

### 4.3 Cultural color reasoning (locked, do not relitigate)

| Color | Indian cultural meaning | Our usage |
|---|---|---|
| Green | Healing, prosperity, harmony, pharmacy cross worldwide | Brand primary — owns identity |
| Saffron | Sacred, purifying, auspicious, ascetic — strongly Hindu but read as "Indian" universally | Accent for momentum CTAs, festival moments, "first-run welcome" |
| White (warm) | Purity, peace, knowledge — but pure white = mourning, so we use warm white #FAF9F6 | Canvas, never for celebration |
| Red | Vitality, life, weddings — but ALSO clear danger signal in software | Reserved exclusively for hard-block danger states; never decorative |
| Blue | Krishna's color, calm, trust | Info badges, links, supplier accent — NOT the brand |
| Black/charcoal | Modern, premium, professional | Dark mode canvas, body text on light |

## 5. Typography System

### 5.1 Type stack
```css
--font-sans:    "Inter", "Inter var", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--font-devanagari: "Mukta", "Noto Sans Devanagari", "Inter", system-ui, sans-serif;
--font-gujarati: "Mukta Vaani", "Noto Sans Gujarati", "Inter", system-ui, sans-serif;
--font-tamil:   "Mukta Malar", "Noto Sans Tamil", "Inter", system-ui, sans-serif;
--font-mono:    "Geist Mono", "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
--font-display: "Inter", "Inter var", system-ui, sans-serif;  /* opt-in tighter tracking */
```
- Inter at variable axes: 400 (regular), 500 (medium), 600 (semibold for headings), 700 reserved for display only.
- Mukta is the chosen Devanagari/Gujarati pair (used by Lokmat Marathi, optical match to Inter).
- Geist Mono for codes: GSTIN, batch numbers, IRN, HSN, license number, UPI VPA. **Always monospace for codes** so columns align.

### 5.2 Type scale (rem-based, root = 16px)
| Token | Size | Weight | Line-height | Tracking | Use |
|---|---|---|---|---|---|
| `text-2xs` | 11px | 500 | 1.4 | +0.04em | Kbd, tags, pill labels |
| `text-xs` | 12px | 400 | 1.5 | 0 | Captions, metadata |
| `text-sm` | 13px | 400 | 1.5 | 0 | Secondary body, table cells |
| `text-base` | 14px | 400 | 1.6 | 0 | **Default body. Owner-facing.** |
| `text-md` | 16px | 400 | 1.6 | 0 | Forms, settings (older-user min) |
| `text-lg` | 18px | 500 | 1.4 | -0.005em | Subheadings, card titles |
| `text-xl` | 22px | 500 | 1.3 | -0.01em | Section headings, KPI numbers |
| `text-2xl` | 28px | 500 | 1.25 | -0.015em | Page titles, big totals |
| `text-3xl` | 36px | 600 | 1.2 | -0.02em | Hero, grand-total bill amount |
| `text-4xl` | 48px | 600 | 1.1 | -0.025em | Onboarding hero only |

**Devanagari/Gujarati line-height multiplier: ×1.1** on all body text (account for matra/diacritic ascenders).

### 5.3 Typographic discipline (binding)
- Two weights only in any given screen: 400 + 500. Add 600 only for h1/h2.
- Sentence case always. Never Title Case. Never ALL CAPS except for `.kbd` chips.
- Tabular numerals (`font-variant-numeric: tabular-nums`) on every number column, KPI value, and currency cell. Always.
- Currency renders via `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })` and ALWAYS shows the `₹` symbol attached, no space.
- No mid-sentence bold. Use `<code>` for entity names.

## 6. Spacing, Layout & Grid

### 6.1 Spacing scale (8px base, 4px sub)
`0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96` px → tokens `space-0` through `space-96`. **No off-scale values. Ever.**

### 6.2 Border radius
| Token | Value | Use |
|---|---|---|
| `radius-sm` | 4px | Pills, chips, small badges, inline kbd |
| `radius-md` | 8px | Buttons, inputs, small cards |
| `radius-lg` | 12px | Cards, modals, sheet edges |
| `radius-xl` | 16px | Hero cards, dashboard bento tiles |
| `radius-pill` | 9999px | Avatars, pills |

**Never** mix radii with single-side borders. If `border-left: 3px`, `border-radius: 0`.

### 6.3 Elevation (shadows)
| Token | Light shadow | Dark shadow | Use |
|---|---|---|---|
| `elevation-0` | none | none | Default flat |
| `elevation-1` | `0 1px 2px rgba(15,23,21,0.04), 0 0 0 0.5px rgba(15,23,21,0.06)` | `0 1px 2px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.04)` | Cards |
| `elevation-2` | `0 4px 12px rgba(15,23,21,0.06), 0 0 0 0.5px rgba(15,23,21,0.06)` | `0 4px 12px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.06)` | Dropdowns, popovers |
| `elevation-3` | `0 12px 32px rgba(15,23,21,0.10), 0 0 0 0.5px rgba(15,23,21,0.08)` | `0 12px 32px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(255,255,255,0.08)` | Modals, command palette |
| `focus-ring` | `0 0 0 2px var(--bg-canvas), 0 0 0 4px var(--brand-primary)` | same | Keyboard focus only — never hover |

### 6.4 Layout patterns

**Dashboard = Bento.** 67% of top-100 SaaS use bento now (ProductHunt 2026). Asymmetric blocks, 8-col grid on desktop, F-pattern reading (top-left = highest-attention KPI).

**Billing = Single rail.** The cashier stares at one screen for 8 hours. Left: bill lines (1fr). Right: totals + payment (380px fixed). No bento, no distraction.

**GRN = Split-view.** Left: parsed lines (fr). Right: original bill image (fr). Owner needs to compare every line against the source.

**Inventory = Dense table + filter sidebar.** 50+ rows visible without scroll on 1080p. Sticky header. Tufte-density rule.

**Settings = Centered single column, max-width 720px.** Long-form, breathing room, the opposite of dashboard density.

**Mobile (RN, P5) = Stack always, never bento.** Owner app uses pull-to-refresh, customer app uses tab bar.

## 7. Motion Language

### 7.1 The motion budget
- Median animation duration: **220 ms.**
- Page transition: **180 ms cross-fade + 8px slide.** Via View Transitions API (Chromium 115+, Safari 18.2+, prod-ready 2026).
- List item insert: **layout animation, 240 ms spring.**
- Modal/sheet: **180 ms ease-out scale 0.96→1 + opacity.**
- Toast: **160 ms slide + fade, 4s default duration.**
- Hover: **80 ms ease-out** on color/border. Never animate on layout-affecting properties on hover.

### 7.2 Spring tokens (Motion v12, formerly Framer Motion)
```ts
export const springs = {
  // Snappy: clicks, toggles
  snap:   { type: "spring", stiffness: 500, damping: 32, mass: 0.6 },
  // Default: most UI
  smooth: { type: "spring", stiffness: 300, damping: 30, mass: 0.8 },
  // Soft: layout, large objects
  gentle: { type: "spring", stiffness: 180, damping: 26, mass: 1.0 },
  // Bouncy: success celebrations only
  bounce: { type: "spring", stiffness: 400, damping: 18, mass: 0.7 },
} as const;
```

### 7.3 GPU-only properties
Animate only: `opacity`, `transform` (`x`, `y`, `scale`, `rotate`). Never `width`, `height`, `top`, `left`, `margin`. Use `layout` prop in Motion for size changes.

### 7.4 Motion-as-feedback patterns (binding)

| Event | Visual response |
|---|---|
| Button click | scale 1 → 0.97 → 1, snap spring |
| Form save success | green checkmark fades in 200 ms + subtle row pulse (bg flash brand-soft 600 ms ease-out) + Tauri haptic tick (mobile only) |
| Validation error | input shakes ±4px x2, danger border, message slides in below |
| Bill total updates | number-flip animation (top digit slides up, new digit slides in from below), 280 ms gentle |
| FEFO batch chosen | card scale 1 → 1.02 → 1 with brand-primary 1px ring fade |
| List item delete | row fades + collapses height, layout spring |
| Loading | skeleton breathes (opacity 0.5 → 1, 1500 ms ease-in-out infinite) |
| Modal open | overlay fades in 160 ms; modal scales 0.96 → 1 + opacity, 180 ms smooth |
| Page change | View Transition cross-fade + 8px slide-up of new content |

### 7.5 Reduced-motion mandate
```ts
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  // All transitions become 0ms, springs become tween duration: 0,
  // page transitions become instant, skeletons stop breathing.
}
```
**No exceptions.** Tested before merge.

## 8. Iconography

### 8.1 Library: **Lucide** (1,500 icons, 24×24 grid, consistent 2px stroke, MIT)
- Outline default. Filled (Lucide does not ship; use lucide-static + manual filled-set) only for active nav/states.
- Size scale: 14, 16 (default in body), 18, 20, 24 (default in nav), 32, 48.
- Stroke width: 1.5 (subtle), 2 (default), 2.5 (emphasis).
- Color inherits `currentColor` from parent text — no hard-coded fills.

### 8.2 Banned
- Emoji as icons in app chrome (we currently have `&middot;` separators — banned).
- Mixing icon styles (don't mix Lucide outline with Heroicons solid).
- Icons without aria-label on icon-only buttons.

### 8.3 The 24 icons we use everywhere — name them once, use them forever
| Concept | Lucide name |
|---|---|
| Bill / receipt | `receipt` |
| Inventory / box | `package` |
| Search | `search` |
| Customer / person | `user-round` |
| Doctor | `stethoscope` |
| Supplier / truck | `truck` |
| GRN / receive | `package-plus` |
| Returns | `undo-2` |
| Reports | `chart-line` |
| Settings | `settings-2` |
| Alert / warning | `triangle-alert` |
| Compliance OK | `shield-check` |
| Compliance fail | `shield-x` |
| Expiring | `clock-alert` (custom) / `hourglass` |
| GST | `landmark` |
| Schedule H | `pill` |
| NDPS | `flask-conical` |
| Photo bill (X3) | `camera` |
| Gmail (X1) | `mail` |
| SKU image (X2) | `image` |
| Print | `printer` |
| Export / download | `download` |
| Upload | `upload` |
| AI copilot | `sparkles` |
| Command palette | `command` |

## 9. Components — primitives

Built on shadcn/ui (Radix primitives) + Tailwind 4. Every component lives in `packages/design-system/src/`. Owned, not installed-from-npm — we modify freely.

### 9.1 Button
- Variants: `primary` (brand fill, white text), `secondary` (border + transparent), `ghost` (transparent, hover bg-surface-3), `danger` (state-danger fill), `saffron` (accent, for "ship it" CTAs).
- Sizes: `sm` (28px h), `md` (36px h, default), `lg` (44px h — older-user min, mobile primary).
- Always shows shortcut chip on hover if one exists: `Save  ⌘S`.
- Spring `snap` on press.

### 9.2 Input
- Default 36px h, `radius-md`, 1px border-subtle, focus → 2px brand ring.
- Tabular-nums on number inputs.
- Error state: 1px state-danger border + below-line message slide-in.
- Suffix slot for unit (`₹`, `kg`, `mg`).

### 9.3 Card
- `bg-surface`, 0.5px border-subtle, `radius-lg`, `padding: 16px 20px`.
- Title row: 13px text-secondary uppercase letter-spacing 0.5px label + 22px tabular value below.
- Hover: border-default, 80 ms ease.

### 9.4 Badge / Chip
- Pill `radius-pill`, padding `2px 8px`, 11px 500 weight, semantic bg + same-family 800 text.
- Variants: `success`, `warning`, `danger`, `info`, `neutral`, `brand`, `saffron`.

### 9.5 Command palette (`cmdk`, ⌘K / Ctrl+K)
- Modal at `elevation-3`, max-width 640px, top: 20vh.
- Sections: Recent · Screens · Products · Customers · Bills · Settings · AI copilot.
- Each row: icon + label + (right) shortcut chip + (right) breadcrumb.
- Up to 2,000 items virtualized — cmdk is fine to that scale, then we add tanstack-virtual.

### 9.6 Skeleton
- Same shape as content, `bg-surface-3`, breathing animation (opacity 0.5↔1, 1500ms ease-in-out, reduced-motion → static).
- **Never spinners** for content loading. Spinners only for indeterminate sub-second actions (button loading).

### 9.7 Toast
- Top-right, max-width 380px, `elevation-2`, slide-in from right 160 ms, auto-dismiss 4s, dismissable.
- Variants: `success` (state-success), `error` (state-danger), `info` (state-info).
- Stack max 3, oldest collapses.

### 9.8 Empty state
Three categories, each with prescribed structure:
1. **Informational** — illustration (svg, ≤24KB, single brand-soft tint) + 18px label + 14px text-secondary description + nothing else.
2. **Action-oriented** — same + primary button with shortcut chip.
3. **Celebratory** — sparkles + saffron tinted bg + label + secondary action ("View report").

**Banned:** generic stock illustrations. Empty-state art lives in `packages/design-system/illustrations/` and uses our palette.

### 9.9 Charts (in-card sparklines + full views)
- Sparkline = Recharts `<LineChart>` minimal: no axis, no grid, 2px stroke brand-primary, 24px h, area fill `brand-soft`.
- KPI card pattern: 11px label / 22px tabular value / 11px trend (▲ +12% in state-success or ▼ −2% in state-warning) / 24px sparkline below.
- Full charts use Chart.js for ease, Recharts for React idiom — pick ONE and stick. **We pick Recharts.** D3 only when Recharts can't (sankeys, geo).
- Always tabular-nums on axis labels.
- Color rules from §4.2 data-viz block — never rainbow.

## 10. Trust signals (mandatory checklist on every owner-facing screen)

Pharmacy owners have **counterfeit anxiety** (per Indian e-pharmacy research, 98.5% prefer brick-and-mortar). Trust is our central UX brief.

Persistent trust signals (must be visible somewhere on every screen):
- [ ] Shop name + retail license number in topbar (real shop, real license).
- [ ] LAN online indicator + last sync time in statusbar.
- [ ] Compliance auto-check summary on home (GSTR-1 ready, Schedule H register, IRN status, NDPS, DPCO).
- [ ] AI features show confidence chips (X1 parsing %, X3 OCR @3 recall%) — never hide uncertainty.
- [ ] Every state-changing action shows "saved 2s ago · Sourav" in audit-trail micro-row.
- [ ] First-run banner until shop GSTIN + license entered; GST invoices blocked. (Already shipped in `App.tsx`. Keep. Re-skin.)
- [ ] Backup status visible on Settings (last LAN snapshot, last cloud bridge if enabled).
- [ ] Error states cite cause + fix + "call us" number — never just "something went wrong."

## 11. Cognitive load & attention discipline (Sweller / Tufte / Hick / Fitts applied)

### 11.1 Hick's Law applied
Top nav has 10 items today (Alt+1 to Alt+0). That's over the 7±2 budget. **Group into 4 buckets:**
- **Sell** → Billing, Returns, Customer
- **Receive** → GRN, Gmail Inbox (X1), Suppliers, Templates
- **Stock** → Inventory, Masters
- **Insights** → Reports, Compliance, Copilot
Settings + Profile sit in topbar-right separately. Alt+1..4 maps to the 4 buckets; second-tier letters open sub-screens. Owners keep all current shortcuts via aliases — no muscle memory broken.

### 11.2 Fitts's Law applied
- Bill grand-total + Print + Save buttons cluster bottom-right of bill rail (closest to natural mouse drag-out).
- Primary CTA on every modal is bottom-right, secondary bottom-left.
- The command palette is one keystroke (⌘K / Ctrl+K) — Fitts says zero distance is best.
- Status indicators in topbar/statusbar are frequent → make them targets ≥24px high.

### 11.3 Tufte data-ink ratio
- Inline sparklines on every KPI card. Number = ink. Sparkline = ink. Frame, axis, grid = remove.
- Inventory tables show inline 7-day demand sparkline next to on-hand qty. No separate chart.
- Sales screens default to small-multiples (one sparkline per category, 3×3 grid) over one big stacked chart.

### 11.4 Cognitive Load Theory applied
- **Chunking:** group dashboard panels by category (Sales · Compliance · Moats · Stock · Copilot), 4–5 items per chunk.
- **Progressive disclosure:** dashboard shows 4 KPIs + 6 panels. Drill-down on click to detail view. Don't show all 50 columns of inventory on home.
- **Role-based view:** if multi-user mode is on (post-Owner-Override), cashier sees Billing only; owner sees full Dashboard.

## 12. Accessibility floor (WCAG 2.2 AA + older-adult considerations)

| Item | Requirement |
|---|---|
| Color contrast — body text | ≥4.5:1 (target 7:1) |
| Color contrast — large text & UI | ≥3:1 |
| Focus indicators | 2px ring, never `outline: none` without replacement |
| Color alone for state | Forbidden. Always icon + label + color. |
| Keyboard navigation | Full app. Every action reachable. Tab order matches reading order. |
| Touch targets (mobile + ≥44px desktop where appropriate) | 44×44 minimum |
| Body font size | ≥16px (we use 14 for dense UI; 16 for forms/settings — owner ≥45 may want UI scale 110% via setting) |
| Line height | 1.5+ for body, 1.6 for forms, 1.4 for headings |
| Reduced motion | Honored, tested |
| Screen reader | aria-labels on icon-only buttons, aria-live on toast, aria-busy on skeletons |
| Color blindness | Tested via simulation (deuteranopia, protanopia, tritanopia) — danger never relies on red alone |

## 13. Per-screen design briefs (binding)

Every redesign PR uses these as acceptance criteria.

### 13.1 Dashboard (the new home)
- **Replaces:** the current "boot into BillingScreen."
- **Target mockup:** the widget rendered Apr 27, 2026 in `pharmacare_pro_2026_dashboard_target` (studio session 1ff85544).
- **Bento layout, 8-col grid:**
  1. Top row (4 KPI cards × 2-col each): Today's sales / Bills / Margin / Cash drawer. Each with sparkline + trend.
  2. Mid row split 5-col + 3-col: 7-day sales line chart / Compliance auto-checks list.
  3. Three moat cards (X1, X2, X3) at 3 × 3-col, with the X-badge + signature visualization (X1: parsed list, X2: heatmap grid, X3: drop-zone).
  4. Bottom split 4-col + 4-col: Expiry heatmap / AI copilot suggestions.
  5. Footer shortcuts strip.
- Owner photo + shop license in topbar-right.
- Ctrl+K command palette anywhere.

### 13.2 BillingScreen
- **Keep keyboard contract intact.** All current F-keys and Alt+digit navigation preserved.
- Re-skin only. Replace `<table>` with shadcn `<DataTable>` styled to our tokens.
- Bill total in `text-3xl` saffron-on-white grand display, bottom-right.
- FEFO batch chip animates in with `bounce` spring on selection.
- Expiry chip color: green ≥90d, amber 30–90d, red <30d, hard-block on 0d (already implemented logic — re-skin chip).
- Print iframe stays (ADR-0014). Visual print preview in a side-sheet on F10.
- Schedule H/H1/X badge appears beside product line if Rx required.

### 13.3 GRN
- Split-view: parsed lines left, original bill image right (Gmail-bridge or photo-bill).
- Confidence chip per line: green ≥95%, amber 80–95%, red <80% (manual review).
- Three-way match indicator (PO ↔ GRN ↔ Bill) with diff highlight.
- Bulk-accept high-confidence rows on `Shift+Enter`.

### 13.4 Inventory
- Sticky header table, 50+ visible rows on 1080p.
- Inline columns: SKU image (32×32), name, batch, expiry chip, on-hand, 7-day demand sparkline, days-of-cover, MRP, actions.
- Filter sidebar collapsible (Ctrl+\).
- Bulk-edit on selection (`Shift+click`).

### 13.5 Returns (A8/A10)
- Partial-return picker uses card-based batch selector with quantity stepper.
- Refund summary card on right rail.
- Schedule H reverse-register entry shown for compliance.

### 13.6 Reports
- Bento dashboard mode (default) + table mode (Ctrl+T toggle).
- GSTR-1 export card with download button + audit log of last 10 exports.
- Drill-down via View Transitions — clicking a card animates expansion to full screen.

### 13.7 Gmail Inbox (X1)
- Three-pane: thread list left, original bill middle, parsed-lines right.
- Confidence ribbon top-right of parsed pane.
- One-click "Promote to GRN" button — saffron primary CTA.

### 13.8 Product Master + SKU Image (X2)
- Image grid with hover-zoom, click for full-screen compare.
- Schedule H/H1/X badge on each card.
- Bulk-uploader with drag-drop zone, preview thumbs, per-image confidence on dup-detection.
- Duplicate-suspect modal with side-by-side view + Hamming distance.

### 13.9 Photo-bill GRN (X3)
- Drop-zone hero on dashboard takes drag-drop of phone-uploaded image.
- Capture screen has live OCR overlay — recognized lines highlight on the image as detection runs.
- Per-line accept/reject with `Y/N` keys.
- Final state: parsed lines flow into GRN screen.

### 13.10 Settings
- Centered single-column max-width 720px.
- Sections: Shop · License · GST · Hardware · Backup · Users · About.
- Each section is a card with section title, fields, save action saved-state indicator.

### 13.11 Compliance Dashboard
- Already exists as a list. **Promote to a real dashboard:** missing-image heatmap + dup-suspect compare grid + GSTR-1 status + Schedule H register count + DPCO violations + NDPS form IV count + DPDP consent registry.

## 14. Anti-patterns — banned, will be rejected at review

- Pure-white `#FFFFFF` canvas (use warm `#FAF9F6`).
- Icon-only buttons without aria-label.
- Spinners for content loading (always skeleton).
- Toast as a primary success indicator for state-changing actions (use inline confirmation + toast as secondary).
- Mid-sentence bold for emphasis.
- Title Case in any UI string.
- ALL CAPS except `.kbd` chips.
- `box-shadow` for decoration (only for elevation tokens).
- `border-radius` mixed with single-side borders.
- Off-palette colors. Off-grid spacing.
- Linear easing on object motion (only on progress).
- Animations on `width`, `height`, `top`, `left` (use transform / layout prop).
- Bento layout on Billing or Settings (wrong context).
- Hardcoded English strings in source — i18n keys from day one.
- Float math for currency (always Paise as integer, `formatINR` from `@pharmacare/shared-types`).
- "as of my knowledge cutoff" phrasing in any AI-copilot UX string.

## 15. Tech stack — locked

| Layer | Choice | Rationale |
|---|---|---|
| CSS | **Tailwind CSS 4** (`@theme` directive) | Utility-first, OKLCH, no build pipeline pain |
| Component primitives | **shadcn/ui** (owns Radix + Tailwind) | We own the source; modify freely |
| Icons | **Lucide** | 1,500 icons, 24×24, consistent stroke |
| Motion | **Motion v12** (`motion/react`) | Spring physics, layout, View Transitions interop |
| Charts | **Recharts** primary, Chart.js secondary | React idiom, dark-mode tokens compatible |
| Command palette | **cmdk** (Vercel) | Headless, accessible, used by Linear/Vercel |
| Forms | **react-hook-form + Zod** | Already in ecosystem, type-safe |
| State | **Zustand** for ephemeral, **TanStack Query** for server | LAN-first allows simpler cache than full Redux |
| Tables | **TanStack Table v8** | Headless, virtualized via tanstack-virtual |
| i18n | **i18next** + react-i18next | Hindi, Marathi, Gujarati, Tamil, English from day one |
| Image | shadcn Avatar + custom `ProductImageThumb` | Already exists |
| Date | `date-fns` with `en-IN` locale, IST tz | DST-free, owner expectation |
| Routing (desktop) | **React Router 7** + View Transitions API | Native cross-doc transitions |
| Mobile (P5) | **Expo + React Native + Reanimated 3 + Tamagui or NativeWind** | Tokens shared with desktop |
| Web (P5) | **Next.js 15 + Tailwind 4** | Tokens shared via `packages/design-system` |

**Bundle budget per Playbook §2:**
- Desktop installer ≤200 MB total.
- Frontend bundle (vite output): ≤2.5 MB initial JS, ≤500 KB initial CSS.
- Each screen lazy-loads its charts; Recharts chunked, never in main bundle.

## 16. Localization

- Default English; first-class Hindi, Marathi, Gujarati at GA. Tamil added in M6.
- Numbers: `Intl.NumberFormat("en-IN", ...)` always — even when UI locale is Hindi, numbers use en-IN grouping (cultural standard).
- Currency: `formatINR(paise)` from `@pharmacare/shared-types` — NEVER inline ₹ math.
- Dates: `format(date, "d MMM yyyy", { locale: enIN })` short, `format(date, "EEEE, d MMM yyyy")` long.
- IST always, no DST.
- Hindi/Marathi line-height ×1.1 multiplier on all text.
- Pluralization via i18next plural rules per language.

## 17. Definition of Design-Done — checklist (every UI PR must satisfy)

A UI PR cannot merge unless **every** box is green:

- [ ] Visual matches §3 aesthetic and §13 per-screen brief.
- [ ] All colors are tokens from §4.2 — no hex literals in source.
- [ ] All spacing is from §6.1 8px scale — no off-scale magic numbers.
- [ ] Typography uses §5.2 scale — no off-scale font sizes.
- [ ] Light + dark mode both correct.
- [ ] Empty / loading (skeleton) / success / error states all implemented.
- [ ] Spring tokens from §7.2 used; durations within §7.1 budget.
- [ ] Motion only on `opacity` and `transform`.
- [ ] `prefers-reduced-motion` honored — verified by toggling OS setting in test.
- [ ] Keyboard contract: every action ≤2 keystrokes, focus visible, tab order correct.
- [ ] WCAG 2.2 AA contrast verified (axe-core or Stark in CI).
- [ ] No icon-only buttons missing aria-label.
- [ ] Indian rupee numbers use `Intl.NumberFormat("en-IN")` and `Paise` integers.
- [ ] Devanagari/Gujarati strings render with correct line-height multiplier (visual test if i18n hot in scope).
- [ ] Trust signals from §10 visible on owner-facing screens.
- [ ] No anti-patterns from §14.
- [ ] Vitest + React Testing Library coverage on new components (matching existing standard).
- [ ] Cold start <3s and per-screen p95 interaction <250ms verified on perf harness.
- [ ] Bundle increase ≤25 KB gz per non-trivial screen, justified if more.

## 18. Research corpus (the 50+ sources synthesized, snapshot Apr 27, 2026)

**Aesthetic & layout:**
- Bento grid in 67% of top SaaS — Orbix, Landdding, SaaSFrame 2026 reports.
- Linear refresh — `linear.app/now/behind-the-latest-design-refresh` (Mar 2026).
- Stripe dashboard — Inter scale + sparklines + WCAG-derived tokens.
- Vercel Geist — `vercel.com/geist`, accessible high-contrast.
- Apple Liquid Glass — WWDC25 / iOS 26 / macOS Tahoe; translucency = hierarchy.
- Material 3 Expressive — m3.material.io, spring-physics motion.
- Awwwards 2026 — interactive demos > illustrations for SaaS conversion.

**Color & culture:**
- Pharmacy green = healing/growth/pharmacy-cross convention (Pinnacle Life Science, Munsell).
- Indian color symbolism — saffron (sacred, auspicious), green (prosperity, harmony), white (purity but mourning), red (vitality but danger), blue (Krishna, calm). Color-Meanings, Sensational Color, Karmik Koncepts.
- Healthcare apps overuse blue (60%) — opportunity to differentiate. Eleken, Naskay 2026.
- WCAG 2.2 AA contrast 4.5:1 / 3:1; AAA 7:1.

**Customer psychology:**
- 98.5% Indian consumers prefer brick-and-mortar pharmacy (counterfeit anxiety) — TandFonline, ScienceDirect 2024-25.
- Trust signals: clinician credentials, real photography, transparent metadata, error-tolerant UX. Sprypt, Phenomenon.
- Cognitive Load Theory (Sweller): chunking, progressive disclosure, role-based views. Aufait UX, NN/g.

**Density & data:**
- Tufte sparklines — `edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/`.
- Donut charts ≤5 categories. Toucan Toco, Ajelix.
- KPI = number + trend + sparkline (Stripe canonical).

**POS & cashier:**
- Cashier tap-speed 2× normal, ergonomic key feedback, smart shortcuts. Creative Navy POS Design Guide, Microsoft D365 Commerce.
- Hick's Law (≤7 nav choices), Fitts's Law (size + distance). Laws of UX.

**Motion & micro:**
- Spring tokens (stiffness/damping/mass) — Motion v12 docs, Material 3 Expressive.
- View Transitions API prod-ready 2026 — webkit.org Interop 2026.
- Microinteractions improve retention 23% — Reinteractive 2026.

**Typography & i18n:**
- Inter for Latin, Mukta for Devanagari (used by Lokmat). Adobe Fonts, Google Fonts India.
- Hindi line-height ×1.1 — IndiaFont best practices.
- `Intl.NumberFormat("en-IN")` for lakh/crore — MDN.

**Tech stack:**
- shadcn/ui Tailwind 4 + Radix, OKLCH colors, RTL Jan 2026.
- cmdk by Vercel — Linear/Notion/Figma/Raycast use it.
- Tauri 2 + React 19 + TypeScript template — Kitlib.

**Older-adult accessibility:**
- 16px min body, 44×44px touch, simplified nav. JMIR mHealth, Toptal, NCBI PMC12350549.

## 19. Living-doc rules

- Update this doc on every approved design decision via PR.
- Major changes (a new motion law, new color, banned-list edit) require an ADR (`docs/adr/NNN-design-*.md`) referencing v1.0+.
- Quarterly review: walk every shipped screen against §13 and §17. Flag drift. Open issues.
- Memory-pin file `north_star_design_system.md` keeps `name`, `description`, and last-reviewed date current.

## 20. The bar

> Open the desktop app on first launch in a Mumbai pharmacy in Apr 2027. The owner — 38, Marathi/Hindi speaker, smartphone-native, Marg-veteran — should pause for two seconds. Not because something is wrong. Because something is right in a way they have never seen in pharmacy software. The dashboard breathes. The numbers feel inevitable. Their license number is up there. Saffron glints on the "GSTR-1 ready" chip. A sparkline tells them today is 12% above average. They press Ctrl+K, find a customer in 200 ms, the bill renders before their finger leaves the key, the print spools, the stock decrements, the IRN submits, the state-success pulse fades. They smile. They tell their wife at dinner.
>
> That is the bar. Anything less, we re-do.

— END NORTH STAR v1.0 —
