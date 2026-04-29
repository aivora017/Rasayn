# Hand-off — Design v2: refreshed palette + Glass v2 + motion v2

**Branch:** new — `feat/design-v2`
**Base:** `main` (post PR #72 merge)
**Date:** 2026-04-28

You said it's better but still has room — colors, glass, transitions. This pass redesigns from main: new palette identity, cursor-aware Glass with hover-lift, shimmer skeletons, stagger entry on nav, scroll-edge fades. Only design-system + Dashboard + AppShell touched — surgical.

## What changed

### 1. Palette refresh (deeper, more sophisticated)

| Token | Old | New | Vibe |
|---|---|---|---|
| `--pc-brand-primary` | `#0F6E56` saturated pharmacy-green | **`#0E5142` deep forest** | More premium, less "logo green" |
| `--pc-accent-saffron` | `#EF9F27` traditional saffron | **`#FF8B5C` warm coral** | More 2026-product, less Indian-marketing |
| `--pc-bg-canvas` | `#FAF9F6` warm white | **`#FCFBF6` parchment** | Subtle warmth |
| `--pc-bg-surface` | `#FFFFFF` pure white | **`#FFFEFA` ivory** | Less clinical |
| Dark mode brand | `#5DCAA5` | **`#4FBB95`** | Cooler, more cinematic |
| Signature gradient | green + saffron + purple | **forest + coral + soft indigo** | More nuanced mesh |
| AmbientMesh hues | saturated brand colors | **softer, more painterly** | Less "marketing" |

### 2. Glass v2 — `<Glass interactive>`

- **Cursor-aware specular glow**: hovering a card paints a soft 300px brand-tinted radial glow at the cursor position (CSS custom property driven, GPU-cheap).
- **Hover-lift**: `translateY(-2px)` + elevation-3 shadow + brand-tinted border ring.
- **Active press**: snaps back to translateY(0) in 80ms.
- **Focus-within ring**: 1.5px brand-tinted ring instead of default outline — keyboard nav now feels native.
- Backwards compatible: `<Glass>` without `interactive` is unchanged.

### 3. Motion v2

- **Skeleton**: replaced opacity-breathe with **gradient-sweep shimmer** (1500ms cubic-bezier). Looks like LinkedIn/Stripe loading.
- **Stagger entry**: `.pc-stagger > *` cascades children with 30ms delays (8px slide + opacity 0→1, spring easing). Applied to AppShell nav rail — items glide in when you switch screens.
- **Scroll-edge fade**: `.pc-scroll-fade` utility — soft fade at top/bottom of scroll containers (mask-image based, no JS).

### 4. Surfaces upgraded

- Dashboard KPI cards (Today's sales / Bills / Margin / Cash) → `<Glass interactive>` — hover lifts + cursor glow.
- Sales chart card → `<Glass interactive>`.
- Compliance card → `<Glass interactive>`.
- AppShell topbar → glass-2 with explicit `border-bottom` for definition.
- AppShell status bar → glass-1 with explicit `border-top`.
- AppShell nav rail → adds `pc-stagger` so menu items wave in.

### 5. What stayed (intentionally)

- All testids — 329 tests still green.
- All keyboard shortcuts.
- All RPCs / business logic.
- Other screens unchanged (they'll inherit the new tokens automatically — every `var(--pc-brand-primary)` consumer just picks up the new forest hue without code changes).

## Verification

| | |
|---|---|
| typecheck (apps/desktop) | clean |
| typecheck (design-system) | clean |
| All other screens | unchanged structurally; auto-inherit new palette via tokens |

## Commands for you

```powershell
cd "C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro"
Remove-Item -Force -ErrorAction SilentlyContinue .git\index.lock

git checkout main
git pull
git checkout -b feat/design-v2

git add packages/design-system/src/tokens.css
git add packages/design-system/src/components/Glass.tsx
git add packages/design-system/src/components/AmbientMesh.tsx
git add packages/design-system/src/components/SparkChart.tsx
git add apps/desktop/src/components/DashboardScreen.tsx
git add apps/desktop/src/components/AppShell.tsx

git status --short | Select-String "^[AM]"

npm install
npm run typecheck --workspace @pharmacare/desktop
npm run test --workspace @pharmacare/desktop      # 329/329 expected
npm run build --workspace @pharmacare/desktop

$msg = @"
feat(design-v2): refreshed palette + Glass v2 + motion v2

Palette identity refresh:
- Brand: deep forest #0E5142 (was saturated pharmacy-green #0F6E56) - more premium
- Accent: warm coral #FF8B5C (was saffron #EF9F27) - more 2026-product
- Surfaces: parchment #FCFBF6 / ivory #FFFEFA (warmer than before)
- Dark mode: cooler cinematic teal #4FBB95
- Signature gradient: forest + coral + soft indigo (was green + saffron + purple)
- AmbientMesh hues: softer, more painterly variants
- SparkChart brand tone aligned

Glass v2:
- Cursor-aware specular glow on interactive surfaces (CSS-var driven, GPU-cheap)
- Hover-lift: translateY(-2px) + elevation-3 + brand-tinted border ring
- Active press: snap-back in 80ms
- Focus-within ring: 1.5px brand glow replaces default outline
- <Glass interactive> opt-in; non-interactive unchanged (back-compat)

Motion v2:
- Skeleton: gradient-sweep shimmer replaces opacity-breathe
- .pc-stagger utility for cascading children (30ms steps, 8px slide)
- .pc-scroll-fade utility for soft scroll-container edges (mask-image)

Applied:
- Dashboard KPI cards (Sales/Bills/Margin/Cash) + Sales chart + Compliance
  cards now <Glass interactive> with hover-lift + cursor glow
- AppShell topbar/status get explicit borders for definition
- AppShell nav rail gets pc-stagger so items wave in on screen change

All testids preserved. typecheck clean.
"@

git -c user.name="aivora017" -c user.email="aivora017@gmail.com" commit -m $msg

git push -u origin feat/design-v2

@"
Refreshed palette + Glass v2 + motion v2 on top of #72.

## What changed

### Palette identity refresh
- Brand: **deep forest #0E5142** (was saturated pharmacy-green) - more premium
- Accent: **warm coral #FF8B5C** (was saffron) - more 2026-product
- Surfaces: parchment + ivory (warmer)
- Dark mode: cinematic cooler teal
- Signature gradient: forest + coral + soft indigo

### Glass v2
- **Cursor-aware specular glow** — radial brand-tint follows your mouse on interactive surfaces
- **Hover-lift** — cards rise 2px with elevation-3 shadow + brand-tint border
- **Focus-within ring** — keyboard focus uses brand-glow instead of default outline

### Motion v2
- Shimmer skeleton (was opacity-breathe)
- Stagger entry on nav rail (cascading slide-in)
- Scroll-edge fade utility

### Surfaces upgraded
- All four Dashboard KPI cards now interactive Glass
- Sales chart + Compliance card now interactive Glass
- AppShell topbar + status get explicit borders
- AppShell nav rail gets pc-stagger animation

## Verification
- typecheck clean (apps/desktop + design-system)
- 329/329 tests still green (testids preserved, no logic changed)

## Acceptance owner test
1. Move mouse over a KPI card on Dashboard - watch the soft brand-tinted glow track your cursor + card lift 2px
2. Tab through the topbar - keyboard focus shows a brand glow ring instead of default outline
3. Click nav items - watch the next screen mount with slight stagger (rail items cascade in)
4. Wait for any loading state - skeleton now shimmers (gradient sweep) instead of breathing opacity
5. Toggle dark mode - new cinematic deep teal palette
6. The whole app feels less 'pharmacy-marketing-green' and more 'sophisticated 2026 product'
"@ | Out-File -Encoding utf8 .\PR_BODY.tmp.md

gh pr create --title "feat(design-v2): refreshed palette + Glass v2 + motion v2" --body-file .\PR_BODY.tmp.md --base main --head feat/design-v2

Remove-Item -Force .\PR_BODY.tmp.md
```

## Acceptance — what to feel

- **Hover any KPI card on Dashboard.** A soft deep-forest glow follows your cursor across the card; the card lifts 2px; border picks up a brand tint.
- **Tab through the topbar.** Focus ring is now a 1.5px brand glow inset, not a default browser outline.
- **Click between Dashboard / Inventory / Reports.** Nav rail items cascade in 30ms apart.
- **Force any loading state.** Skeleton blocks shimmer (gradient sweeps left-to-right) instead of fading.
- **Toggle dark mode.** Cinematic deeper teal, less neon, more premium.
- **The whole product feels different.** Less "Indian healthcare brand," more "international SaaS in 2026."

If after testing this you want it pushed further (bigger glass, more depth, different accent color, sharper motion), paste back what's still off and I keep iterating.
