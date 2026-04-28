# ADR 0029 — Design North Star v1.0 ratified as rank-2 source of truth

**Date:** 2026-04-27
**Status:** Accepted
**Decider:** Sourav Shaw, founder
**Authority rank:** Rank-2 (below `PharmaCare_Pro_Build_Playbook_v2.0_Final.docx`, above all other docs and prior ADRs).

## Context

The shipped desktop UI as of `0d428be` ships ~12,600 LOC of correct, tested React/TS over 20 packages — but the visual surface is `apps/desktop/src/styles.css` (18 lines), raw HTML tables, no design system, no motion, no iconography, no charts, no command palette. Owner home is `BillingScreen` rather than a dashboard. Three moats (X1 Gmail-inbox, X2 SKU images, X3 photo-bill GRN) ship functionally but visually indistinguishable from any 2015 admin form.

This conflicts with v2.0 Playbook §0 ("redefine the category, not race Marg on features") and §13 ("PharmaCare Pro is the pharmacy software India deserves"). The visual gap is the largest single threat to pilot day-1 perception and pre-seed narrative.

The remediation requires a written, binding visual/motion/interaction law that every future PR must comply with, that survives session resets, and that no contributor can drift away from without explicit re-ratification.

## Decision

We adopt `docs/design/NORTH_STAR.md` v1.0 as the canonical design law. Specifically:

1. **Aesthetic identity:** pharmacy-green (`#0F6E56`) primary + saffron (`#EF9F27`) accent + warm-white canvas + Inter/Mukta type stack + spring-physics motion. Inspirations: Linear (calm), Stripe (sparkline density), Geist (contrast), Liquid Glass (translucency-as-hierarchy), Material 3 Expressive (motion).
2. **Twelve binding design laws** (calm-by-default, spring-physics, keyboard-wins, density-where-expected, color-encodes-meaning, trust>speed>beauty>novelty, dark+light first-class, INR as first-class type, Indic typography first-class, four-states-mandatory, reduced-motion-honored, compliance-always-visible).
3. **Tech stack locked:** Tailwind 4 + shadcn/ui + Radix + Lucide + Motion v12 + Recharts + cmdk + i18next + TanStack Table/Query + Zustand. Mobile: Expo + Reanimated 3. Web: Next.js 15.
4. **Per-screen briefs** for Dashboard, Billing, GRN, Inventory, Returns, Reports, Gmail-Inbox (X1), Product Master (X2), Photo-bill (X3), Settings, Compliance Dashboard.
5. **Definition of Design-Done checklist** (§17 of north star) — every UI PR must satisfy all 18 boxes before merge. CI will gate axe-core contrast and reduced-motion tests.
6. **The bar (§20):** the felt experience target on first launch in a real Mumbai pharmacy.

## Consequences

**Positive:**
- Single, explicit source of truth eliminates "is this the right green?" debates.
- Future Claude/contractor sessions load this doc on entry → no design drift across sessions.
- Pilot day-1 surface matches pre-seed narrative.
- Moats become visible: X1/X2/X3 panels on Dashboard surface what's already built.

**Negative / costs:**
- Approximately 4 sprint-weeks redesign work (P1-P4 per recovery plan) before pilot Day-1.
- All 12 existing screens require re-skin (logic untouched, surface replaced).
- New dependencies (Tailwind 4, shadcn, Motion, Recharts, cmdk, Lucide, i18next) added — bundle and install size grow; mitigated by lazy-loading and code-splitting.
- Existing Vitest snapshots invalidated; need fresh snapshots and visual regression tests.

**Mitigations:**
- Keyboard contract preserved 1:1 — owner muscle memory unbroken.
- Engine code untouched: GST engine, Schedule H gates, FEFO, Gmail bridge, photo-grn, e-invoice, returns, GSTR-1 — all stay. Surface only.
- Each new component lands with Vitest + RTL coverage matching current standard.
- Cold-start <3s and p95 <250ms perf gates retained.

## Alternatives considered

1. **Defer redesign until post-pilot.** Rejected: pilot day-1 is the moment of truth; we cannot demonstrate "category-defining" with Marg-tier visuals.
2. **Hire an external design agency.** Rejected at this stage: cost, timeline, and the founder's product vision are tightly coupled. Once north-star is locked, agency hire becomes feasible for illustration/marketing surfaces.
3. **Use a generic admin template (Tabler/AdminLTE).** Rejected: instant "WordPress-tier" tell; defeats §3 anti-clone rule.
4. **Keep current visuals + add motion.** Rejected: can't paint over a missing color system, missing icons, missing skeletons, missing dashboard.

## Supersedes / superseded-by

- **Supersedes:** any prior implicit visual judgment in shipped screens.
- **Superseded by:** future ADRs (0030+) that revise specific north-star sections must reference v1.0 explicitly.

## Compliance check

Every UI PR must paste the §17 checklist into the PR body, all 18 boxes ticked.

## References

- `docs/design/NORTH_STAR.md` v1.0
- `PharmaCare_Pro_Build_Playbook_v2.0_Final.docx` §0, §3, §13
- ADR-0009 (A5 keyboard navigation) — kept; aliases preserved
- ADR-0014 (A9 hidden-iframe print) — kept; will be re-skinned only
- Research corpus: §18 of north star (50+ sources, snapshot Apr 27, 2026)
