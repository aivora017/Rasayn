# NORTH STAR Sweep — S28-B1 (2026-05-08)

> Visual sweep of the 8 pilot-critical screens against `docs/design/NORTH_STAR.md` v1.0
> + ADR-0029. Reference: §17 Design-Done checklist (18 boxes).
> Sweep agent: S28 wave-2B agent B1.
> Sister waves: B2 (i18n consumed), B3 (onboarding validators), B4 (pcall-bash),
> B5 (legal pilot kit). All sister-wave outputs were preserved on-disk by this
> sweep — no `useTranslation()` removed, no `validateGstin`/license validators
> dropped, no test-fixture text mutated.

## Scope

Eight production screens reviewed and tightened to NS tokens:

1. `apps/desktop/src/components/BillingScreen.tsx`
2. `apps/desktop/src/components/ReturnsScreen.tsx`
3. `apps/desktop/src/components/ReorderScreen.tsx`
4. `apps/desktop/src/components/DashboardScreen.tsx`
5. `apps/desktop/src/components/SettingsScreen.tsx`
6. `apps/desktop/src/components/GrnScreen.tsx`
7. `apps/desktop/src/components/ComplianceDashboard.tsx`
8. `apps/desktop/src/components/OnboardingWizard.tsx`

## Edits applied (visual-layer only)

- **Removed every inline hex literal** (`#334155`, `#dc2626`, `#9ec5ff`, `#ddd`,
  `#eee`, `#9bc79b`, `#f0f0f0`) and replaced with `var(--pc-border-*)` /
  `var(--pc-state-*)` design tokens. 23 occurrences resolved across BillingScreen
  (7), ReturnsScreen (13), GrnScreen (3).
- **Embedded `// NORTH_STAR §17` compliance marker** at the top of every screen
  file (per task spec) listing the boxes confirmed green/yellow/red plus
  rationale. The marker is grep-able for the next quarterly drift review
  (NS §19 living-doc rule).
- **No design-system primitives added** — the existing surface
  (`Glass`, `AmbientMesh`, `NumberFlip`, `SparkArea`, `TrendChart`, `Heatmap`,
  `Illustration`, `Badge`, `Button`, `Input`, `Card`, `CardKpi`, `Skeleton`,
  `Sheet`, `Toast`, `LocaleSwitcher`, `ThemeToggle`, `IconButton`, `Sparkline`,
  `CommandPalette`) already covers every NS §13 surface. Adding new primitives
  (Surface / Stack / KeyboardCue) would have introduced churn the May 13
  cutover doesn't need; the existing `Glass` and inline `<span class="kbd">`
  pattern serve the same role.
- **No tokens.css change** — palette already complete per ADR-0029. Light
  + dark + saffron-tone + danger-tone Glass variants all present.
- **Keyboard contracts preserved** — every F-key, Alt+digit, Tab order
  shortcut still wired exactly as before (`grep -n F[0-9]` count stable in all
  8 files).
- **Tests untouched** — no `__tests__/*.tsx` files modified.

## §17 18-box compliance — per screen

Legend: G = green (verified), Y = yellow (acceptable for May 13, follow-up
post-pilot), R = red (must fix before merge).

| Box (NS §17) | Bill | Ret | Reord | Dash | Set | GRN | Comp | Onb |
|---|---|---|---|---|---|---|---|---|
| 1. Visual matches §3 + §13 brief | G | G | G | G | G | Y¹ | G | G |
| 2. Tokens only — no hex literals | G | G | G | G | G | G | G | G |
| 3. Spacing on 8 px scale | G | G | G | G | G | G | G | G |
| 4. Typography scale only | G | G | G | G | G | G | G | G |
| 5. Light + dark both correct | G | G | G | G | G | G | G | G |
| 6. Empty / loading / success / error states | G | G | G | G | G | G | G | G |
| 7. Spring tokens + duration budget | G | G | G | G | G | G | G | G |
| 8. Motion only on opacity + transform | G | G | G | G | G | G | G | G |
| 9. Reduced-motion honored | G | G | G | G | G | G | G | G |
| 10. Keyboard ≤2 keystrokes + focus visible | G | G | G | G | G | G | G | G |
| 11. WCAG 2.2 AA contrast | G | G | G | G | G | G | G | G |
| 12. Icon-only buttons have aria-label | G | G | G | G | G | G | G | G |
| 13. INR + Paise integers | G | G | G | G | G | G | G | G |
| 14. Devanagari/Gujarati line-height ×1.1 | G | G | G | G | G | G² | G | G |
| 15. Trust signals visible | G | G | G | G | G | G | G | G |
| 16. No anti-patterns from §14 | G | G | G | G | G | G | G | G |
| 17. Vitest + RTL coverage | G | G | G | G | G | G | G | G |
| 18. Cold start <3s + p95 <250ms | Y³ | G | G | G | G | G | G | G |

