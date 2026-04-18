# ADR 0021 — A8 Partial Refund (Line-Level Returns with Pro-Rata GST Reversal)

> **STATUS: DRAFT — NOT APPROVED**
>
> _Authored 2026-04-18. Not merged. Do not implement against this document yet._
> _Revisions expected on (a) discount apportionment, (b) >30-day refund policy,
> (c) cash-to-credit-note tender fallback rules._

**Status:** DRAFT — NOT APPROVED
**Date:** 2026-04-18
**Supersedes:** —
**Superseded by:** —
**Relates to:**
- ADR 0010 (A6 bill-core — `bills`/`bill_lines`/`audit_log`, NPPA cap, line paise invariants)
- ADR 0011 (A7 Rx capture — Schedule H/H1/X gate, rx_id FK)
- ADR 0012 (A8 payment — `payments` table, tender modes `cash|upi|card|credit|wallet`, `TENDER_TOLERANCE_PAISE = 50`)
- ADR 0013 (A13 expiry guard — batch expiry block, `expiry_override_audit` 10-min owner window)
- ADR 0014 (A9 invoice-print — credit-note layout required)
- ADR 0015 (A10 GSTR-1 — credit-note rows in `cdnr` / `cdnur` sections)
- ADR 0017 (A12 e-invoice IRN — 24h cancel window, reason codes 1-4, credit-note NIC type)
- Playbook v2.0 §0 (keyboard-first <2s), §7 (ADR template), §8.8 (auto-compliance gates), §12 (second-vendor plan)

---

## Context

### What exists today (A8 + A13 scope)
- **A8 (ADR 0012)** shipped the billing save path with split-tender support:
  `bills` + `bill_lines` + `payments` + `audit_log` persisted in a single transaction
  via `save_bill` (Rust `commands.rs:232`, TS mirror `packages/bill-repo/src/index.ts:336`).
  Tender modes are locked to `cash|upi|card|credit|wallet`.
- **A13 (ADR 0013)** shipped **full-bill returns** — a whole bill can be voided /
  returned via `ReturnsScreen.tsx`, with stock replenishment through
  `stock_movements.movement_type='return'`. The Returns screen also hosts the
  GSTR-1 export flow (A10) and the IRN-records tab (A12).
- **What A8 did NOT ship:** partial refunds. If a customer returns 2 strips of
  a 10-strip Crocin line (or one damaged strip out of five), today's only option
  is to void the whole bill and re-bill — which destroys audit trail, invalidates
  the original IRN, and forces cashback reconciliation off-book.

### Why partial refunds are non-negotiable for a pharmacy POS
1. **Pharmacy reality.** Returns in a retail pharmacy are overwhelmingly
   line-level, not bill-level:
   - Customer returns half a strip (5 tabs out of 10) because doctor changed dose.
   - Patient returns one full box out of three because the family already had one.
   - Damaged line discovered at home (blister burst, seal broken) — just that line.
   - Unused prescription medicines returned within expiry (chronic-illness patients
     stocking up, then change of regimen).
2. **GST compliance — pro-rata tax reversal.** Per CGST Rules 2017 rule 53 +
   section 34 of the CGST Act, any supply-value reduction must be accompanied by
   a **credit note** that reverses the exact proportional CGST/SGST/IGST that was
   originally charged on the returned quantity. Marg / BUSY / Tally all do this
   at line level. Doing it at bill level (our current gap) means either:
   - We over-refund tax (we reverse 100% of a line's tax when only 20% was
     returned) → GSTR-1 mismatch at auto-reconciliation, demand notice risk; or
   - We under-refund tax (we reverse nothing because partial not supported) →
     customer refund is short by the GST component, consumer complaint.
3. **E-invoice constraint.** Per GSTN NIC rules (ADR 0017), a B2B bill with a
   live IRN can be **cancelled only within 24 hours**, and only for reason codes
   1-4 (duplicate / data-entry / order-cancelled / other). After that 24h
   window closes, the only legal adjustment is a **credit note** with its own
   IRN (NIC type `CRN`). Today we have no path to emit that credit note.
4. **Schedule H / H1 / X implications.** A partial return of a prescription
   medicine still requires Rx traceability (D&C Rules 1945, rule 65). We must
   block a Rx-line partial return if the original bill had no `rx_id`, and we
   must record the return against the same `rx_id` so the 2-year retention
   ledger stays intact.
5. **NPPA / DPCO.** Refund price per unit must not exceed the original MRP on
   the bill (always true mechanically, but must be asserted — a data-entry slip
   could refund more than was charged).
