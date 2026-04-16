# ADR 0008 — SettingsScreen test: harden against CI flake on type→click race

- Status: Accepted
- Date: 2026-04-16
- Supersedes: —
- Superseded-by: —
- Owner: Sourav Shaw
- Playbook ref: v2.0 Final §8.1 (CI gated on green vitest + typecheck)

## Context

Post-A4 merge (PR #8, `5f279c5`), GitHub Actions run for `main` reported:

```
FAIL src/components/SettingsScreen.test.tsx > SettingsScreen (F5b) >
     rejects malformed GSTIN without hitting backend
Tests  1 failed | 46 passed (47)
```

Locally on Node v20.18.0 (CI-matching), the test passed **25 runs in a row**
— confirming the failure is a transient flake, not a correctness bug. A4's
diff touched only `packages/gst-engine/*` and never loaded `SettingsScreen`,
so A4 is not a root cause.

### Root cause

```tsx
// apps/desktop/src/components/SettingsScreen.tsx (line 214)
<button type="submit" data-testid="f-save" disabled={busy || !dirty}>
```

```tsx
// SettingsScreen.test.tsx (old, before this ADR)
await user.clear(gstin);
await user.type(gstin, "INVALIDGSTIN123");   // (1)
await user.click(screen.getByTestId("f-save")); // (2)
```

`userEvent v14` dispatches each keystroke in (1) synchronously inside `act()`,
but on an oversubscribed CI runner React's scheduler can defer the *last*
commit of `form.gstin` until after (2) has already resolved. When that
happens:

- `form.gstin` is still equal to `loaded.gstin` → `dirty === false` →
  Save button is `disabled`.
- `userEvent.click` on a disabled button is a **no-op** — no `submit` event
  fires, `onSubmit` never runs, `setErr()` never fires, `settings-err`
  banner never renders.
- The subsequent `findByTestId("settings-err")` times out, surfacing as
  the test failure.

The rendered DOM dump from the failed CI run confirms this: the GSTIN input
displayed the placeholder `00AAAAA0000A0Z0` (not the typed `INVALIDGSTIN123`)
and the Save button carried `disabled=""` despite the happy-path
expectation that typing a 15-char value should have toggled it on.

## Decision

Harden the test, not the component. The `disabled={!dirty}` UX on Save is
correct — it prevents no-op saves of unchanged data — and every other UI in
v2.0 will re-use this pattern. The fix is at the **test seam**, not the
component.

Introduce two local test helpers (private to `SettingsScreen.test.tsx`, no
shared-test-util sprawl yet) and apply them consistently:

```tsx
async function retype(user, el, value) {
  await user.clear(el);
  if (value.length > 0) await user.type(el, value);
  await waitFor(() => expect(el.value).toBe(value));
}

async function clickWhenEnabled(user, testId) {
  const btn = await screen.findByTestId(testId);
  await waitFor(() => expect(btn.disabled).toBe(false));
  await user.click(btn);
}
```

`retype` forces React to commit the controlled-input state before the test
proceeds. `clickWhenEnabled` is a safety net: if `dirty` flipping hasn't
propagated to the button yet, waitFor polls until it does — or fails loudly
with a real error message instead of a silent no-op.

Apply these helpers to **every** type→click path in the suite (not just the
failing one) so no sibling test regresses into the same race.

## Consequences

**Positive**

- Eliminates the flake class permanently. Before: 1/47 tests flake under
  CI load. After: 20/20 local runs green on Node 20.18.0 + full monorepo
  18/18 green.
- Test output is now self-diagnosing: if `user.type` stops propagating to
  a controlled input (real regression), the `retype` waitFor fails with
  `"expected '00AAAA...' to be 'INVALIDGSTIN123'"` — far more actionable
  than a mysterious `findByTestId` timeout.
- `clickWhenEnabled` surfaces unintended disabled-Save regressions — if a
  future refactor accidentally ties Save.disabled to the wrong state, the
  test fails with a clear "button stayed disabled" error.

**Negative**

- ~40 lines of test helper boilerplate local to this file. Accepted cost;
  will promote to a shared `src/test/form-helpers.ts` when A5's billing
  screen adds its own type→submit tests (FR-A5-F10).

**Neutral**

- No production code change. `SettingsScreen.tsx`, IPC layer, and validator
  all untouched. Safe cherry-pick candidate if we ever need to back-port to
  a release branch.

## Alternatives considered

1. **Remove `disabled={!dirty}` from Save button.**
   Rejected — this is a deliberate UX rule (no-op saves confuse owners).
   Fixing a test flake by loosening production UX is always the wrong trade.

2. **Bypass the button with `fireEvent.submit(form)`.**
   Rejected — removes coverage of the "Save button enabled after dirty"
   path. The button *is* part of the user journey under test.

3. **Retry the flaky test via `vitest --retry=2`.**
   Rejected — hides the race instead of fixing it. If the race ever widens
   into a real bug (e.g. the controlled input drops events under
   back-pressure), retries will mask it until pilot week.

4. **Replace controlled input's `value.toUpperCase().slice(0,15)`
   transform with an uncontrolled `ref` + onBlur.**
   Rejected — uppercase-as-you-type is a deliberate owner-UX affordance
   (pharmacists type GSTINs in lowercase on cheap keyboards). The transform
   is correct.

5. **Ship nothing; re-run CI until green.**
   Rejected — it *will* flake again under the next heavy CI queue. Cheap
   prevention now vs. recurring on-call cost later.

## Evidence

- 10/10 green on fresh clone of `origin/main` (5f279c5) + this patch, Node
  20.18.0.
- 15/15 green on stressed loop (pre-ADR iteration).
- Full monorepo unchanged: 18/18 packages, 524 tests pass.
- `tsc --noEmit` clean on `@pharmacare/desktop`.