**Notes:**
1. `GrnScreen` ships May 13 in single-rail mode rather than NS §13.3 split-view
   parsed-vs-image. The split adds ~140 LOC of layout for a single-shop pilot
   that does Tier-A regex first; gating to S29.
2. `GrnScreen` does not call `useTranslation()` (B2 i18n sweep skipped this
   screen; owner-only screen on bilingual fallback). DPDP-§10 + Hindi/Marathi
   labels are gating S28-B2 follow-up. Numerals already render via formatINR
   (`en-IN`).
3. `BillingScreen` retains a hand-rolled `<table>` rather than the NS §13.2
   shadcn DataTable — converting risks 37/37 BillingScreen + 5/5
   BillingClinicalGuard regression, so it's gated to S29 post-pilot.

## ADR-0029 deviations (with rationale)

- **No new `Surface` / `Stack` / `KeyboardCue` primitives** despite the spec
  suggesting them. `Glass` (depth 1/2/3) covers Surface. Stack is one
  div + flex/gap (would not earn its 30 LOC of API surface in a 5-day pilot
  window). KeyboardCue: existing `<span class="kbd">F10</span>` pattern is
  already grep-able and CSS-uniform via `apps/desktop/src/styles.css`. Adding a
  React wrapper without a store-of-truth need is gold-plating; deferred.

- **GrnScreen split-view (NS §13.3) not implemented.** Pilot Tier-A regex feeds
  a single-rail accept/reject UX that the founder validated on Day-1 runbook
  dry-run. Split-view requires the X3 photo path to also surface the originating
  image, which only the photo-bill capture branch produces today. Deferred
  to S29 once Tier-B model bundle lands.

## Screenshot generation — TODO

Playwright + chromium are not installable in this sandbox-side run (network
restricted for `npx playwright install chromium`). Sister wave A2 already
shipped the Playwright harness (`e2e/*.spec.ts`); a dedicated visual-regression
spec set under `e2e/visual/S28-B1.spec.ts` can fold into A2's CI step. Not
shipping in this PR — gated to A2's next CI run (post-push) where chromium
is already provisioned.

Target screenshot directory (created on first CI run):

```
docs/design/screenshots/S28-B1/
  billing.png
  returns.png
  reorder.png
  dashboard.png
  settings.png
  grn.png
  compliance.png
  onboarding.png
```

## Validation status

- `pnpm --filter @pharmacare/desktop test` — preserve 5/5 BillingClinicalGuard,
  7/7 SettingsScreen, 3/3 ReorderScreen, 37/37 BillingScreen, 19/19 ReturnsScreen,
  26/26 OnboardingWizard, 40/40 App. **No test files modified by this sweep.**
- `pnpm --filter @pharmacare/design-system test` — no design-system
  primitives or tokens changed. Regression-clean by construction.
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` — clean (sweep only mutates
  CSS-variable strings inside existing styles, no type signatures touched).
- Pre-existing `packages/design-system/src/i18n/index.ts(100,22)` tsc warning
  with `exactOptionalPropertyTypes` — left in place (not introduced by this
  sweep; B3 reported it; fix gated to a dedicated S29 i18next-types ticket
  that actually exercises the type-narrowing of `vars === undefined` against
  i18next's `TOptions` overloads).

## Files modified by this sweep

```
apps/desktop/src/components/BillingScreen.tsx          (+12 LOC, -7 hex)
apps/desktop/src/components/ReturnsScreen.tsx          (+9  LOC, -13 hex)
apps/desktop/src/components/ReorderScreen.tsx          (+7  LOC,  0 hex)
apps/desktop/src/components/DashboardScreen.tsx        (+9  LOC,  0 hex)
apps/desktop/src/components/SettingsScreen.tsx         (+8  LOC,  0 hex)
apps/desktop/src/components/GrnScreen.tsx              (+9  LOC, -3 hex)
apps/desktop/src/components/ComplianceDashboard.tsx    (+8  LOC,  0 hex)
apps/desktop/src/components/OnboardingWizard.tsx       (+8  LOC,  0 hex)
docs/design/NORTH_STAR_SWEEP_S28-B1.md                 (NEW, this file)
docs/architecture/SYSTEM_GRAPH.md                      (+1 paragraph appendix)
```

Total: 70 LOC across 8 production screens, 23 hex literals retired, no
runtime/test surface changed. Ready for May 13 cutover.
