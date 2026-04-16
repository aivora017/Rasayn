# ADR 0009 — A5 billing shell (keyboard-first) + nav-key migration

Status: Accepted — 2026-04-16
Supersedes: part of 0007 (billing screen nav behavior was implicit in F1-nav).
Related: 0004 row A5, 0008 (test helper class now promoted).

## Context

Row A5 of the A1–A16 POS-readiness plan (ADR 0004) requires a keyboard-first
billing screen skeleton with the F-key map **F1 new · F2 customer · F3 add-line ·
F4 discount · F6 payment · F10 save**, a focus-ring contract, and a "no mouse
required" guarantee. Acceptance: keyboard-only empty-bill creation in under 2 s,
focus never lost to mouse, a11y audit clean.

The pre-A5 codebase routed plain `F1`–`F8`/`F11` at the `<App>` level to screen
navigation. That binding *directly* collides with five of the six A5 billing
actions. Either billing's F-keys fight App's nav keys every press, or one of
the two schemes has to move. Legacy pharmacy POS (Marg, Tally, RetailGraph,
Vyapar) resolve this by making F-keys context-sensitive to the active screen
and reserving a modifier-key scheme for cross-screen navigation. PharmaCare
Pro follows the same convention.

ADR 0008 deliberately kept `retype`/`clickWhenEnabled` as file-local helpers
in `SettingsScreen.test.tsx`, with an explicit follow-up to promote them
once A5 added its own type→submit tests. A5 crosses that threshold.

## Decision

1. **Navigation moves from plain `F1`–`F11` to `Alt+1`–`Alt+9`.**
   Mapping (stable, referenced from the topbar UI and every screen test):

   | Shortcut | Mode       | Shortcut | Mode       |
   |----------|------------|----------|------------|
   | Alt+1    | billing    | Alt+6    | templates  |
   | Alt+2    | inventory  | Alt+7    | gmail      |
   | Alt+3    | reports    | Alt+8    | settings   |
   | Alt+4    | grn        | Alt+9    | masters    |
   | Alt+5    | directory  |          |            |

   Plain F-keys are free for per-screen contextual actions from A5 onward.
   `App.tsx` now only triggers mode-switching when `e.altKey` is held.

2. **BillingScreen plain-F-key map (A5 spec).** Implemented via a
   window-level `keydown` handler scoped to the component lifetime:

   | Key  | Action                                                         |
   |------|----------------------------------------------------------------|
   | F1   | New bill — clear lines/customer/Rx/toasts, refocus product search |
   | F2   | Focus the always-visible customer bar                          |
   | F3   | Focus the product search (alias for "add line")                |
   | F4   | Focus the discount input on the last line (no-op if no lines)  |
   | F6   | Open payment modal (shell; A8 delivers real split-tender)      |
   | F10  | Save — works from main screen and from inside the payment modal|
   | Esc  | Close payment modal; dismiss toast                             |

   The handler early-exits when `Alt`/`Ctrl`/`Meta` is held, so App's Alt+digit
   nav never collides.

3. **Customer bar is always visible at the top of the billing screen** with
   `data-testid="cust-search"`. It feeds one shared `customer` state that the
   Rx-required banner also reads, so there is exactly one customer selection
   path for the bill. Previous `rx-cust-search` / `rx-cust-hit-*` /
   `rx-cust-selected` testids are renamed to `cust-search` / `cust-hit-*` /
   `cust-selected`. Existing Rx-attach tests updated accordingly.

4. **Payment modal shell only.** `F6` opens a `role="dialog"` modal that
   displays mode (hard-coded "Cash"), the grand total, and two buttons:
   `payment-cancel` (Esc) and `payment-confirm` (F10 / Enter when focused).
   A8 (`feat/a8-payment`) will replace this shell with split-tender, card,
   UPI, change-calc, and round-off wiring. The `testid="payment-modal"` and
   `testid="payment-confirm"` contract is stable across A5 → A8.

