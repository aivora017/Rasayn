# ADR 0011 — A7: Rx Capture (Schedule H/H1/X)

## Status
Proposed · 2026-04-17 · Parallel track off A6

## Context
D&C Act 1940 + Rules 1945 mandate prescription details (doctor name, registration no., patient name, Rx date) and 2-year retention for Schedule H, H1, and X drugs. Our SKU master (A1) flags `schedule` per product. The bill-core (A6) already inserts bill-lines; we need a pre-save gate that (a) detects any Schedule H/H1/X line, (b) prompts an Rx modal, (c) writes to `rx_records` linked to `bill_id`, (d) hard-blocks save if required fields are blank.

## Decision
- Add migration `rx_records(id PK, bill_id FK, doctor_name, doctor_reg_no, patient_name, rx_date, photo_path NULL, retention_until, created_at)` with `retention_until = created_at + 2y`.
- `save_bill` command pre-check: if any line's product has `schedule IN ('H','H1','X')` and no `rx_record` attached, return `RxRequired` error → UI opens modal.
- Modal fields: required — doctor name, reg-no, patient name, Rx date; optional — webcam photo (stored under `userData/rx_photos/{bill_id}.jpg`).
- Retention dry-run test: insert 2024-04-17 rx → query under 2026-04-18 "purge candidates" filter returns the row; under 2026-04-16 does not.
- Fallback (no webcam): text-only capture is legal for retail; photo is enhancement not requirement.

## Consequences
- Blocks Schedule H sale without Rx — legal requirement, non-negotiable.
- Adds ~80 ms to save path for Schedule H bills (acceptable vs 400 ms budget).
- `rx_photos/` grows ~50 KB per scheduled bill; rotated by retention job (future A15 work).

## Alternatives considered
1. **Post-save Rx entry** — rejected: legal violation window exists if stored unlinked.
2. **Mandatory photo** — rejected: webcam not universal on pilot hardware (Windows 7 boxes).
3. **Defer to post-pilot** — rejected: Vaidyanath pilot sells Schedule H daily.

## Supersedes
None.
