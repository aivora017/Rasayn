# ADR 0010 — A6 bill-core: canonical save path, F7 batch override, NPPA re-check

- **Status:** Accepted
- **Date:** 2026-04-16
- **Owner:** Sourav Shaw
- **Supersedes:** none
- **Superseded by:** none
- **Related:** ADR 0004 row A6, ADR 0005 (A2 batch-stock), ADR 0007 (A4 tax engine), ADR 0009 (A5 billing shell)

## Context

A5 shipped the keyboard-first billing shell with in-memory tax recompute
(`gst-engine.computeLine`/`computeInvoice` inside `BillingScreen.computed`) and
a working F10 save path through the pre-existing Tauri `save_bill` command.
The `bills` and `bill_lines` tables, the FEFO view, the expired-batch block
trigger, and the stock-decrement trigger have all lived in migration 0001
since the repo was initialised.

A6 must close the three gaps that separate "save works" from "save is the
business spine":

1. **No host-side canonical writer.** Rust `save_bill` rolls its own
   line-tax math (`apps/desktop/src-tauri/src/commands.rs::compute_line`).
   Any drift vs. `gst-engine` becomes a paisa-level compliance bug that only
   surfaces under audit. We need a single TypeScript source of truth that
   mirrors Rust byte-for-byte and is unit-testable in Vitest — same pattern
   as `batch-repo`/`directory-repo` host-side mirrors (see ADR 0005, 0006).

2. **NPPA/DPCO ceiling is not checked at save.** `gst-engine.validateLine`
   (A4) accepts an optional `nppaMaxMrpPaise`, but the save path calls
   `computeLine`, not `computeLineChecked`. A cashier who manually bumps an
   MRP above the DPCO cap would succeed silently. Row A6 acceptance is
   explicit: **"NPPA + GST re-check on save"**.

3. **Manual batch override (F7) has no UI.** FEFO auto-pick happens on
   product selection (A2), but there is no way for a cashier to pick the
   *second-oldest* batch — needed in the real world when the front stock
   is physically unreachable, when the customer specifically asks for a
   later-expiry pack, or when the first FEFO batch is reserved for another
   counter. Row A6 acceptance is explicit: **"manual batch override (F7)"**.

Performance gate: a 10-line bill must be computed and persisted with p95
<400 ms on reference hardware (i3-8100 / 4 GB / HDD / Windows 7). A6 adds a
perf test so the gate is tracked on every PR; hardware-true numbers land in
A15's regression VM.

## Decision

### 1. `@pharmacare/bill-repo` becomes the canonical host-side writer

The stub added during monorepo scaffolding becomes the authoritative spec.
Public surface (v0.2.0):

| Export | Purpose |
| :-- | :-- |
| `computeBill(input, shopCtx)` | Pure in-memory recompute. Returns `{lines[], totals, warnings[]}`. Uses `gst-engine.computeLineChecked` with per-line NPPA cap. Called by BillingScreen's `useMemo` path and by `saveBill`. |
| `saveBill(db, billId, input)` | Transactional persist. Resolves shop state, runs `computeBill` (NPPA-checked), inserts `bills` + `bill_lines` + `audit_log`. Lets the `trg_bill_lines_decrement_stock` trigger handle stock. |
| `resolveDraftLines(db, draftLines, shopCtx)` | Given lines that may have `batchId: null`, fills in FEFO auto-pick via `batch-repo.allocateFefo`. Runs before `computeBill`. Manual overrides (`batchId` set) pass through unchanged. |
| `listCandidateBatches(db, productId)` | Thin pass-through to `batch-repo.listFefoCandidates`. Exported here so UI code has one import path for "batch-picker data". |
| `NppaCapExceededError` | Typed error with `{productId, mrpPaise, capPaise}`. Caught at UI layer → red toast, focus returns to the offending line. |

The Rust `save_bill` command remains the desktop IPC entrypoint but its
compute body will in a follow-up (A15 perf-harden pass) be regenerated from
the bill-repo spec via a golden-output fixture. For A6 we:

- Add an **NPPA re-check** in Rust `save_bill` — query
  `products.nppa_max_mrp_paise`, fail the transaction with reason code
  `NPPA_CAP_EXCEEDED:<productId>` if any line's `mrp_paise` exceeds the cap.
- Document the Rust↔TS compute parity gap; add a 100-row golden fixture
  test (`bill-repo/src/parity.test.ts`) that runs the TS compute and asserts
  a hand-verified table. Rust parity is asserted by manual spot-check now,
  automated in A15.

### 2. F7 batch override — modal dialog with keyboard-only operation

**UX contract** (screen-local F-key, per ADR 0009 §F-key scoping):

- F7 is active **only** when focus is within Billing AND at least one line
  exists. Press = open `batch-override-modal` for the **last-added line**
  (default target). An up-arrow step in a follow-up can re-target other
  lines; for A6 we ship only last-line targeting (keeps the happy path tiny).