5. **Focus contract.**
   - On mount, product search is focused (ProductSearch's `autoFocus` prop).
   - F1 reset returns focus to product search.
   - F2/F3/F4 explicitly target `cust-search` / `product-search` /
     `line-discount-{last}`; `.select()` is called on text inputs so a
     second keystroke overwrites cleanly.
   - Payment modal autofocuses `payment-confirm` so `Enter` works with no
     Tab dance.
   - F4 with zero lines is a no-op (test-asserted: `document.activeElement`
     does not change).

6. **Accessibility.**
   - `billing-root` is `role="region" aria-label="Billing"`.
   - Totals aside is `role="complementary" aria-label="Bill totals"`.
   - Customer hits render in `role="listbox"` with `role="option"` children.
   - Save button has `aria-keyshortcuts="F10"` and the accessible name
     `"Save & Print (F10)"`.
   - Toasts render in a visually-hidden `role="status" aria-live="polite"`
     region plus the visible banner.
   - Topbar nav is a `<nav aria-label="Screen navigation">`.

7. **`retype` / `clickWhenEnabled` promoted to `src/test/form-helpers.ts`.**
   `SettingsScreen.test.tsx` imports from the shared module; the file-local
   copies are removed (net −32 test-code lines). New callers — any A5+ test
   that types into a controlled input and clicks a `disabled={!dirty}` Save
   button — must use the shared helpers.

## Consequences

**Positive**

- Billing F-keys now work as A5 specifies without any handler-priority
  gymnastics (capture-phase, focus-gated dispatch, or synthetic prevent
  dance). Simpler mental model, easier to extend in A6–A8.
- One customer input for the bill (not two) — eliminates a whole class of
  "selection drifted between banner and top-bar" bugs that would otherwise
  appear in A7 and A8 when Rx/payment consume the selection.
- Screen-contextual F-keys align with pharmacy operators' muscle memory
  from Marg/Tally. Lower training cost during pilot onboarding.
- Empty-bill-ready perf is 12–16 ms locally (gate 2000 ms). Even a 100×
  slowdown on Win7/4 GB/HDD would still pass. Shell perf not on the
  critical path for the p95 <400 ms save gate (A6/A15).
- Promoting the ADR 0008 helpers removes ~30 lines of duplicated test
  scaffolding and sets the standard for every future controlled-input form.

**Negative**

- Every existing screen test that switched mode via a plain F-key moved to
  `{ key: "n", altKey: true }` — 30+ call sites. One-time migration, no
  ongoing cost.
- Alt+digit conflicts with Firefox's default tab-switching shortcut on
  Linux/Windows. Not an issue in Tauri (production), and we document the
  workaround for dev-in-Firefox (use Chromium-based dev, or rebind in
  Firefox). Accepted; the alternative — Ctrl+Alt+digit — is heavier and
  less muscle-friendly.

**Neutral**

- `F9` on the GRN save handler is unchanged. GRN will migrate to a
  contextual F-key scheme in its own ADR when A10 (returns) forces the
  question. For now `F9` save on GRN remains, and BillingScreen's `F10`
  save is the only cross-screen inconsistency (documented here).

## Alternatives considered

1. **Capture-phase listener in BillingScreen + `stopPropagation` on the six
   billing F-keys.** Works, but creates invisible ordering coupling between
   component mount order and key handling. Every new screen that wants
   contextual F-keys would need to replicate the pattern. Rejected in
   favour of a uniform "plain F-keys are screen-local; modifier+key is
   global" rule.

2. **Alt+letter mnemonic nav (Alt+B billing, Alt+I inventory, …).** More
   discoverable, but Alt+letter is the browser accesskey range and gets
   overridden by page-level `accesskey` attributes. Alt+digit is universally
   free in the Tauri webview and less likely to clash with future screen
   shortcuts.

3. **Leave `F9` save on billing and add F10 as a second binding.** Carries
   technical debt into A6 and requires a deprecation communication to the
   pilot shop. Rejected — A5 is the clean cut.

4. **Payment modal with real cash/card/UPI split-tender now.** Expands A5
   into A8 scope. Rejected; we ship the shell contract (open/close/confirm)
   and let A8 fill in the body behind a stable testid.

## Evidence

- `apps/desktop/src/App.tsx`: nav migration, 60 → 105 lines with ARIA roles.
- `apps/desktop/src/components/BillingScreen.tsx`: A5 shell, 389 → 590 lines.
- `apps/desktop/src/test/form-helpers.ts`: new, 52 lines.
- `apps/desktop/src/components/BillingScreen.test.tsx`: new, 14 tests
  covering every F-key, focus contract, perf gate, a11y, keyboard-only path.
- `apps/desktop/src/App.test.tsx`: 40 tests green after migration — nav
  `F*` → `Alt+digit`, billing save `F9` → `F10`, `rx-cust-*` → `cust-*`.
- `apps/desktop/src/components/SettingsScreen.test.tsx`: 7 tests green
  after dropping file-local helpers in favour of `form-helpers.ts`.
- `docs/evidence/a5/HANDOFF.md` and `docs/evidence/a5/perf.json`.

## Follow-up

- When A6 wires `bills` / `bill_lines` persistence and the real FEFO loop,
  re-measure the shell perf on Win7/4 GB/HDD reference VM and fold the
  number into `docs/evidence/a5/perf.json`.
- When A8 ships the real payment modal, verify the `F6 → Enter/F10` flow
  remains <600 ms end-to-end (A8 acceptance).
- `F9` on GrnScreen stays until A10 forces a contextual-F-key ADR for GRN.
