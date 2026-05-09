# ADR-0074 — i18n rollout: Marathi default, fallback chain mr → hi → en, dictionary versioning, machine-translation debt

- **Status:** Accepted
- **Date:** 2026-05-08
- **Sprint:** S28-B2 (Day 1 of the May 13 compression)
- **Decider:** Sourav Shaw

## Context

The first pilot shop is **Vaidyanath Pharmacy in Kalyan** (Q-007 default Marathi). PharmaCare Pro is owner-and-cashier-facing software running an Indian retail pharmacy register; the operator's preferred language **must** be available before May 13 cutover. Per `PROJECT_INSTRUCTIONS.md` §1.7 "Hi/Mr/Gu first" is a hard rule, and §9 places regional vernacular ahead of English in GTM language priority.

The codebase has carried a sparse `@pharmacare/design-system` i18n module since the visual recovery sprint, but only the navigation rail, a chunk of the dashboard, and a few command-palette strings actually consumed it. Most screens still hardcode English copy. The previous default locale was `en` — wrong for the pilot market.

The follow-up question is what to do about pharma-vocabulary translation quality: the founder is sourcing a human translator for Hindi + Marathi pharma terms (Q-010), but the translator's deliverables will not arrive before May 13. We must ship something the day-1 cashier can read while not pretending the in-house translation is editor-quality.

## Decision

1. **Default locale flips to `mr`** (Marathi). Migration `0051_shops_locale.sql` adds a `locale` column with `DEFAULT 'mr'` to the `shops` table. The frontend bootstrap (`apps/desktop/src/main.tsx`) reads from `localStorage` first for cold-start speed, then reconciles against `shops.locale` on first idle via `getLocaleRpc`.

2. **Fallback chain is `mr → hi → en`, not `mr → en`.** Hindi is far closer to Marathi than English in pharmacy register vocabulary; an unfilled Marathi key falls to Hindi before falling to English so a missing translation never reads as "Save" when "सेव्ह"/"सेव" would be intelligible.

3. **Dictionaries live in TypeScript, not JSON.** The `packages/design-system/src/i18n/{en,hi,mr}.ts` files use `as const` so the canonical key set is type-checked at compile time — adding a key to `en.ts` without mirroring it in `hi.ts` and `mr.ts` is caught by `pnpm typecheck` long before runtime. JSON exports are deferred (no consumer needs them; print template uses `t()` directly via the design-system shim).

4. **Locale switching is two-tier:** instant client-side (i18next changes language + `localStorage.setItem('pc-locale', loc)`) plus a fire-and-forget `set_locale` Tauri command that persists the choice to `shops.locale`. The persisted value is authoritative across reinstalls; `localStorage` is the cheap-read cache.

5. **Numbers stay `en-IN` regardless of UI locale.** The lakh/crore convention is Indian-English by tradition (NS §16); rendering "₹1,23,456" makes more sense to a Marathi speaker than "₹१,२३,४५६" because the numerals on every other invoice they handle are in Latin script.

6. **Devanagari content gets a `.pc-devanagari` class on `<html>`** when locale is `hi` or `mr`. The class hooks into the design-system stylesheet for a 1.1× line-height bump because Devanagari conjuncts are taller than Latin glyphs at the same font-size.

7. **Machine-translated strings carry an inline marker.** The S28-B2 batch shipped ~150 keys per locale; the ones that came from the founder's first-pass translation pad are honest pharma register and ship as-is, but any subsequent batch that goes through automated translation MUST be flagged `[MACHINE-TRANSLATED — human-rev Q-010]` in a comment beside the key, so the human translator can prioritise on review. Q-010 (USER_INPUT_QUEUE.md) tracks the deliverable.

## Why not these alternatives

- **`en` as default with `i18n` consent in onboarding wizard.** Rejected: every Marathi-mother-tongue cashier we've shadowed reads English haltingly; a default-English first-run is hostile, and the wizard cannot run before the locale switches because the wizard itself wants Marathi labels.
- **Punjabi / Gujarati at Day-1.** Deferred: pilot shop is in Kalyan; Pa/Gu come online when we onboard the second pilot. Hindi is added at Day-1 alongside Marathi because the support hotline operates in Hindi and the founder's first-degree network of pharmacist contacts speaks Hindi.
- **JSON dictionaries via i18next-http-backend / namespace splitting.** Premature: 86 packages, single Tauri binary, ~150 keys; the `as const` TS pattern compiles down to a single import and wins on type-safety for free.
- **Dropping the print template Hi/Mr branches for May 13.** Rejected — but **partially deferred**: the print template (`packages/invoice-print`) will read locale via `getLocale()` and render shop-name + headers in the active locale; full per-line HSN/qty/total localisation is deferred to the post-pilot iteration backlog because `index.test.ts` baselines were written against English literals and re-baselining without the human-translator deliverable would lock in machine-quality strings to the test fixtures.

## Consequences

**Positive:**

- Day-1 cashier reads Marathi labels on every screen they touch (Billing, Returns, Reorder, Settings, Dashboard, AppShell nav).
- Type-checked dictionary completeness (`pnpm --filter @pharmacare/design-system test` runs `dicts_completeness.test.ts`).
- Owner can flip `en` / `हिन्दी` / `मराठी` from Settings any time without restarting the app.
- DB migration is forward-only and safe; the `DEFAULT 'mr'` covers existing rows on upgrade.

**Negative:**

- The first pass of Hindi/Marathi translations is in-house and not register-perfect. Q-010 deliverable will require a re-pass and a `[MACHINE-TRANSLATED]` audit before the second pilot.
- Print template is partially localised at Day-1 — the body lines still read English HSN/qty/total. Roadmap captures full template localisation as a Day-7 follow-up.
- ESLint rule banning hardcoded JSX strings is **not** enforced repo-wide — too noisy for the ~40 screens that haven't been touched yet. Spot-checks via grep + the visible screens migrated under S28-B2 are the deliverable.

## Rollback

If a locale change causes a P0 (e.g. an interpolation crash on a non-`en` key), the in-place mitigation is `setLocale('en')` from the React DevTools console, which writes through to `localStorage` and `shops.locale`. The migration itself is not rolled back; `locale` is `NOT NULL DEFAULT 'mr'` and never queried by Rust code that would crash if absent — rolling back the migration is unnecessary.

## Future work (post-May 13)

- Q-010 — accept human-translator deliverable, re-base machine-translated keys.
- Punjabi (`pa`) + Gujarati (`gu`) locales + UI for second pilot.
- Print template full Hi/Mr localisation including line items (will require re-baselining `packages/invoice-print/src/index.test.ts` fixtures).
- ESLint `i18next/no-literal-string` enforced on new code (`apps/desktop/src/components/`) once back-fill is complete.
- Right-to-left tested if/when Urdu becomes a target locale.

## References

- `packages/design-system/src/i18n/{en,hi,mr,index}.ts` — canonical dictionary + bootstrap.
- `packages/shared-db/migrations/0051_shops_locale.sql` — `shops.locale` column.
- `apps/desktop/src-tauri/src/locale.rs` — `get_locale` + `set_locale` Tauri commands.
- `apps/desktop/src/components/SettingsScreen.tsx` — locale dropdown.
- USER_INPUT_QUEUE Q-007 (default locale) + Q-010 (translator deliverables).
- PROJECT_INSTRUCTIONS §1.7 + §9 — Hi/Mr/Gu first hard rule.
- NORTH_STAR §16 — number formatting stays en-IN.
