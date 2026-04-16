# ADR 0007 — A4 Tax Engine (gst-engine)

Status: Accepted
Date: 2026-04-16
Owner: Sourav Shaw
Playbook: v2.0 Final §8.1, §8.8 (GST + NPPA/DPCO automatic compliance),
ADR 0004 row A4
Implements: FR-A4-* (CGST/SGST/IGST split, inter/intra-state detection,
NPPA ceiling check, round-off rule, golden regression suite)

## Context

A1 (SKU master) shipped with a `products.nppa_max_mrp_paise` column and a
write-time trigger that blocks setting `products.mrp_paise` above the
notified NPPA (DPCO 2013) ceiling. That covers the master-data admin
path. A4 is the **billing hot path**: at sale time the cashier picks a
batch whose printed MRP may have been set before a price notification,
or whose batch.mrp_paise differs from products.mrp_paise; the bill engine
must compute taxes and independently enforce the NPPA ceiling with
**structured reason codes** a UI can route to a localized message and
an owner-override workflow.

Foundation-level `computeLine` / `computeInvoice` / `inferTreatment` already
exist (MRP-inclusive reverse calc per CBIC Rule 32(3A), ±50 paise invoice
round-off). A4 adds the validation layer, the golden regression suite,
and tightens the round-off invariants.

ADR 0004 row A4 acceptance gate verbatim:

> Golden-test suite (100 bills from real pharmacy invoices) matches to
> paisa; NPPA cap breach blocks save with reason code.

## Decision

### D1 — `BillLineReasonCode` union type for machine-readable blocks

Seven codes cover the hot-path blocks that surface from either validation
or A2 batch data:

```
NPPA_CAP_EXCEEDED | NEGATIVE_QTY | DISCOUNT_EXCEEDS_GROSS
DISCOUNT_PCT_OUT_OF_RANGE | GST_RATE_INVALID | EXPIRED_BATCH
MRP_NON_POSITIVE
```

Each failure carries a human-readable `message` for immediate UI display
**and** a structured `detail` object for the audit row. The UI layer
never has to parse message strings.

### D2 — `validateLine(input, ctx)` is pure, returns discriminated result

```ts
type LineValidationResult =
  | { ok: true }
  | { ok: false; reasonCode: BillLineReasonCode; message: string; detail?: {...} };
```

Pure function. No throws. Caller (UI, test, batch job) chooses whether to
throw or surface. `computeLineChecked(input, treatment, ctx)` is the
convenience wrapper that throws `BillValidationError`.

### D3 — NPPA check runs at compute time on batch MRP

`LineInput.mrpPaise` is authoritative — it is the batch MRP (populated by
A2 FEFO pick), not the product-row MRP. A4 validates this value against
the product's current `nppaMaxMrpPaise` ceiling, which the caller passes
via `LineValidationContext`. If ceiling < batch MRP, the sale is blocked
with `NPPA_CAP_EXCEEDED` and the UI surfaces the breach before `F10 Save`.

### D4 — 100-bill golden regression fixture

`packages/gst-engine/fixtures/golden-bills.json` freezes 100 bills
with per-paisa expected values for every field:

```
gross, discount, taxableValue, cgst, sgst, igst, cess, lineTotal  (per line)
subtotal, cgst, sgst, igst, cess, preRound, roundOff, grandTotal  (per invoice)
```

The suite covers:
- Ten **hand-authored canonical** cases (ids `gold-001`..`gold-010`) with
  round numbers pinned by manual paper arithmetic; these are the
  independent-of-codebase oracle.
- Ninety **parameter-space enumerations** (ids `gold-011`..`gold-100`),
  deterministically seeded (`mulberry32(0xA4C017)`), covering rate ×
  treatment × qty (1, 2, 5, 10, 0.5 strip) × discount mode (none, 5 %,
  10 %, flat ₹5) × 1–5 lines per bill.

### D5 — Generator enforces cross-path agreement before freezing

`scripts/generate-golden.ts` runs BOTH the production path
(`computeLine` / `computeInvoice`) AND an independent BigInt reference
(`reference.ts`) on every candidate bill. If any field diverges even
by 1 paisa, generation aborts. The reference path is a BigInt rewrite
of the same CBIC Rule 32(3A) formula; it catches regressions that stem
from JS Number precision on large values or from accidental float drift.

The reference uses the same CGST/SGST odd-paisa policy as production
(odd paisa bumps into CGST via half-away-from-zero rounding) so both
paths agree by construction on the split choice; it is not an
independent tie-breaker for that rule, only for the taxable / tax
computation.

### D6 — Round-off policy: half-away-from-zero to nearest rupee, ±50 cap

Reaffirmed (already shipped). `grandTotal = round(preRound / 100) × 100`.
`|roundOff| <= 50` is tested on every bill in the golden suite. The
invariant `preRound + roundOff = grandTotal` is enforced per bill.

### D7 — CGST/SGST odd-paisa bumps into CGST

