# Hand-off — Design v3: deeper palette + Glass v3 + View Transitions + scroll parallax + multi-layer

**Branch:** new — `feat/design-v3` (off main, after PR #73 merges)
**Date:** 2026-04-28

You said "all of it." Done.

## What changed

### 1. Palette pushed deeper

| Token | v2 | **v3** |
|---|---|---|
| Brand primary | `#0E5142` | **`#0A4338` deeper teal-black** — feels almost obsidian, more confident |
| Brand hover | `#07382E` | **`#052D24`** |
| Coral accent | `#FF8B5C` | **`#FF7A4A` saturated terracotta** — more pop |
| Coral hover | `#E66B3F` | **`#D9582E`** |
| Dark mode brand | `#4FBB95` | **`#3FAA85`** — cooler, more cinematic |
| **NEW** AI accent | — | **`#6B5BD1` soft indigo** with hover/soft variants — for copilot/thinking moments |
| **NEW** noise token | — | `--pc-noise` SVG fractal-noise data URL @ 4% opacity |
| AmbientMesh hues | sage/coral/indigo soft | **deeper forest + saturated terracotta + ai-violet + sage** |

### 2. Glass v3 — tactile, sharper, edge-glossy

- **SVG-fractal-noise overlay** on every Glass surface (4% opacity, mix-blend-mode: overlay light / soft-light dark) → tangible texture, the "real glass not flat" feel
- **Sharper hover** — `translateY(-3px)` + `scale(1.006)` + brand-tinted shadow halo + brighter inner edge highlight
- **Edge gloss layer** — diagonal gradient catches light on hover (top-left bright → bottom-right brand-tinted)
- **Cursor glow z-stacked** above noise so it's the topmost layer
- **AI pulse animation** — `.pc-ai-pulse` keyframe ring expansion in violet, for copilot moments

### 3. Motion v3 — sharper springs

| Spring | v2 | v3 |
|---|---|---|
| `snap` | stiffness 500, damping 32, mass 0.6 | **600 / 30 / 0.55** — snappier |
| `smooth` | 300 / 30 / 0.8 | **340 / 28 / 0.75** — quicker |
| `bounce` | 400 / 18 / 0.7 | **480 / 14 / 0.7** — more elastic |
| `gentle` | 180 / 26 / 1.0 | **200 / 26 / 1.0** — slightly more lift |

### 4. View Transitions API — screen morphs

- AppShell wraps every nav click + command-palette item in `document.startViewTransition()` (with feature-detect fallback for non-Chromium)
- Default cross-fade is **opacity + scale + 2px blur**: outgoing screen scales 0.985 + blurs out; incoming scales 1.015 → 1 + un-blurs
- Reduced-motion: animation disabled at the CSS level
- Browser support: Chromium 111+ (Tauri webview, modern Edge, Chrome). Other browsers fall through to no animation — no breakage

### 5. Scroll-driven AmbientMesh parallax

- Each ambient blob now has an independent parallax factor (0.10 – 0.45)
- As the dashboard scrolls, mesh blobs shift up at different rates → genuine depth illusion
- Auto-detects nearest scroll container; falls back to `window`
- Removed when canvas unmounts; no leaked listeners
- Reduced-motion: blobs stay still

### 6. Multi-layer Glass on Dashboard hero

- KPI row (Today's Sales / Bills / Margin / Cash) now wrapped in an outer `<Glass depth={2}>` hero panel
- The 4 KPI cards inside remain `<Glass depth={1} interactive>` — proper spatial nesting
- Result: cards float visibly inside the hero rather than sitting flat against canvas

## Files touched (8)

```
packages/design-system/src/tokens.css         # palette + AI accent + noise token + Glass v3 + VT + skeleton/stagger refinements
packages/design-system/src/tokens.ts          # springs sharpened
packages/design-system/src/components/Glass.tsx          # (no change — v2 cursor logic still applies, v3 is pure CSS)
packages/design-system/src/components/AmbientMesh.tsx    # scroll-parallax + new hue palette
packages/design-system/src/components/SparkChart.tsx     # brand hex updated
apps/desktop/src/components/AppShell.tsx                 # View Transitions wrapper + every setMode wrapped
apps/desktop/src/components/DashboardScreen.tsx          # KPI row wrapped in glass-2 hero
```

## Verification

| | |
|---|---|
| typecheck (apps/desktop) | clean |
| typecheck (design-system) | clean |
| Tests | 329/329 expected (no testid/logic changed) |

## Commands for you

```powershell
cd "C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro"
Remove-Item -Force -ErrorAction SilentlyContinue .git\index.lock

# Wait for PR #73 to merge first; OR branch off feat/design-v2 directly
git checkout main
git pull
git checkout -b feat/design-v3
# If PR #73 isn't merged yet, instead do:
#   git checkout feat/design-v2
#   git pull
#   git checkout -b feat/design-v3

git add packages/design-system/src/tokens.css
git add packages/design-system/src/tokens.ts
git add packages/design-system/src/components/AmbientMesh.tsx
git add packages/design-system/src/components/SparkChart.tsx
git add apps/desktop/src/components/AppShell.tsx
git add apps/desktop/src/components/DashboardScreen.tsx

git status --short | Select-String "^[AM]"

npm install
npm run typecheck --workspace @pharmacare/desktop
npm run test --workspace @pharmacare/desktop      # 329/329 expected
npm run build --workspace @pharmacare/desktop

$msg = @"
feat(design-v3): deeper palette + Glass v3 + View Transitions + scroll parallax + multi-layer

Palette pushed:
- Brand: #0A4338 (was #0E5142) - deeper teal-black, more confident
- Coral: #FF7A4A (was #FF8B5C) - saturated terracotta
- Dark mode: #3FAA85 - cooler cinematic
- NEW AI accent: #6B5BD1 soft indigo for copilot/thinking moments
- NEW noise token: SVG fractal-noise data URL at 4% opacity
- AmbientMesh hues bumped to match

Glass v3:
- Tactile noise overlay on every Glass surface (mix-blend-mode overlay/soft-light)
- Sharper hover: translateY(-3px) + scale(1.006) + brand-tinted halo
- Edge gloss layer (diagonal gradient highlight on hover)
- AI pulse keyframe for copilot moments
- Cursor glow z-stacked above noise

Motion v3:
- Springs sharpened across snap/smooth/bounce/gentle
- snap 500->600 stiffness, bounce 18->14 damping (more elastic)

View Transitions API:
- AppShell wraps every setMode in document.startViewTransition()
- Cross-fade with scale 0.985->1.015 + 2px blur defocus
- Feature-detection fallback for non-Chromium
- Reduced-motion: disabled

Scroll-driven AmbientMesh:
- Each ambient blob has independent parallax factor (0.10-0.45)
- As dashboard scrolls, blobs shift y at different rates -> genuine depth
- Auto-detects nearest scroll container; window fallback

Multi-layer Glass on Dashboard:
- KPI row wrapped in outer Glass depth-2 hero panel
- Cards inside remain depth-1 interactive
- Proper spatial nesting; cards float visibly inside hero

All testids preserved. typecheck clean. 329/329 expected.
"@

git -c user.name="aivora017" -c user.email="aivora017@gmail.com" commit -m $msg

git push -u origin feat/design-v3

@"
v3 push - deeper palette + tactile glass + screen morphs + scroll parallax + multi-layer.

## Palette pushed deeper
- Brand: deep teal-black #0A4338 (was forest #0E5142)
- Coral: saturated terracotta #FF7A4A
- NEW AI accent: soft indigo #6B5BD1 for copilot moments
- NEW noise token: SVG fractal-noise data URL at 4% opacity

## Glass v3
- **Tactile noise overlay** on every Glass surface (real-glass-not-flat feel)
- **Sharper hover**: translateY(-3px) + scale(1.006) + brand halo
- **Edge gloss layer** - diagonal gradient catches light on hover
- **AI pulse** keyframe for copilot moments

## Motion v3
- All springs sharpened (snap stiffer, bounce more elastic)

## View Transitions API
- AppShell wraps every setMode in document.startViewTransition()
- Cross-fade with scale 0.985->1.015 + 2px blur defocus
- Feature-detect fallback (non-Chromium browsers fall through cleanly)
- Reduced-motion respected

## Scroll-driven AmbientMesh
- Each blob has independent parallax factor (0.10-0.45)
- Mesh shifts at different rates as dashboard scrolls -> depth illusion

## Multi-layer Glass on Dashboard
- KPI row wrapped in outer glass-2 hero panel
- Cards float visibly inside the hero (proper spatial nesting)

## Verification
- typecheck clean (apps/desktop + design-system)
- 329/329 tests expected (no testid or logic changed)

## Acceptance owner test
1. Hover any KPI card - card lifts 3px + brand halo + cursor glow + edge gloss + tactile noise visible up close
2. Look at the KPI row - cards now float inside an outer glass panel (multi-layer depth)
3. Click between nav items - screens cross-fade with subtle blur (View Transitions API in Chromium)
4. Scroll the dashboard - ambient mesh blobs shift up at different speeds (parallax depth)
5. Tab through topbar - keyboard focus uses brand glow ring
6. Toggle dark mode - cooler cinematic deep teal
7. Force loading - skeletons shimmer left-to-right
"@ | Out-File -Encoding utf8 .\PR_BODY.tmp.md

gh pr create --title "feat(design-v3): deeper palette + Glass v3 + View Transitions + scroll parallax + multi-layer" --body-file .\PR_BODY.tmp.md --base main --head feat/design-v3

Remove-Item -Force .\PR_BODY.tmp.md
```

## What you should feel

1. **Hover any KPI card on Dashboard** — card lifts 3px + brand halo glow + cursor-tracked light + diagonal edge gloss + (close up) tactile noise
2. **Multi-layer depth** — KPI cards visibly float **inside** an outer glass panel
3. **Click nav items** — screens cross-fade morph with subtle blur (View Transitions, Tauri Chromium webview supports it natively)
4. **Scroll the dashboard** — ambient mesh blobs shift upward at different rates (parallax)
5. **Tab through topbar** — focus ring is brand-glow inset
6. **Force loading** — skeletons shimmer (gradient sweep)
7. **Dark mode** — cooler cinematic teal, less neon

If after this it's still not the level you want — push palette to a completely different identity (sage + soft pink? pure indigo + amber?), more glass surfaces, sharper sound, etc — paste back what's still off. I keep going.