6. **Expiry at return time.** If the batch has since expired (stocked out and
   back in the returns window happens to coincide with the expiry cliff), we
   cannot legally re-sell it. We can still accept the return for goodwill but
   must flag the batch as non-salable — stock movement goes to
   `movement_type='return_to_expired_quarantine'`, not `return`. Owner override
   required to accept such a return without quarantine flag (matches A13 §3 pattern).

### Why this is deferred from A8 and landing as its own ADR
A8's scope was **forward path** (sale → payment). A13 handled the blunt instrument
(full void). Partial refunds sit at the intersection of A6 (bill compute),
A7 (Rx gate), A10 (GSTR-1), A12 (IRN/credit note), A13 (returns shell) — and
needs its own data model, command surface, UI flow, and compliance story.
The Playbook v2.0 deferred-items register (A8 row) explicitly calls out
"partial refunds — see ADR 0021 (pending)".

---

## Decision

### 1. Data model — separate `return_headers` + `return_lines`

We **do NOT** reuse the existing full-return marker (`bills.is_voided`) for
partial refunds. Reasons:
- `is_voided` is boolean; partial refund is a per-line quantity.
- A single bill may have **multiple partial-refund events** over its lifetime
  (customer returns 2 strips today, 1 more next week). We need an audit trail
  per event.
- GSTR-1 `cdnr` section needs one row per credit note, not one row per bill.

New schema:

**`return_headers`** — one row per return event (partial or full).
- `id` (TEXT PK)
- `original_bill_id` (TEXT FK → `bills.id`)
- `shop_id` (TEXT FK → `shops.id`, denormalised for period queries)
- `return_no` (TEXT — shop-scoped credit-note number, `CN/2026-27/0001`)
- `return_type` (TEXT CHECK IN `'partial'|'full'` — full = every line returned in one header)
- `reason` (TEXT ≥ 4 chars)
- `tender_summary_json` (TEXT — JSON array of `{mode, amount_paise}` reversed, mirror of A8 `payments`)
- `refund_total_paise` (INTEGER CHECK ≥ 0)
- `refund_cgst_paise` / `refund_sgst_paise` / `refund_igst_paise` / `refund_cess_paise` (INTEGER)
- `refund_round_off_paise` (INTEGER, bounded ±50 paise per A8 invariant)
- `credit_note_irn` (TEXT NULL — set by the A12 async submitter if bill was IRN'd)
- `credit_note_ack_no` / `credit_note_ack_date` / `credit_note_qr_code` (TEXT NULL)
- `einvoice_status` (TEXT CHECK IN `NULL|'n/a'|'pending'|'submitted'|'acked'|'cancelled'|'failed'`)
- `created_at` / `created_by` (TEXT FK → `users.id`)

**`return_lines`** — one row per bill_line that was partially or fully returned in this event.
- `id` (TEXT PK)
- `return_id` (TEXT FK → `return_headers.id` ON DELETE CASCADE)
- `bill_line_id` (TEXT FK → `bill_lines.id`) — links back to the exact line on the original bill
- `batch_id` (TEXT FK → `batches.id`) — same as original bill_line's batch; denormalised for stock movement speed
- `qty_returned` (REAL CHECK > 0)
- `refund_taxable_paise` (INTEGER) — pro-rata of original `bill_lines.taxable_value_paise`
- `refund_discount_paise` (INTEGER) — pro-rata of original line discount
- `refund_cgst_paise` / `refund_sgst_paise` / `refund_igst_paise` / `refund_cess_paise` (INTEGER)
- `refund_amount_paise` (INTEGER CHECK > 0) — line total refund (taxable − discount + all tax)
- `reason_code` (TEXT CHECK IN `'customer_change_of_mind'|'damaged'|'wrong_sku'|'doctor_changed_rx'|'expired_at_return'|'other'`)

Constraints:
- `CHECK (qty_returned <= original_qty)` — enforced by trigger that looks up `bill_lines.qty - SUM(prior return_lines)`.
- `UNIQUE(return_id, bill_line_id)` — one line can only appear once per return event.
- `CHECK (refund_amount_paise <= bill_lines.line_total_paise * qty_returned / bill_lines.qty + 50)` — NPPA-style upper-bound (not over-refunding), ±50 paise rounding slack.

Reuse:
- `stock_movements` — one row per `return_lines` with `movement_type='return'` and `qty = +qty_returned`, same batch.
- `payments` — we do NOT insert negative-amount `payments` rows (the CHECK `amount_paise > 0` would fail). Instead, reversals are recorded in `return_headers.tender_summary_json` + a new audit row (see §6 below).
- `audit_log` — one row per `return_headers` insert with entity=`return_header`, action=`create`, payload = full JSON blob.

### 2. Tender reversal — default to original tender, proportional on split, fallback to store-credit-note

**Rules (applied in order):**
1. If the original bill had a **single tender** (`bills.payment_mode != 'split'`),
   refund to that same tender. Cash → cash-back from drawer. UPI → reversal via
   same UPI (cashier keys ref_no manually, same as original). Card → mode noted,
   reversal happens via the card machine off-POS. Credit → `customer.credit_limit`
   is incremented back.
2. If the original bill was **split** (N tenders), refund **proportionally** per
   tender in the same ratio as the original amounts, rounded half-away-from-zero
   at paise, with the residual absorbed by the largest-amount tender to keep
   sum-invariance. Example: bill ₹1000 = ₹600 UPI + ₹400 cash; refund of ₹250
   → ₹150 UPI + ₹100 cash.
3. **Cash-tender fallback.** If the original tender was **UPI** and the cashier
   cannot immediately reverse (end of day, PG bank holiday, customer has no UPI
   handle to hand), owner may override to **store credit note** — a new tender
   mode `credit_note` issued against the customer master, redeemable against
   future bills. This is NOT the same as `credit` (store-credit = pre-issued
   limit). Requires migration to add `credit_note` to the `payments.mode` CHECK
   enum and a new table `credit_notes` (id, customer_id, issued_from_return_id,
   balance_paise). Deferred to ADR 0022 — for 0021 we **block** this case with
   error `REFUND_TENDER_UNAVAILABLE:upi_unreachable` and require the cashier to
   retry later.
4. **Card tenders** use the same off-POS reversal path as today — cashier marks
   "reversed on card machine" with a ref_no; the `return_headers.tender_summary_json`
   stores it verbatim.

### 3. GST reversal — line-level, pro-rata, not bill-level

Pro-rata formula per line (all integer paise):
```
refund_taxable = round_half_away_from_zero(
    bill_lines.taxable_value_paise * qty_returned / bill_lines.qty
)
refund_cgst    = same formula against bill_lines.cgst_paise
refund_sgst    = same formula against bill_lines.sgst_paise
refund_igst    = same formula against bill_lines.igst_paise
refund_cess    = same formula against bill_lines.cess_paise
refund_amount  = refund_taxable - refund_discount + refund_cgst + refund_sgst + refund_igst + refund_cess
```
Rounding policy matches A4 tax-engine (`@pharmacare/gst-engine.computeLine`) —
half-away-from-zero at paise. The sum of all `return_lines.refund_amount_paise`
plus `return_headers.refund_round_off_paise` (bounded ±50 paise) equals
`return_headers.refund_total_paise`.

**Discount apportionment (OPEN QUESTION — see §10):**
For v1 of this ADR we propose: refund_discount is pro-rata on
`bill_lines.discount_paise` by qty ratio. This preserves the invariant that
the post-refund bill (original − return) still has coherent line math.
An alternative is "absorb discount on the retained portion" (customer got the
discount on what they kept, so no refund of discount) — simpler but harder to
justify if the discount was line-level.

### 4. IRN / credit-note logic

Decision tree, evaluated at `save_partial_return` time:

```
if bill.einvoice_status in (NULL, 'n/a'):
    # bill was below turnover threshold or e-invoice disabled.
    return_header.einvoice_status = 'n/a'
    # GSTR-1 cdnur section gets this credit note next cycle (A10 auto-include)

elif bill.einvoice_status == 'acked' and now - bill.ack_date < 24h and return_type == 'full':
    # Prefer IRN CANCEL — simpler, refunds the whole bill cleanly.
    # (This path is A13's existing full-void. A8 partial refund sticks to credit note.)
    delegate to A13 void flow

elif bill.einvoice_status == 'acked':
    # Past 24h OR partial return OR original was acked B2B.
    # Must emit a credit note with its own IRN (NIC type 'CRN').
    return_header.einvoice_status = 'pending'
    async worker submits CRN payload to Cygnet; 5 attempts w/ back-off per ADR 0017 §5

elif bill.einvoice_status == 'cancelled':
    # Original bill's IRN is dead. No credit note possible — the GSTN system sees
    # no original to credit. We refund locally, and GSTR-1 export EXCLUDES this
    # return from cdnr (matches the bill's exclusion). Audit row flags it.
    return_header.einvoice_status = 'n/a'
    audit_log payload includes original_einvoice_status = 'cancelled'

else:  # pending / submitted / failed
    # IRN not yet acked — credit note is premature.
    block with error IRN_NOT_ACKED; cashier retries after the async submitter finalises.
```

Rationale: piggybacks on the adapter trait landed in ADR 0017. Credit-note
payloads differ from invoice payloads only in `DocDtls.Typ='CRN'` and a
`PrecDocDtls` block referencing the original IRN + doc number.

### 5. Schedule H / H1 / X gate

Mirrors A7 (ADR 0011) exactly:

- If any `bill_lines.product_id` being returned has `products.schedule` in
  `('H','H1','X','NDPS')` **and** the original `bills.rx_id` is NULL,
  **block** the partial return with `RX_MISSING_ON_ORIGINAL_BILL` (this should
  never happen — saveBill already blocks — but defence in depth).
- If the original bill HAD an rx_id but the prescription has been deleted or
  the `retention_until` date has passed and the prescription was purged, block
  with `RX_RETENTION_EXPIRED`.
- The return event is recorded against the same `rx_id` for retention ledger
  continuity. D&C Rules 1945 r.65 — retention of the Rx covers the sale AND
  any post-sale adjustment.

### 6. NPPA / DPCO price invariant

Trigger `trg_return_lines_nppa_cap`:
```sql
CREATE TRIGGER trg_return_lines_nppa_cap
BEFORE INSERT ON return_lines
BEGIN
  SELECT CASE
    WHEN NEW.refund_amount_paise > (
      SELECT (bl.line_total_paise * NEW.qty_returned / bl.qty) + 50
      FROM bill_lines bl WHERE bl.id = NEW.bill_line_id
    )
    THEN RAISE(ABORT, 'NPPA_REFUND_EXCEEDS_ORIGINAL')
  END;
END;
```
Always true by construction (refund = pro-rata of original) but asserted so
any future hand-crafted refund path cannot bypass it.

### 7. Expiry at return time

At return save:
- Look up `batches.expiry_date` for each line's batch.
- If `expiry_date < today`: require an `expiry_override_audit` row in the last
  10 minutes by the acting user with role=`owner` (reuse A13 §3 pattern). On
  success, set `stock_movements.movement_type = 'return_to_expired_quarantine'`
  and flag the line with `return_lines.reason_code = 'expired_at_return'`.
  Stock movement increments quarantine count, NOT salable count.
- If not expired: normal `movement_type='return'`, increments salable.

### 8. Stock replenishment

One `stock_movements` row per `return_lines` row:
- `qty = +qty_returned` (positive, batch goes back into stock)
- `movement_type = 'return'` (or `return_to_expired_quarantine`)
- `ref_entity = 'return_line'`
- `ref_id = return_lines.id`

Reuse the existing `trg_stock_movements_update_batch_qty` trigger from migration
0007 — no new stock-side logic needed.

---

## Migration 0019 — schema DDL (draft, not for execution)

Four new tables + three indexes + two triggers + one audit-log marker.

```sql
-- Migration 0019 · A8 Partial Refund (ADR 0021)
-- Line-level returns, pro-rata GST reversal, credit-note IRN.
-- DRAFT — NOT FOR EXECUTION. See ADR 0021 for context.

-- ---------------------------------------------------------------------------
-- 1. return_headers — one row per refund event.
-- ---------------------------------------------------------------------------
CREATE TABLE return_headers (
  id                         TEXT PRIMARY KEY,
  original_bill_id           TEXT NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
  shop_id                    TEXT NOT NULL REFERENCES shops(id),
  return_no                  TEXT NOT NULL,
  return_type                TEXT NOT NULL CHECK (return_type IN ('partial','full')),
  reason                     TEXT NOT NULL CHECK (length(trim(reason)) >= 4),
  tender_summary_json        TEXT NOT NULL,            -- JSON array [{mode,amount_paise,ref_no?}]
  refund_total_paise         INTEGER NOT NULL CHECK (refund_total_paise >= 0),
  refund_cgst_paise          INTEGER NOT NULL DEFAULT 0,
  refund_sgst_paise          INTEGER NOT NULL DEFAULT 0,
  refund_igst_paise          INTEGER NOT NULL DEFAULT 0,
  refund_cess_paise          INTEGER NOT NULL DEFAULT 0,
  refund_round_off_paise     INTEGER NOT NULL DEFAULT 0
                             CHECK (refund_round_off_paise BETWEEN -50 AND 50),
  credit_note_irn            TEXT,
  credit_note_ack_no         TEXT,
  credit_note_ack_date       TEXT,
  credit_note_qr_code        TEXT,
  einvoice_status            TEXT CHECK (einvoice_status IN
                              (NULL,'n/a','pending','submitted','acked','cancelled','failed')),
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by                 TEXT NOT NULL REFERENCES users(id),
  UNIQUE (shop_id, return_no)
);

CREATE INDEX idx_return_headers_bill ON return_headers(original_bill_id);
CREATE INDEX idx_return_headers_shop_created ON return_headers(shop_id, created_at);
CREATE INDEX idx_return_headers_einvoice ON return_headers(einvoice_status)
  WHERE einvoice_status IN ('pending','failed');

-- ---------------------------------------------------------------------------
-- 2. return_lines — one row per (return_event × bill_line).
-- ---------------------------------------------------------------------------
CREATE TABLE return_lines (
  id                      TEXT PRIMARY KEY,
  return_id               TEXT NOT NULL REFERENCES return_headers(id) ON DELETE CASCADE,
  bill_line_id            TEXT NOT NULL REFERENCES bill_lines(id) ON DELETE RESTRICT,
  batch_id                TEXT NOT NULL REFERENCES batches(id),
  qty_returned            REAL NOT NULL CHECK (qty_returned > 0),
  refund_taxable_paise    INTEGER NOT NULL CHECK (refund_taxable_paise >= 0),
  refund_discount_paise   INTEGER NOT NULL DEFAULT 0,
  refund_cgst_paise       INTEGER NOT NULL DEFAULT 0,
  refund_sgst_paise       INTEGER NOT NULL DEFAULT 0,
  refund_igst_paise       INTEGER NOT NULL DEFAULT 0,
  refund_cess_paise       INTEGER NOT NULL DEFAULT 0,
  refund_amount_paise     INTEGER NOT NULL CHECK (refund_amount_paise > 0),
  reason_code             TEXT NOT NULL CHECK (reason_code IN (
                            'customer_change_of_mind','damaged','wrong_sku',
                            'doctor_changed_rx','expired_at_return','other')),
  UNIQUE (return_id, bill_line_id)
);

CREATE INDEX idx_return_lines_bill_line ON return_lines(bill_line_id);
CREATE INDEX idx_return_lines_batch ON return_lines(batch_id);

-- ---------------------------------------------------------------------------
-- 3. credit_notes — issued when tender reversal cannot go back to source.
--    Minimal scaffold; full flow is ADR 0022. Here we only reserve the shape.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_notes (
  id                      TEXT PRIMARY KEY,
  customer_id             TEXT NOT NULL REFERENCES customers(id),
  issued_from_return_id   TEXT NOT NULL REFERENCES return_headers(id),
  issued_amount_paise     INTEGER NOT NULL CHECK (issued_amount_paise > 0),
  balance_paise           INTEGER NOT NULL CHECK (balance_paise >= 0),
  expires_at              TEXT,                       -- NULL = no expiry
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_credit_notes_customer ON credit_notes(customer_id);

-- ---------------------------------------------------------------------------
-- 4. einvoice_audit — append-only record of credit-note IRN attempts.
--    (Mirror of the einvoice_audit table from migration 0016; reused via
--     entity_kind='credit_note' instead of 'bill'. If migration 0016 already
--     makes einvoice_audit general, this block is a no-op.)
-- ---------------------------------------------------------------------------
-- NOTE: verify against migration 0016 before merging; may be a no-op.

-- ---------------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------------

-- 5.1 Enforce qty_returned <= remaining refundable qty on bill_line.
CREATE TRIGGER trg_return_lines_qty_limit
BEFORE INSERT ON return_lines
BEGIN
  SELECT CASE
    WHEN NEW.qty_returned > (
      SELECT bl.qty - COALESCE(SUM(rl.qty_returned), 0)
      FROM bill_lines bl
      LEFT JOIN return_lines rl ON rl.bill_line_id = bl.id
      WHERE bl.id = NEW.bill_line_id
      GROUP BY bl.id
    )
    THEN RAISE(ABORT, 'QTY_EXCEEDS_REFUNDABLE')
  END;
END;

-- 5.2 Enforce NPPA: refund_amount_paise cannot exceed pro-rata of original
--     line_total_paise + 50 paise slack.
CREATE TRIGGER trg_return_lines_nppa_cap
BEFORE INSERT ON return_lines
BEGIN
  SELECT CASE
    WHEN NEW.refund_amount_paise > (
      SELECT CAST(bl.line_total_paise * NEW.qty_returned / bl.qty AS INTEGER) + 50
      FROM bill_lines bl WHERE bl.id = NEW.bill_line_id
    )
    THEN RAISE(ABORT, 'NPPA_REFUND_EXCEEDS_ORIGINAL')
  END;
END;

-- 5.3 Stock movement insert on return_lines insert.
--     Uses 'return' for normal refund, 'return_to_expired_quarantine' for
--     expired-at-return (reason_code discriminator).
CREATE TRIGGER trg_return_lines_stock_movement
AFTER INSERT ON return_lines
BEGIN
  INSERT INTO stock_movements (id, batch_id, qty, movement_type, ref_entity, ref_id, created_at)
  VALUES (
    'sm_' || NEW.id,
    NEW.batch_id,
    NEW.qty_returned,
    CASE WHEN NEW.reason_code = 'expired_at_return'
         THEN 'return_to_expired_quarantine'
         ELSE 'return' END,
    'return_line',
    NEW.id,
    strftime('%Y-%m-%dT%H:%M:%fZ','now')
  );
END;

-- ---------------------------------------------------------------------------
-- 6. Audit log seeding is done by the Rust save_partial_return command, not by
--    trigger — payload construction is too complex for SQL.
-- ---------------------------------------------------------------------------
```

**Table count contributed by migration 0019: 3 new tables (`return_headers`,
`return_lines`, `credit_notes`) + 3 triggers + 5 indexes.** (The
`einvoice_audit` block is conditional on migration 0016's shape; may be zero.)

---

## New Tauri commands

All exported from `apps/desktop/src-tauri/src/commands.rs`, mirrored in
`packages/bill-repo/src/index.ts` for host-side (test) use.

### `save_partial_return(input: SavePartialReturnInput) -> Result<SavePartialReturnResult, String>`

Input:
```rust
pub struct SavePartialReturnInput {
    pub return_id: String,
    pub shop_id: String,
    pub return_no: String,
    pub original_bill_id: String,
    pub reason: String,
    pub actor_user_id: String,
    pub lines: Vec<PartialReturnLineInput>,
    pub tender_plan: Vec<ReturnTender>,      // cashier's chosen tender breakdown
}
pub struct PartialReturnLineInput {
    pub bill_line_id: String,
    pub qty_returned: f64,
    pub reason_code: String,                  // one of the 6 CHECK values
}
pub struct ReturnTender {
    pub mode: String,                         // cash|upi|card|credit|wallet|credit_note
    pub amount_paise: i64,
    pub ref_no: Option<String>,
}
```
Result:
```rust
pub struct SavePartialReturnResult {
    pub return_id: String,
    pub refund_total_paise: i64,
    pub einvoice_status: Option<String>,      // 'pending' if CRN queued, 'n/a' otherwise
    pub credit_note_issued_id: Option<String>,
}
```
Errors (string-reason-coded, matches A6/A8 convention):
- `QTY_EXCEEDS_REFUNDABLE:bill_line=...`
- `RX_MISSING_ON_ORIGINAL_BILL:product_id=...`
- `RX_RETENTION_EXPIRED:rx_id=...`
- `EXPIRED_AT_RETURN_NO_OVERRIDE:batch=...`
- `NPPA_REFUND_EXCEEDS_ORIGINAL:bill_line=...`
- `REFUND_TENDER_UNAVAILABLE:upi_unreachable`
- `TENDER_MISMATCH:sum=...:refund_total=...:diff=...`
- `IRN_NOT_ACKED:bill=...` (if original IRN still pending/submitted)
- `FORBIDDEN:role=...` (non-owner attempting credit_note mode)

### `list_returns_for_bill(bill_id: String) -> Vec<ReturnHeaderRow>`

Returns header-level summary per partial return event, ordered `created_at ASC`.
Used by BillingScreen (show "3 partial returns recorded" pill on historic bills)
and by ReturnsScreen.

### `get_refundable_qty(bill_line_id: String) -> f64`

Returns `bill_lines.qty - SUM(return_lines.qty_returned)`. Used by the picker
UI to show remaining refundable quantity per line. Zero means fully returned.

### `record_credit_note_irn(return_id, irn, ack_no, ack_date, qr_code)`

Invoked by the background async worker (ADR 0017 §5 schedule) when the CRN
submission succeeds. Writes back to `return_headers.*` and flips
`einvoice_status` to `'acked'`. Same retry / back-off envelope as the A12
invoice-IRN worker.

---

## UX — keyboard-first per Playbook §0

**Entry point.** From `ReturnsScreen` (the GSTR-1/IRN screen), pressing **F4**
opens the partial-refund picker.

**Flow:**
1. **F4** → `PartialReturnPicker` modal.
2. Cashier types bill number or scans QR from the original invoice
   (invoice-print A9 already emits QR). `Enter` loads the bill.
3. `PartialReturnTable` renders, one row per `bill_lines`:
   ```
   [SKU]   [Batch]  [Orig qty]  [Returnable]  [Return qty]  [Reason]  [Refund ₹]
   ```
   - `Return qty` is a numeric input; `Reason` is a select with the six codes.
   - Tab / Shift-Tab moves between cells. `F7` on a row sets `return qty = returnable`
     (return-in-full-this-line shortcut).
4. **F6** opens the TenderReversalModal (reuses the A8 PaymentModal shell
   in "reverse" mode — same Alt+1/2/3/4 hotkeys). Default is per §2 rules.
   Cashier can override before saving.
5. **F9** → `save_partial_return`. Spinner → success toast → printed credit note
   (A9 renderer, credit-note layout).
6. **Esc** cancels at any step.

**Performance budget:** F4 press → save-success toast ≤ **2 s** on a realistic
10-line bill (matches Playbook §0 keyboard-path constraint).

**Printer fallback:** if thermal printer is offline, credit note queues in
`print_audit` (A9 pattern) and the cashier sees a "reprint later" chip.

---

## Compliance gates (Playbook §8.8)

| Gate | Where enforced | Error code |
|---|---|---|
| Rx required on original bill for H/H1/X lines being returned | Rust `save_partial_return` + TS mirror | `RX_MISSING_ON_ORIGINAL_BILL` |
| Rx retention still valid | Rust re-reads `prescriptions.retention_until` | `RX_RETENTION_EXPIRED` |
| Expired-batch return requires owner override | Rust + reuse `expiry_override_audit` | `EXPIRED_AT_RETURN_NO_OVERRIDE` |
| Refund ≤ original (NPPA invariant) | DB trigger `trg_return_lines_nppa_cap` | `NPPA_REFUND_EXCEEDS_ORIGINAL` |
| Qty_returned ≤ refundable | DB trigger `trg_return_lines_qty_limit` | `QTY_EXCEEDS_REFUNDABLE` |
| Credit-note IRN submitted within GSTR-1 cycle | A10 GSTR-1 export auto-includes `cdnr`/`cdnur` rows | (export-level warning, not blocker) |
| 24h IRN cancel vs credit-note choice | Rust decision tree §4 | `IRN_NOT_ACKED` if original not acked |
| Owner role for expired-at-return or credit_note tender | Rust role check | `FORBIDDEN` |

**GSTR-1 auto-inclusion.** The A10 `generateGstr1` pipeline is extended to pull
`return_headers` where `einvoice_status NOT IN ('cancelled')` and
`created_at` within period. Each becomes a row in `cdnr` (if original bill was
B2B / had buyer GSTIN) or `cdnur` (if B2CL with inter-state > ₹2.5L) or a
reduction row in `b2cs` (if below threshold). Test coverage added to
`@pharmacare/gstr1` golden fixtures.

---

## Alternatives considered

1. **Full-bill-void + re-bill (Marg's approach).** Rejected. Destroys audit
   trail, invalidates the original IRN unnecessarily, forces cashback
   reconciliation off-book, and fails GSTR-1 auto-reconciliation because the
   original line disappears from the filed period. Also creates customer
   confusion ("Why is my original bill gone?").
2. **Negative-quantity lines in a new bill ("inverse bill").** Rejected.
   Violates multiple A6 line invariants: `bill_lines.qty` is declared `> 0` by
   CHECK; `line_total_paise > 0` by CHECK. GST engine would need sign-aware
   math everywhere (line_total_paise could be negative), blast radius too big.
   Also breaks HSN summary (HSN taxable becomes signed, GSTR-1 exporter chokes).
3. **Store-only refund — no GSTR-1 trace.** Rejected. This is the "paper-slip
   refund" pattern of small pharmacies; it is a compliance violation (GST
   section 34) and loses the moat we are building.
4. **Single `returns` table shared with A13 full-void.** Considered. Rejected
   because `return_headers.return_type = 'full'` already covers A13's concept
   and a future migration can backfill existing voids into `return_headers`
   without schema churn. But we do NOT block on that backfill for 0021 MVP.
5. **Defer credit-note IRN to a later ADR.** Rejected — the whole point of A12
   was to make e-invoice a first-class auto-flow; a partial refund on a B2B
   acked bill without a CRN IRN is an immediate non-compliance.

---

## Consequences

### Positive
- **GST compliance.** Pro-rata CGST/SGST/IGST reversal closes the A8 compliance
  gap that would otherwise surface on the first partial return a pilot shop
  attempts.
- **Audit trail preserved.** Original bill and its IRN remain intact; return
  is a sibling record — GSTR-1 reconciliation stays linear.
- **Feature parity with Marg+ and BUSY.** Line-level refund is a table-stakes
  feature; not shipping it blocks pilot sign-offs.
- **Customer trust.** Correct refund arithmetic (incl. GST) = no consumer
  complaints, no social-media "pharmacy cheated me on GST" stories.
- **Reuse.** Stock movement, expiry override, Rx gate all reuse existing A13/A7
  infrastructure. Net new code is focused on the return path itself.

### Negative
- **New migration complexity.** Three tables + triggers + indexes; non-trivial.
- **Credit-note IRN is a known-bug nest.** NIC schema for CRN has its own quirks
  (`PrecDocDtls` validation, date format pitfalls). Expect adapter bug fixes
  over the first 3 pilot weeks.
- **GSTR-1 export diff.** The A10 pipeline gets a new input source
  (`return_headers`). Golden fixtures regenerate; test vectors double.
- **UX surface grew.** ReturnsScreen now has three modes (GSTR-1 / IRN / Refunds).
  Keyboard hotkey budget (F-keys) is tightening; we use F4 which is currently
  unbound on that screen.
- **Storage growth.** Partial returns create N extra rows per return event.
  For a 500-bills/day shop with ~3% partial-return rate this is ~15 return
  events × avg 2 lines = 30 extra rows/day. Negligible at SQLite scale.
- **Backfill debt.** A13's full-void bills are not migrated into
  `return_headers` by this migration. Leaves a split reporting source until a
  later backfill ADR.

---

## Test strategy (brief)

### Unit (pure TS, `@pharmacare/bill-repo`)
- Pro-rata math: 8 cases covering odd-paise rounding, discount pro-rata,
  CGST+SGST equal-split, IGST single-component.
- Qty boundary: full-return, 0.5-qty-strip return, repeated partials summing to
  original qty, over-return rejected.
- Tender split reversal: 3 tenders, residual-to-largest rule.

### Integration (better-sqlite3 against real migrations)
- `saveBill` → `savePartialReturn` round-trip, verify stock movement row.
- Second partial return against same bill — triggers qty-limit correctly.
- Expired-at-return with and without owner override.
- Rx-required H-class line — blocked when original rx_id is NULL.

### Regression
- **A10 GSTR-1 export still green.** Run existing golden fixtures + new ones
  with partial-return events in the period. No existing vectors should break.
- **A9 invoice-print credit-note layout** snapshot-tested (8-10 fixtures).
- **A12 IRN adapter mock** exercises CRN payload build + happy-path submit.

### End-to-end (playwright against desktop build)
- F4 → pick bill → 2-line partial return → F9 → credit-note toast. ≤ 2s.
- Keyboard-only path test (no mouse events).

---

## Open questions

1. **>30-day refund window.** GST section 34(2) allows credit notes up to the
   due date of September following the end of the financial year in which the
   original supply was made — effectively ~6 months. Should we block partial
   refunds > 30 days at the UI (safer, common shop policy) and allow
   owner-override for the 30-to-180-day window? Or just allow silently up to
   180 days? **Proposal:** block > 30 days by default, owner-override path to
   180 days, hard-block > 180 days. Needs shop-owner sign-off.
2. **Discount apportionment on partial return.** §3 proposes pro-rata of the
   original line discount by qty ratio. Alternative: the discount "sticks to"
   the retained portion (customer got discount on what they kept). Former is
   cleaner mathematically, latter is closer to shop intuition. Needs one real
   pilot's owner input before merging.
3. **Credit-note numbering.** `return_no` format `CN/YYYY-YY/NNNN` — is that
   per-shop or per-FY? Does it need a separate Doc-Series in GSTR-1 `doc_issue`?
   (Our A10 `doc_issue` section today only tracks `INV`.)
4. **`credit_note` tender mode — this ADR or next?** §2 punts it to ADR 0022.
   But if a pilot shop needs UPI-fallback on day one, we may need to pull it
   forward. Decision pending pilot feedback.
5. **Concurrency.** Two cashiers attempting a partial refund on the same bill
   line simultaneously — the qty-limit trigger protects the invariant, but
   the UX should surface a clean error, not a raw `QTY_EXCEEDS_REFUNDABLE`.
   Small, but needs a UX review.

---

## Supersedes / Superseded-by

- **Supersedes:** —
- **Superseded-by:** —
- **Depends on (must-merge-first):** none (ADRs 0010-0017 all merged).
- **Spawns:** ADR 0022 (credit_note tender mode + redemption) — deferred.

---

_End of ADR 0021 (DRAFT)._