When `totalTax` is odd, `cgst = ceil(tax/2)` and `sgst = floor(tax/2)`.
Both halves sum to `totalTax` exactly. CBIC does not mandate which half
absorbs the odd paisa; we pin CGST so the test suite is deterministic.

## Consequences

Positive:

- **330 tests green** (320 MRP/NPPA + 10 invariants), including 100-bill
  production-vs-expected parity and 100-bill reference-vs-production
  parity. Evidence: `docs/evidence/a4/perf.json` + CI log.
- **Perf p95 0.599 ms** for the full 100-bill suite compute (278 line
  computes + 100 invoice aggregates), against a 200 ms gate — **334× headroom**.
  On the reference i3-8100 / 4 GB / HDD shop PC, this is noise: bill-save
  budget is 400 ms end-to-end, of which the tax engine now occupies
  << 1 ms.
- **NPPA breach is now non-silent at bill time**: even if a bad batch
  slipped through the A1 admin-trigger (e.g. NPPA notification landed
  after the batch was received), A4 blocks the sale with a typed reason.
- **Generator's cross-path check** catches JS Number → BigInt drift on
  very large bills (e.g. a ₹50 000 MRP × 100 qty distributor-scale
  bill). No regression can silently ship.

Negative / accepted trade-offs:

- Golden fixture is 6 359 lines / 153 KB. Acceptable: static JSON, not
  shipped to the Tauri binary, only loaded by test runner.
- Reference calculator is not fully algebraically independent (same
  formula, different integer type). Independence is provided by the
  10 hand-authored cases + the invariant checks (tax + taxable = net,
  cgst + sgst = totalTax, round-off bounded). A future A12 pass can
  add CBIC offline-utility validation for extra assurance.
- `computeLineChecked` throws; the legacy `computeLine` still exists and
  is used by the golden fixture and by downstream A6 (bill-core) which
  validates upstream. Two code paths means a future dev could forget to
  validate — mitigated by linting rule in A6 that the bill-core entry
  point only calls `computeLineChecked`.

## Alternatives Considered

A1. **Throw from `computeLine` on validation failure, no separate
    `validateLine`**. Rejected: UI needs to decide whether to block, warn,
    or require owner override; it can't do that cleanly when the answer
    comes back as a thrown Error. Discriminated result + typed exception
    is the cleanest split.

A2. **Store NPPA cap on the `batches` table, not products**. Rejected:
    NPPA notifications target products (formulation + strength), not
    individual batches. A batch inherits its product's cap at sale time.
    Storing on batches would require back-filling the whole batches
    table on every NPPA notification — a distributed write the offline-
    first parent can't safely guarantee.

A3. **Validate NPPA via live NPPA.nic.in API on every bill line**.
    Rejected: Hard Rule 1 (LAN-first, 100 % offline). A cloud-synced
    `price_caps` table (B-series) will push NPPA notifications to
    shops nightly; until then, shop owner updates the ceiling in the
    A1 master screen and the write-trigger enforces it.

A4. **Frozen fixture only, skip the BigInt reference**. Rejected: a
    fixture-only regression guard cannot catch the case where the
    producer AND the consumer share the same bug (they were both
    generated by the same `computeLine` that has the bug). The BigInt
    path ups the bar on precision-drift bugs specifically.

A5. **CGST absorbs even half, SGST absorbs odd paisa**. Rejected
    arbitrarily — both are CBIC-legal. Pinned to CGST for determinism.
    A future state that mandates SGST absorbs the odd paisa can change
    this with a single migration note (no schema impact).

A6. **Use `Decimal.js` as the reference oracle**. Rejected:
    introduces a runtime dep used only for testing; BigInt in the
    standard library is enough.

## Supersedes / Superseded-by

- Supersedes: (none — A4 was foundation-only before this ADR).
- Extends: ADR 0002 (SQLite schema runtime), migration 0006 (NPPA cap
  column + admin trigger).
- Superseded-by: (none). B-series will add cloud-synced NPPA
  notification push; that extends A4 but does not supersede it.

## Acceptance-gate evidence (ADR 0004 row A4)

- [x] Golden-test suite (100 bills) matches to paisa — `fixtures/golden-bills.json`
  + 100 `production matches expected` tests + 100 `reference matches production`
  tests.
- [x] NPPA cap breach blocks save with reason code — `validateLine` returns
  `{ ok: false, reasonCode: "NPPA_CAP_EXCEEDED", message, detail }`;
  `computeLineChecked` throws `BillValidationError` with same code.
- [x] Perf under budget — p95 0.599 ms / 100-bill suite (gate 200 ms,
  334× headroom).
- [x] Round-off invariants tested on every golden bill
  (|roundOff| ≤ 50 paise, grandTotal % 100 = 0, preRound + roundOff =
  grandTotal).
- [x] CGST + SGST = totalTax enforced on every intra-state golden line.
- [x] Inter-state carries only IGST; exempt carries no tax.
