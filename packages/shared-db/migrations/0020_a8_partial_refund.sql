-- Migration 0020 — A8 Partial Refund (ADR 0021)
-- Line-level returns with pro-rata GST reversal + credit-note scaffold.
--
-- Ships the schema foundation for ADR 0021 steps 1-2:
--   * return_headers        — one row per refund event (partial or full).
--   * return_lines          — one row per bill_line × event.
--   * credit_notes          — scaffold for ADR 0022 credit-note tender mode.
--   * return_no_counters    — per-shop, per-FY sequence numerator for
--                             'CN/YYYY-YY/NNNN' credit-note numbering (Q3).
--   * shop_settings         — new table; hosts partial_refund_max_days (Q1).
--
-- Triggers enforce the compliance invariants in Playbook §8.8:
--   * qty_returned <= (bill_lines.qty - SUM(prior return_lines))
--   * refund_amount_paise <= pro-rata(bill_lines.line_total_paise) + 50 paise
--   * stock_movements insert per return_line, discriminated by reason_code.
--
-- Indexes target the hot access paths:
--   * "show me every return for this bill"          — idx_return_headers_bill
--   * "give me this month's returns for reporting"  — idx_return_headers_shop_created
--   * "drain the IRN CRN queue"                     — idx_return_headers_einvoice (partial)
--   * "lookup refundable qty for a bill_line"       — idx_return_lines_bill_line
--   * "stock reconcile joins on batch"              — idx_return_lines_batch
--
-- This migration does NOT touch:
--   * Rust commands (ADR 0021 step 3)              — later PR
--   * A10 GSTR-1 cdnr/cdnur/b2cs emit (step 4)     — later PR
--   * A9 credit-note invoice layout (step 5)       — later PR
--   * A12 CRN IRN adapter (step 6)                 — later PR
--   * UX picker + tender-reversal modal (step 7)   — later PR

