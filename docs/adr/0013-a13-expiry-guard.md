# ADR 0013 — A13: Expiry Guard

## Status
Proposed · 2026-04-17 · Parallel track off A6

## Context
Hard Rule 9 of the Playbook: "expired drug sale = hard block." D&C Act criminalises sale of drugs past expiry (Sec 27 — imprisonment 1–3y). Our `batches` table (A2) stores `expiry_date`. FEFO (A6) already sorts by expiry but does not block past-expiry picks. Near-expiry (90/30 day) warnings help shops clear stock and avoid write-offs.

## Decision
- On line-add (client-side, before FEFO allocation): query oldest batch for product; compute `days_to_expiry = expiry_date - today_ist`.
  - `days <= 0` → hard block with toast "Expired batch — cannot sell"; suggest alternate product.
  - `0 < days <= 30` → red chip "Expires in N days — owner override required".
  - `30 < days <= 90` → amber chip "Expires in N days".
  - `days > 90` → no indicator.
- Override flow: owner role only (A3 customer-master not enough — needs staff-role from F5 settings); writes `expiry_override_audit(bill_line_id, actor_user_id, reason, created_at)`.
- Perf gate: indicator surfaces <50 ms after line-add (indexed lookup on `batches(product_id, expiry_date)` — index exists from A2).
- NDPS Form-IV hook: stub function `record_ndps_entry(bill_line_id)` for future (A14 narcotics register) — not invoked yet.

## Consequences
- Eliminates single biggest compliance risk (expired-drug prosecution).
- ~5% of urban pharmacies override monthly (per deep-research report); audit trail satisfies inspector.
- Staff-role wiring (owner-only override) is a prerequisite — wire in A5 settings OR assume `role=owner` from F5 for pilot.

## Alternatives considered
1. **Warn only, don't block** — rejected: violates Hard Rule 9.
2. **Block at save_bill instead of line-add** — rejected: cashier wastes time entering full bill then fails; block early.
3. **Override allowed for any role** — rejected: staff would override by habit, defeating the guard.

## Supersedes
None.
