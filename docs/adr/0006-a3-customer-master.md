# ADR 0006 — A3 Customer Master (directory-repo)

Status: Accepted
Date: 2026-04-16
Owner: Sourav Shaw
Playbook: v2.0 Final §8.1, §8.8 (DPDP consent fields), ADR 0004 row A3
Implements: FR-A3-* (customer master, walk-in default, doctor registry, Rx linkage)

## Context

ADR 0004 (A1–A16 POS Readiness Plan) row A3 specifies a customer master table
that supports:

1. **Walk-in-by-default** — F2 (bill-line entry) is the hot path; cashiers do
   not stop to pick a customer on every bill. The UI must auto-select a
   walk-in row when nothing is chosen. We must not create a "null customer_id"
   code path — every bill has a real FK.
2. **Phone-first lookup at p95 < 10 ms on 10 k rows** — when the cashier
   *does* type a phone number, the lookup must feel instant even on a 4 GB /
   HDD Windows 7 shop. Marg takes 1–3 s here; we commit to sub-10 ms.
3. **Indian phone number polymorphism** — `+91 98220 01122`, `91-9822001122`,
   `(982) 200-1122`, `9822001122` must all match the same customer. Phone
   numbers enter the DB via Gmail-imported invoices (X1), WhatsApp bills,
   handwritten slips, and keyboard typing. We cannot trust the input format.
4. **Doctor registry with reg-no validation** — Schedule H/H1/X sales bind
   a prescription to a registered doctor. India has dozens of council formats
   (NMC, MCI legacy, MH-41234, KA/MED/1234, DMC/R-12345). A strict allow-list
   would reject legitimate registrations; a blank-string policy would let
   untrained cashiers skip the field entirely.
5. **DPDP Act §5 consent** — marketing comms and ABDM linkage each need a
   separate, explicit, revocable consent flag. Already shipped on the
   `customers` table in migration 0002 (`consent_marketing`, `consent_abdm`);
   A3 must preserve this.

The table skeleton already exists from migration 0002. A3 adds the lookup
infrastructure, the walk-in convention, the doctor table, and the
prescription link.

## Decision

### D1 — `phone_norm` as a stored column, populated by AFTER triggers

We add a `phone_norm TEXT` column + `idx_customers_phone_norm (shop_id, phone_norm)`
and keep it in sync via two triggers: `trg_customers_phone_norm_ai` (after
INSERT) and `trg_customers_phone_norm_au` (after UPDATE OF phone). The
normalization is deterministic: strip every non-digit, take the last 10 digits,
or NULL if fewer than 10 remain.

A one-shot backfill UPDATE at the end of the migration handles any
pre-existing rows.

### D2 — Walk-in convention via deterministic primary key `cus_walkin_{shop_id}`

Every shop gets one walk-in customer row whose id is derived from its
shop id. `ensureWalkInCustomer(db, shopId)` is idempotent
(`ON CONFLICT(id) DO NOTHING`) and is called from the seed-tool and from
the desktop bootstrap.

F2 resolves "no customer selected" by calling `walkInIdForShop(shopId)` —
a pure string function, no DB round-trip.

### D3 — Permissive doctor regNo validator

`validateDoctorRegNo` enforces: 3–40 chars, alphanumeric + `/ - . space`
only, must start/end with alphanumeric, must contain at least one digit.
No format-specific allow-list.

### D4 — Single `prescriptions` link table (customer × doctor × image × notes)

One row per prescription, FK to both customer and doctor. `image_path` is
the filename on the shared scan folder (X3 OCR attaches later). No
embedded binary in SQLite.

### D5 — Shop-scoped phone index, not global

`idx_customers_phone_norm (shop_id, phone_norm)` is composite. Lookups
always filter by `shop_id` first.

### D6 — Insert on conflict semantics for customers

`upsertCustomer` uses `ON CONFLICT(id) DO UPDATE` — callers deciding
"same customer or new" happens one layer up (F2 UI picks by phone_norm
match first).

