# A4 — Tax Engine Handoff

Branch: `feat/a4-tax-engine`
Parent: `origin/main` @ latest (post A3 merge)
Playbook: v2.0 §8.1, ADR 0004 row A4, ADR 0007.

## Files delivered

| Path | Lines | Purpose |
|---|---|---|
| `packages/gst-engine/src/index.ts` | 295 | Adds validateLine, computeLineChecked, BillValidationError, BillLineReasonCode; keeps computeLine / computeInvoice / inferTreatment |
| `packages/gst-engine/src/reference.ts` | 124 | BigInt reference calculator (CBIC Rule 32(3A) rewrite) used for generator cross-check |
| `packages/gst-engine/src/index.test.ts` | 301 | 329 tests: MRP-inclusive, treatment inference, validateLine (10), computeLineChecked (2), 100-bill golden regression, 100-bill reference parity, invariants (4) |
| `packages/gst-engine/src/perf.test.ts` | 77 | 100-run perf probe over 100-bill suite, writes perf.json |
| `packages/gst-engine/scripts/generate-golden.ts` | 183 | Deterministic fixture generator with production-vs-reference tripwire |
| `packages/gst-engine/fixtures/golden-bills.json` | 6 359 | 100 bills, per-paisa expected values for every field |
| `docs/adr/0007-a4-tax-engine.md` | 208 | ADR (D1–D7 + 6 alternatives) |
| `docs/evidence/a4/HANDOFF.md` | this | Gate evidence |
| `docs/evidence/a4/perf.json` | 14 | Perf harness output |

## Test results

```
 ✓ src/index.test.ts (329 tests)
   ✓ gst-engine · MRP-inclusive reverse calc            (9)
   ✓ gst-engine · treatment inference                   (4)
   ✓ gst-engine · validateLine (A4)                     (10)
   ✓ gst-engine · computeLineChecked (A4)               (2)
   ✓ gst-engine · golden regression suite (100 bills)   (201)
   ✓ gst-engine · invariants                            (103)
 ✓ src/perf.test.ts (1 test)
   ✓ 100-bill suite compute p95 <200ms on 100 runs

Test Files  2 passed (2)
     Tests  330 passed (330)
```

## Perf gate (ADR 0004 row A4)

Target: 100-bill golden suite (278 line computes + 100 invoice aggregates)
computed with p95 < 200 ms.

| Metric | Value |
|---|---|
| Bills | 100 |
| Total line computes per run | 278 |
| Runs | 100 (with 5-run warm-up discarded) |
| p50 | 0.170 ms |
| **p95** | **0.599 ms** |
| p99 | 3.012 ms |
| mean | 0.254 ms |
| Gate | 200 ms |
| Headroom | **334×** |

Raw JSON: `docs/evidence/a4/perf.json`.

On the reference i3-8100 / 4 GB / HDD shop PC, this is noise: the
bill-save budget is 400 ms end-to-end (A6 gate) and the tax engine now
occupies << 1 ms of that budget.

## Golden fixture coverage

100 bills across:

| Dimension | Values |
|---|---|
| GST rate | 0 (nil-rated), 5, 12, 18 |
| Treatment | intra_state (~40%), inter_state (~33%), exempt (~27%) |
| Qty patterns | 1, 2, 5, 10, 0.5 (fractional strip) |
| Discount | none, 5 % pct, 10 % pct, ₹5 flat absolute |
| Lines per bill | 1 to 5 |
| Round-off triggers | edges across 0, 25, 49, 50, 75, 99 paisa boundaries |

Each bill has per-paisa expected values for:
- Per-line: gross, discount, taxableValue, cgst, sgst, igst, cess, lineTotal
- Per-invoice: subtotal, cgst, sgst, igst, cess, preRound, roundOff, grandTotal

All 100 bills pass:
- Production `computeLine`/`computeInvoice` matches expected to paisa.
- BigInt reference `referenceComputeLine`/`referenceComputeInvoice` matches production to paisa.
- `taxableValue + cgst + sgst + igst = lineTotal` on every line.
- `cgst + sgst = grossExclDisc - taxableValue` on every intra-state line.
- `cgst = sgst = 0` on every inter-state line.
- `cgst = sgst = igst = 0` on every exempt line.
- `|roundOff| ≤ 50` and `preRound + roundOff = grandTotal` on every bill.

## NPPA reason-code surface (ADR 0004 row A4 verbatim gate)

`validateLine(input, ctx)` returns typed failures:

```ts
type BillLineReasonCode =
  | "NPPA_CAP_EXCEEDED"
  | "NEGATIVE_QTY"
  | "DISCOUNT_EXCEEDS_GROSS"
  | "DISCOUNT_PCT_OUT_OF_RANGE"
  | "GST_RATE_INVALID"
  | "EXPIRED_BATCH"
  | "MRP_NON_POSITIVE";
```

NPPA test case verified:

```
input:  mrpPaise=15000 (₹150), qty=1, gstRate=12
ctx:    nppaMaxMrpPaise=14000 (₹140), productName="Paracetamol 500mg", batchNo="B001"
result: { ok: false, reasonCode: "NPPA_CAP_EXCEEDED",
          message: "MRP ₹150.00 exceeds NPPA ceiling ₹140.00 (DPCO 2013) for Paracetamol 500mg",
          detail: { mrpPaise: 15000, nppaMaxMrpPaise: 14000, productName: "Paracetamol 500mg", batchNo: "B001" } }
```

`computeLineChecked(input, treatment, ctx)` throws `BillValidationError`
with the same `reasonCode` + `detail` for the same input. Caught by A6
bill-core at line-add time; surfaces as modal + audit row.

## Regenerating the fixture

```bash
cd packages/gst-engine
npx tsx scripts/generate-golden.ts
# Writes fixtures/golden-bills.json if production==reference.
# Aborts if they diverge by even 1 paisa (tripwire).
```

Regenerating MUST be accompanied by an ADR-0007 companion commit
explaining which value changed and why. Blind regeneration defeats
the purpose of a golden.

## Non-goals (deferred)

- **Cess on tobacco/sugar substitutes** — `cessPaise` is hard-wired to 0
  (pharma retail doesn't hit cess bands in 2026 slabs). A12 exports will
  carry it through as 0.
- **Composition scheme / RCM (reverse charge) bills** — deferred to
  ADR 0008. Pharmacy retail under composition is rare (< 1 % of ICP).
- **B2B invoice vs. B2C** — A4 treats both identically at compute time;
  A12 serializes them differently for GSTR-1 export.
- **IGST reversal on inter-state returns** — A10 ships this using the
  same `computeLine` with negated qty.
- **Cloud-synced NPPA push** — B-series. Until then, shop owner updates
  `products.nppa_max_mrp_paise` manually from CSV; A1's admin trigger
  enforces that write, A4 enforces it at sale.

## Push sequence

Sandbox has no git creds. User runs from Windows PowerShell:

```powershell
cd "C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro"
git fetch origin
git push origin feat/a4-tax-engine
# Open PR: "feat(A4): tax engine — NPPA reason codes + 100-bill golden suite"
```
