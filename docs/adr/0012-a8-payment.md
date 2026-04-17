# ADR 0012 — A8: Payment Modal

## Status
Proposed · 2026-04-17 · Parallel track off A6

## Context
A6 lands the bill; cashier now needs to collect payment. Indian pharmacies accept cash, card, UPI, and store credit (regulars). Split tender is common (₹500 UPI + ₹123 cash for ₹623 bill). Round-off must match the tax-engine rule landed in A4 (paise-level banker's rounding on GST components, whole-rupee on grand total).

## Decision
- New command `record_payment(bill_id, tenders: Vec<Tender>)` where `Tender { mode: Cash|Card|UPI|Credit, amount, ref_no? }`.
- Sum of tenders MUST equal bill.grand_total (±0.50 round-off tolerance); else return `TenderMismatch`.
- Migration `payments(id, bill_id, mode, amount, ref_no, created_at)` — N rows per bill for splits.
- UI: F6 on billing screen opens modal; Alt+1/2/3/4 selects mode; Tab to amount; F10 to finalise; Esc cancels.
- Round-off line auto-inserted on bill as `_roundoff` pseudo-line (visible in print but not HSN taxable).
- F6 → F10 perf gate: <600 ms including save_bill + record_payment round-trip.

## Consequences
- Unblocks A9 (invoice-print) — needs tender breakdown on receipt.
- `payments` table becomes GSTR-3B reconciliation source (mode-wise totals).
- Store credit mode requires Customer (A3) with `credit_limit` — enforced at modal.

## Alternatives considered
1. **Single-tender only for v1** — rejected: 40%+ of urban bills are split (UPI + cash for change).
2. **Defer round-off to print layer** — rejected: must persist in DB for GST audit trail.
3. **External PG integration (Razorpay)** — rejected: LAN-first, cashier handles PG on their own device and records ref_no only.

## Supersedes
None.

---

## Addendum · 2026-04-17 · Implementation refinement

During implementation the separate `record_payment` command was **folded into `save_bill`** as an optional `tenders: Vec<Tender>` field. Rationale and invariants:

### Refined decision
- `save_bill` now accepts `tenders: Option<Vec<Tender>>` as an optional field alongside the existing bill/line payload.
- `save_bill` persists bill, lines, and payments in a **single SQLite transaction**. Either the whole unit commits, or nothing does.
- If `tenders` is absent or empty, the canonical path synthesises **one fallback tender** = `{ mode: bills.payment_mode (fallback "cash" when mode is "split"), amount: grand_total, ref_no: None }` and writes one `payments` row. Backward-compat with A6 bills.
- When `tenders.len() > 1`, the top-level `bills.payment_mode` is **forced to `"split"`** regardless of the caller's declared mode — so the bills table always reflects the truth on disk.
- Tender sum must satisfy `|sum(tenders) − grand_total| ≤ TENDER_TOLERANCE_PAISE (50 paise)`; else save_bill returns `Err("TENDER_MISMATCH:sum=...:grand=...:diff=...")` and the transaction rolls back.
- Expected currency unit is **paise (i64)** end-to-end (Rust, TS, DB). Rupee strings only cross the UI-input boundary.

### Why fold, not keep separate
1. **Atomicity.** Two commands means a window where a bill exists without payments (crash between calls → orphan bill, GST-audit-facing inconsistency). One txn closes that window.
2. **Idempotency.** Save_bill is already idempotent-on-failure (returns before INSERT on validation errors). Adding a parallel command requires duplicating that guard surface.
3. **F6 → F10 perf gate.** A single round-trip trivially beats 600 ms on Windows 7 HDD targets; two IPC hops would push the budget.
4. **Fewer moving parts in the UI.** `PaymentModal` emits `tenders[]` to `BillingScreen`, which calls `save_bill` once — no second save-path to keep in sync.

### Schema (unchanged from original ADR)
Migration `0010_payments.sql`:

```sql
CREATE TABLE payments (
  id           TEXT PRIMARY KEY,
  bill_id      TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  mode         TEXT NOT NULL CHECK (mode IN ('cash','upi','card','credit','wallet')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  ref_no       TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_payments_bill_id ON payments(bill_id);
```

`wallet` added to the enum for future A14 loyalty/prepay support (no UI surface yet).

### Tender mode UI contract
| Mode   | Hotkey  | Requires ref_no | Notes                                    |
|--------|---------|-----------------|------------------------------------------|
| Cash   | Alt+1   | No              | Absorbs change when `sum > grand_total`. |
| UPI    | Alt+2   | Optional (UPI txn ID) | Free-text, stored verbatim.        |
| Card   | Alt+3   | Optional (last 4 / auth code) | Free-text.                   |
| Credit | Alt+4   | No (requires Customer A3 with limit) | Enforced in modal.    |
| Wallet | Alt+5   | No              | Reserved — not surfaced in modal yet.    |

### Audit trail
`save_bill` now records `audit_log.payload` with `tenderCount` + `paymentMode` in addition to grand_total/line_count, so GSTR-3B reconciliation can filter split-tender bills without joining.

### Read-path
New command `list_payments_by_bill(bill_id)` returns `Vec<PaymentRowOut>` for A9 (invoice print) and GSTR-3B aggregation.

### Tests (vitest, `packages/bill-repo/src/index.test.ts`)
7 new cases exercising: single-tender default synthesis, split cash+UPI mode forcing, TenderMismatchError above tolerance, ±50-paise acceptance, error field exposure (`grandTotalPaise`, `tenderSumPaise`, `differencePaise`), audit_log payload shape, `ON DELETE CASCADE` from bills → payments.

### Consequences of the fold
- `record_payment` command is **not shipped.** If a future need arises (e.g. partial-payment credit settlements post-bill), it will be re-introduced under a new ADR with its own atomicity story.
- A9 invoice-print can rely on `list_payments_by_bill` rather than reading back from `save_bill`'s response.
- PR #13 scope is now: 1 migration, 1 Rust command extension, 1 TS type surface, 1 React modal, 7 repo tests, 8 modal tests, 1 BillingScreen test update.

