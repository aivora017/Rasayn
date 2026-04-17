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