-- ---------------------------------------------------------------------------
-- 1. shop_settings — per-shop POS policy knobs.
--
-- New table. ADR 0021 Q1 addendum requires partial_refund_max_days here; the
-- table did not previously exist so we create it as part of this migration.
-- Backfill: one row per existing shop, default values, created inside this
-- migration so post-0020 code can assume the row exists.
-- ---------------------------------------------------------------------------
CREATE TABLE shop_settings (
  shop_id                     TEXT PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  partial_refund_max_days     INTEGER NOT NULL DEFAULT 30
                              CHECK (partial_refund_max_days >= 0
                                     AND partial_refund_max_days <= 180),
  created_at                  TEXT NOT NULL
                              DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                  TEXT NOT NULL
                              DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Seed a default row for every existing shop so the A8 partial-refund path
-- can LEFT JOIN shop_settings without null-handling churn.
INSERT INTO shop_settings (shop_id)
  SELECT id FROM shops;

-- ---------------------------------------------------------------------------
-- 2. return_headers — one row per refund event.
-- ---------------------------------------------------------------------------
CREATE TABLE return_headers (
  id                         TEXT PRIMARY KEY,
  original_bill_id           TEXT NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
  shop_id                    TEXT NOT NULL REFERENCES shops(id),
  return_no                  TEXT NOT NULL,
  return_type                TEXT NOT NULL CHECK (return_type IN ('partial','full')),
  reason                     TEXT NOT NULL CHECK (length(trim(reason)) >= 4),
  tender_summary_json        TEXT NOT NULL,
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
  einvoice_status            TEXT CHECK (einvoice_status IS NULL OR einvoice_status IN
                              ('n/a','pending','submitted','acked','cancelled','failed')),
  created_at                 TEXT NOT NULL
                             DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by                 TEXT NOT NULL REFERENCES users(id),
  UNIQUE (shop_id, return_no)
);

CREATE INDEX idx_return_headers_bill
  ON return_headers(original_bill_id);

CREATE INDEX idx_return_headers_shop_created
  ON return_headers(shop_id, created_at);

-- Partial index: only rows the CRN async submitter needs to drain.
CREATE INDEX idx_return_headers_einvoice
  ON return_headers(einvoice_status)
  WHERE einvoice_status IN ('pending','failed');

-- ---------------------------------------------------------------------------
-- 3. return_lines — one row per (return_event × bill_line).
-- ---------------------------------------------------------------------------
CREATE TABLE return_lines (
  id                      TEXT PRIMARY KEY,
  return_id               TEXT NOT NULL REFERENCES return_headers(id) ON DELETE CASCADE,
  bill_line_id            TEXT NOT NULL REFERENCES bill_lines(id) ON DELETE RESTRICT,
  batch_id                TEXT NOT NULL REFERENCES batches(id),
  qty_returned            REAL NOT NULL CHECK (qty_returned > 0),
  refund_taxable_paise    INTEGER NOT NULL CHECK (refund_taxable_paise >= 0),
  refund_discount_paise   INTEGER NOT NULL DEFAULT 0 CHECK (refund_discount_paise >= 0),
  refund_cgst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (refund_cgst_paise >= 0),
  refund_sgst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (refund_sgst_paise >= 0),
  refund_igst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (refund_igst_paise >= 0),
  refund_cess_paise       INTEGER NOT NULL DEFAULT 0 CHECK (refund_cess_paise >= 0),
  refund_amount_paise     INTEGER NOT NULL CHECK (refund_amount_paise > 0),
  reason_code             TEXT NOT NULL CHECK (reason_code IN (
                            'customer_change_of_mind','damaged','wrong_sku',
                            'doctor_changed_rx','expired_at_return','other')),
  UNIQUE (return_id, bill_line_id)
);

CREATE INDEX idx_return_lines_bill_line
  ON return_lines(bill_line_id);

CREATE INDEX idx_return_lines_batch
  ON return_lines(batch_id);

-- ---------------------------------------------------------------------------
-- 4. credit_notes — scaffold, ADR 0022 will flesh out the redemption flow.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_notes (
  id                      TEXT PRIMARY KEY,
  customer_id             TEXT NOT NULL REFERENCES customers(id),
  issued_from_return_id   TEXT NOT NULL REFERENCES return_headers(id),
  issued_amount_paise     INTEGER NOT NULL CHECK (issued_amount_paise > 0),
  balance_paise           INTEGER NOT NULL CHECK (balance_paise >= 0),
  expires_at              TEXT,
  created_at              TEXT NOT NULL
                          DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_credit_notes_customer
  ON credit_notes(customer_id);

-- ---------------------------------------------------------------------------
-- 5. return_no_counters — per-shop, per-FY sequence numerator for credit
--    note numbering 'CN/YYYY-YY/NNNN' (ADR 0021 Q3).
-- ---------------------------------------------------------------------------
CREATE TABLE return_no_counters (
  shop_id         TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  fy_start_year   INTEGER NOT NULL CHECK (fy_start_year >= 2025),
  last_seq        INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  PRIMARY KEY (shop_id, fy_start_year)
);

-- ---------------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------------

-- 6.1 qty_returned <= remaining refundable qty on bill_line.
--     Subtracts the sum of PRIOR return_lines (not including NEW) so
--     repeated partials sum correctly to the original qty.
CREATE TRIGGER trg_return_lines_qty_limit
BEFORE INSERT ON return_lines
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.qty_returned > (
      SELECT bl.qty - COALESCE((
        SELECT SUM(rl.qty_returned)
        FROM return_lines rl
        WHERE rl.bill_line_id = NEW.bill_line_id
      ), 0)
      FROM bill_lines bl
      WHERE bl.id = NEW.bill_line_id
    )
    THEN RAISE(ABORT, 'QTY_EXCEEDS_REFUNDABLE')
  END;
END;

-- 6.2 NPPA invariant: refund_amount_paise cannot exceed pro-rata of the
--     original line_total_paise plus a 50-paise rounding slack.
CREATE TRIGGER trg_return_lines_nppa_cap
BEFORE INSERT ON return_lines
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.refund_amount_paise > (
      SELECT CAST(bl.line_total_paise * NEW.qty_returned / bl.qty AS INTEGER) + 50
      FROM bill_lines bl
      WHERE bl.id = NEW.bill_line_id
    )
    THEN RAISE(ABORT, 'NPPA_REFUND_EXCEEDS_ORIGINAL')
  END;
END;

-- 6.3 Stock movement on return_line insert. Discriminates on reason_code
--     so an 'expired_at_return' refund lands in quarantine, not salable.
--     The existing trg_stock_movements_update_batch_qty (migration 0007)
--     increments batches.qty_on_hand for movement_type='return' only —
--     'return_to_expired_quarantine' is intentionally NOT counted as salable.
CREATE TRIGGER trg_return_lines_stock_movement
AFTER INSERT ON return_lines
FOR EACH ROW
BEGIN
  INSERT INTO stock_movements
    (id, batch_id, qty, movement_type, ref_entity, ref_id, created_at)
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