- Modal renders a `role="listbox"` of `listCandidateBatches(productId)`:
  batch no · expiry · qty · MRP. First row auto-selected. ↑/↓ move
  selection, Enter commits, Esc cancels. No mouse required.
- Commit swaps the line's `batch` field; MRP is re-taken from the picked
  batch (MRP lives on the batch, not the product). `computed` useMemo
  recomputes immediately.
- If the product has only one non-expired batch, F7 opens the modal anyway
  (cashier gets to confirm) but shows a non-dismissible banner
  "Only one batch available". This prevents silent "F7 did nothing".

**Modal contract follows ADR 0009:** `testid="batch-override-modal"`,
ref-focused `batch-override-confirm` button on open, Esc closes and refocuses
the billing root. `aria-keyshortcuts="F7"` on the line being targeted
(invisible affordance; exposed for the A5 a11y audit).

### 3. `list_fefo_candidates` Tauri command + TS RPC

Mirrors Rust `pick_fefo_batch` but returns an array. Wired into ipc.ts as
`listFefoCandidatesRpc(productId)`. Used exclusively by the F7 modal;
no other caller. The auto-pick path still uses `pick_fefo_batch` (single
row) for O(1) network.

### 4. Perf gate — 10-line bill, p95 < 400 ms

`packages/bill-repo/src/perf.test.ts` seeds 10 products × 10 batches and
runs 100 iterations of save-10-line-bill through `saveBill`. Asserts p95
under 400 ms. Node/Linux/SSD will clear this by 10×+; the gate meaningfully
fires only in the A15 regression VM. The JSON report lands at
`docs/evidence/a6/perf.json` for A15's aggregator.

## Consequences

**Positive**

- Single source of truth for bill math. A4's golden test, A6's parity test,
  and any future invoice/print/export that needs to re-compute a line share
  exactly one code path: `bill-repo.computeBill`.
- NPPA ceiling is enforced at save, not just at UI — a hand-rolled SQL
  insert via dev tools still fails (Rust-side check).
- F7 unblocks the real-world "wrong front stock" workflow without dropping
  back to the mouse.
- Perf regressions trip the gate long before they reach the pilot VM.

**Negative**

- Rust `save_bill` now has two compute paths (its own + the forthcoming
  parity test). A15 must retire the Rust compute body or we carry
  duplication. Tracked as a known debt, not a blocker.
- F7 targets only the last line in A6. Per-line targeting (e.g. via an
  in-line F-key or an arrow-step selection model) is a follow-up — flagged
  in `docs/evidence/a6/HANDOFF.md §Next work`.
- The `computeBill` host path hits better-sqlite3 for NPPA caps and shop
  state on every recompute. We memoize `shopCtx` per-mount in
  BillingScreen; caps are read once per line-add and cached on the
  `DraftLine`. Net cost is invisible at 10 lines — confirmed by the perf
  test.

## Alternatives considered

1. **Single-source in Rust, delete bill-repo.** Rejected: fails the
   "unit-testable in Vitest" monorepo rule (ADR 001, §8.1 Playbook v2.0) and
   would force every invoice-print/export/return path to re-implement
   compute in whatever language it lives in. Host-side mirror is load-bearing.

2. **Leave NPPA check at UI only.** Rejected: violates Playbook §2
   non-negotiable #5 (*compliance automatic, never manual*) — a defect in
   UI validation can't be allowed to write a non-compliant bill.

3. **F7 opens an arrow-step selection of which line to target, not just
   last-line.** Rejected for A6: doubles the modal complexity for a
   follow-up feature that is rarely needed in practice (cashiers add a line
   → immediately realise they want a different batch → hit F7). Revisit
   once we have real pilot usage data.

4. **Swap `better-sqlite3` for a WASM build of the same SQL schema so
   bill-repo runs in-browser.** Rejected: WASM SQLite would bloat the
   desktop bundle past the 200 MB installer budget; bill-repo is a Node
   test harness and a spec document, not a runtime. The runtime is Rust.

5. **Expose batch picker as a dropdown at line-add time instead of a
   separate F7 modal.** Rejected: adds a visual affordance to every
   line-add, violates the A5 "sub-2-s empty bill" flow by making the
   cashier read an extra widget on the 95 % happy-path where FEFO is
   correct. Modal is zero-cost for the 95 % case and one keypress for the
   5 % case.

## Follow-up

- **A7** (Rx capture) lands on top of this file; the Schedule-H block trigger
  uses the `customer_id` + `rx_id` columns already in `bills`. No bill-repo
  changes needed for A7 beyond adding the fields to `SaveBillInput`.
- **A8** (payment modal) replaces the hard-coded `paymentMode: "cash"` in
  BillingScreen with a real tender flow; the field already exists in
  `SaveBillInput`.
- **A15** will retire Rust compute in favour of a generated-from-spec
  module. Parity test stays as a regression anchor.
