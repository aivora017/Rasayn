# A5 — feat/a5-billing-shell · Handoff

Branch: `feat/a5-billing-shell`  (parent = `e9e19f2`, origin/main after PR #9)
Date:   2026-04-16 IST
Author: aivora017

## Scope landed

- Keyboard-first billing shell with F-key map F1/F2/F3/F4/F6/F10 per ADR 0004
  row A5 and ADR 0009.
- Nav-key migration across the whole desktop app: plain `F1`–`F11` → `Alt+1`–
  `Alt+9`. Plain F-keys now screen-local.
- Payment modal shell (testid + open/close/confirm contract; A8 fills in
  split-tender/card/UPI/change-calc).
- Always-visible customer bar at top of billing; single source of truth for
  the bill's customer. `rx-cust-*` testids renamed to `cust-*`.
- ADR 0008 helpers `retype` / `clickWhenEnabled` promoted to
  `apps/desktop/src/test/form-helpers.ts`. SettingsScreen test now imports
  from there.
- A11y pass on billing: landmarks, accessible names, listbox/option roles,
  aria-keyshortcuts, live region for toasts.

## Out of scope (explicit, per ADR 0009)

- Real payment modal body (split-tender, change calc, round-off wiring) —
  lands in A8.
- `F9` on the GRN save handler stays until A10 forces a GRN contextual-key
  ADR.
- `bills` / `bill_lines` SQLite tables and the FEFO auto-pick persistence
  loop — A6.

## Acceptance — ADR 0004 row A5

| Criterion                                     | Result                                |
|-----------------------------------------------|---------------------------------------|
| Keyboard-only empty-bill in <2 s measured     | ✅ 12.65–15.69 ms (10 runs, see below) |
| Focus never lost to mouse                     | ✅ `F4` on empty bill is a no-op (test) |
| A11y audit clean                              | ✅ landmarks, accessible names, live region, aria-keyshortcuts |

## Tests

- `apps/desktop`: 61 tests pass (was 47; +14 A5-specific in `BillingScreen.test.tsx`).
- `packages/*`: 28 turbo tasks pass serial (`npx turbo run build test
  --concurrency=1`). batch-repo flakes only under parallel load; passes
  standalone and serial.
- `tsc --noEmit`: clean on `@pharmacare/desktop`.

### A5 key tests (in BillingScreen.test.tsx)

1. boots with product search focused — the keyboard entry point
2. shell perf gate — empty-bill-ready state settles in <2 s
3. F1 resets a dirty bill and returns focus to product search
4. F2 moves focus to the customer bar
5. F3 returns focus to the product search
6. F4 focuses the last-line discount input when lines exist
7. F4 is a no-op when no lines are present — focus never lost to mouse
8. F6 opens payment modal when saveable, Esc closes it
9. F6 with empty bill shows an error toast and does not open the modal
10. F10 saves the bill from the main screen and clears lines
11. F10 inside the payment modal saves and closes the modal
12. keyboard-only path: add line via typing + Enter, then F10 saves — no mouse
13. Alt+2 from billing switches to inventory (nav keys don't collide with billing F-keys)
14. a11y: billing region, customer listbox, Save button accessible name + shortcut

## Perf — empty-bill-ready (10 runs, Linux sandbox, Node 20.18.0, jsdom)

```
15.69, 13.02, 13.98, 13.30, 14.72, 12.65, 13.34, 13.18, 14.53, 14.21  (ms)
min=12.65  median=13.66  max=15.69  mean=13.86  gate=2000  headroom=143x
```

Full distribution in `perf.json`.

## File diff stats

```
apps/desktop/src/App.tsx                            | +49 -44
apps/desktop/src/components/BillingScreen.tsx       | +264 -62
apps/desktop/src/components/BillingScreen.test.tsx  | +221 new
apps/desktop/src/components/SettingsScreen.test.tsx |  -32  (helpers removed)
apps/desktop/src/test/form-helpers.ts               | +52 new
apps/desktop/src/App.test.tsx                       |  ±60 (migration rewrites only)
docs/adr/0009-a5-billing-shell.md                   | +179 new
docs/evidence/a5/HANDOFF.md                         | (this file)
docs/evidence/a5/perf.json                          | new
```

## Rollback

This branch only touches desktop UI and its tests. Revert is safe:

```
git revert <merge-sha>
```

Restores plain F-key nav + F9 billing save. No migration, no data impact.

## Next work (A6 — feat/a6-bill-core)

Wire `bills` and `bill_lines` SQLite tables with FEFO auto-pick, manual batch
override (F7), in-memory recompute on every keystroke. Gate: 10-line bill
computed and saved in p95 <400 ms on reference hardware.