## Consequences

Positive:

- **Perf gate met with 416x headroom**: p50 = 0.011 ms, p95 = 0.024 ms on
  10 000-row seed (gate 10 ms). Evidence: `docs/evidence/a3/perf.json`.
- **Index verified via `EXPLAIN QUERY PLAN`** assertion in `index.test.ts`
  — the query plan string must contain `idx_customers_phone_norm`; if a
  future migration drops the index or a future query regression uses a
  full-table scan, the test fails.
- **No format wars**: the cashier pastes whatever they have. X1 (Gmail
  import) does the same. Everything converges on the last-10-digit canon.
- **Walk-in FK is honest**: every bill has a real customer row; reports,
  analytics, and audit logs do not special-case NULL.
- **Doctor regNo accepts reality**: `MH-41234`, `NMC/12345`, `12345/DMC/R`,
  `KA MED 12345` all validate; `abc`, `""`, `123`, `<script>` do not.

Negative / accepted trade-offs:

- `phone_norm` costs one write per customer INSERT/UPDATE. At shop scale
  (< 50 k customers per shop lifetime) this is noise.
- The AFTER-trigger pattern means `phone_norm` is visible only *after*
  the statement commits — we cannot `SELECT phone_norm` inside the same
  `INSERT ... RETURNING`. Acceptable: every caller that needs `phone_norm`
  either re-fetches or normalizes in app code.
- Permissive regNo means a bad actor can type `ABC/12` and pass. We
  accept this — the cashier has a retail license on the wall and the
  register has an audit log; format validation is a typo guard, not a
  compliance control.

## Alternatives Considered

A1. **Normalize phone in app code only, no stored column, query with
    `WHERE REPLACE(REPLACE(phone, ...))`**. Rejected: no index usable,
    full-table scan on 10 k rows breaks the p95 gate.

A2. **BEFORE INSERT trigger to set NEW.phone_norm**. Rejected: SQLite
    BEFORE triggers cannot assign NEW. (Tested and confirmed via
    `sqlite3_version 3.46`.)

A3. **Generated column `phone_norm AS (...)`**. Rejected: SQLite generated
    columns with `INDEXED BY` work, but the normalization expression
    (nested REPLACEs for 8 separators + substr) is ugly inline and
    future-proofing for a 9th separator requires an ALTER. Triggers let
    us keep the expression in one place and ALTER it with a new migration.

A4. **`is_walk_in` boolean column + nullable customer_id on bills**.
    Rejected: introduces a null-code-path everywhere customer data is
    read. Deterministic-id convention keeps FKs honest.

A5. **Strict NMC-online reg-no validation**. Rejected: requires live API
    call against nmc.org.in, blocks offline-first rule (§8.8 LAN-first).
    Deferred to X1 Phase 3 as an optional background verification.

A6. **Global phone index (no shop_id prefix)**. Rejected: franchise
    parent/worker architecture (§8.1) means one SQLite file can host
    multiple shop_ids in the future; global index leaks across shops.

## Supersedes / Superseded-by

- Supersedes: (none — A3 was not yet implemented).
- Extends: ADR 0002 (SQLite schema runtime), migration 0002
  (customers/doctors/prescriptions table skeletons).
- Superseded-by: (none).

## Acceptance-gate evidence (ADR 0004 row A3)

- [x] `customers` phone-indexed — migration 0009, `idx_customers_phone_norm`.
- [x] Walk-in default row auto-selectable — `walkInIdForShop(shopId)` pure fn.
- [x] Doctor registry with reg-no format validator — `validateDoctorRegNo`.
- [x] Phone lookup p95 < 10 ms on 10 k rows — p95 = 0.024 ms (416x headroom).
- [x] Index usage asserted in test — `EXPLAIN QUERY PLAN` contains
  `idx_customers_phone_norm`.
- [x] DPDP consent fields preserved — `consent_marketing`, `consent_abdm`
  unchanged from migration 0002.

