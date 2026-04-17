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

## Addendum · 2026-04-17 (implementation)

**Scope clarifications made during build:**

1. **Reuses existing `prescriptions` table from `0001_init`** — not a new `rx_records` table as the original ADR suggested. The 0001 schema already had `prescriptions (id, shop_id, customer_id, doctor_id, kind, image_path, issued_date, notes)` plus `bills.rx_id FK`. Migration `0012_rx_records.sql` only adds `retention_until TEXT` + an AFTER INSERT trigger that populates it as `date(issued_date, '+2 years')`. No schema collision; the existing `create_prescription` Tauri command stays the single write path.

2. **Gate scope extended to NDPS.** The UI's `RX_REQUIRED` set already covered `{H, H1, X, NDPS}`; the Rust + TS `save_bill` gates and the new DB block trigger match that set. A proper NDPS Form IV register is a future branch (tracked as candidate A16); until then, requiring a prescription for NDPS is the strictest-reasonable gate and mirrors what the UI already enforced.

3. **Patient-name capture** is stored in `prescriptions.notes` as `patient: {name}` (with any caller-supplied notes appended after a `|` separator). Reason: the existing schema has no dedicated patient-name column, and adding one would have forced a breaking change to the `create_prescription` Rust command + its callers. Free-text in `notes` is adequate for D&C Rules r.65 retention audits (patient name must be retrievable, not indexed).

4. **Defense in depth** — three layers enforce the rule:
   - **UI**: `BillingScreen` hides the payment button and shows the red rx-required banner when `RX_REQUIRED.has(line.schedule)` and `rxId === null`.
   - **Rust `save_bill`**: loops all lines and returns `RX_REQUIRED:product_id=…:schedule=…` before any DB write.
   - **TS `bill-repo.saveBill`** (used by Node/test contexts): same check, throws `RxRequiredError`.
   - **DB trigger `trg_bill_lines_require_rx`** (from 0012): raises `schedule H/H1/X/NDPS product requires rx_id on bill` on any `INSERT INTO bill_lines` that would violate the invariant, even if the Rust/TS gates are bypassed.

5. **`record_prescription` TS helper** in `bill-repo` is a test-side convenience that bundles `upsert doctor by reg_no` + `insert prescription` in one transaction. The production UI path uses `upsertDoctorRpc` + `createPrescriptionRpc` separately (unchanged from pre-A7). The TS helper lets `index.test.ts` exercise the save_bill RX_REQUIRED → retry-with-rxId flow without reaching through IPC mocks.

**Implementation lines (summary):**

| File | LOC change | Purpose |
|---|---|---|
| `packages/shared-db/migrations/0012_rx_records.sql` | +45 | retention column + block trigger + indexes |
| `apps/desktop/src-tauri/src/db.rs` | +9 | wire 0012 into `apply_migrations` |
| `apps/desktop/src-tauri/src/commands.rs` | +24 | RX_REQUIRED pre-txn gate in `save_bill` |
| `packages/bill-repo/src/index.ts` | +110 | `RxRequiredError` class + gate + `recordPrescription` helper |
| `packages/bill-repo/src/index.test.ts` | +180 | 11 new A7 tests + 2 existing-test rx-seed updates |
| `docs/adr/0011-a7-rx-capture.md` | +this addendum | Scope reconciliation |

BillingScreen UI rx-capture flow was pre-existing on `main` (added in A6 scaffolding); no UI changes needed in this PR.
