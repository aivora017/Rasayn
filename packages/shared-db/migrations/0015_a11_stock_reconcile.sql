-- PharmaCare Pro · A11 stock-reconcile — physical-count sessions + audited adjustments
-- v0.1.0 · 2026-04-17 · ADR 0016 (A11)
--
-- Plugs into:
--   * batches(id, product_id, qty_on_hand, ...) from 0001
--   * stock_movements(id, batch_id, product_id, qty_delta, movement_type, ref_table, ref_id, ...) from 0007
--     (movement_type already allows 'adjust' — we emit those rows on finalize)
--
-- Adds:
--   1. physical_counts        — session header (open → finalized/cancelled)
--   2. physical_count_lines   — one row per (session, batch) counted; UNIQUE(session_id, batch_id);
--                               revisions JSON append-only audit log for overwrites
--   3. stock_adjustments      — one row per non-zero variance at finalize; FK to session + batch
--
-- Acceptance gate (ADR 0016 §Consequences):
--   * Every adjustment row has a matching stock_movements row with ref_table='stock_adjustments'
--   * Finalize is atomic — all or nothing (enforced at app layer inside a Rust transaction)
--   * Only owners can finalize (enforced at Rust layer, NOT in SQL, because auth is app-level)

PRAGMA foreign_keys = ON;

-- 1. Session header -----------------------------------------------------------
CREATE TABLE physical_counts (
  id             TEXT PRIMARY KEY,
  shop_id        TEXT NOT NULL REFERENCES shops(id),
  title          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','finalized','cancelled')),
  opened_by      TEXT NOT NULL REFERENCES users(id),
  opened_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finalized_by   TEXT REFERENCES users(id),
  finalized_at   TEXT,
  cancelled_by   TEXT REFERENCES users(id),
  cancelled_at   TEXT,
  notes          TEXT,
  -- invariants
  CHECK ( (status <> 'finalized') OR (finalized_by IS NOT NULL AND finalized_at IS NOT NULL) ),
  CHECK ( (status <> 'cancelled') OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL) )
);

CREATE INDEX idx_physical_counts_shop_status
  ON physical_counts(shop_id, status, opened_at DESC);

-- 2. Count lines --------------------------------------------------------------
-- One row per (session, batch). Overwriting counted_qty is allowed while session
-- is open; previous values are appended to `revisions` (JSON array) for audit.
CREATE TABLE physical_count_lines (
  id                  TEXT PRIMARY KEY,
  physical_count_id   TEXT NOT NULL REFERENCES physical_counts(id),
  batch_id            TEXT NOT NULL REFERENCES batches(id),
  product_id          TEXT NOT NULL REFERENCES products(id),
  counted_qty         INTEGER NOT NULL CHECK (counted_qty >= 0),
  counted_by          TEXT NOT NULL REFERENCES users(id),
  counted_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  notes               TEXT,
  revisions           TEXT NOT NULL DEFAULT '[]',  -- JSON array of {ts, by, old_qty, old_notes}
  UNIQUE(physical_count_id, batch_id)
);

CREATE INDEX idx_physical_count_lines_session
  ON physical_count_lines(physical_count_id);

CREATE INDEX idx_physical_count_lines_batch
  ON physical_count_lines(batch_id);

-- 3. Adjustments --------------------------------------------------------------
-- Written at finalize. Each row = one batch's delta. Maps 1:1 to a
-- stock_movements row (ref_table='stock_adjustments', ref_id=this.id).
CREATE TABLE stock_adjustments (
  id                  TEXT PRIMARY KEY,
  physical_count_id   TEXT NOT NULL REFERENCES physical_counts(id),
  batch_id            TEXT NOT NULL REFERENCES batches(id),
  product_id          TEXT NOT NULL REFERENCES products(id),
  system_qty_before   INTEGER NOT NULL,
  counted_qty         INTEGER NOT NULL CHECK (counted_qty >= 0),
  qty_delta           INTEGER NOT NULL CHECK (qty_delta <> 0),
  reason_code         TEXT NOT NULL CHECK (reason_code IN (
                        'shrinkage','damage','expiry_dump','data_entry_error',
                        'theft','transfer_out','other')),
  reason_notes        TEXT,
  created_by          TEXT NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(physical_count_id, batch_id)
);

CREATE INDEX idx_stock_adjustments_session
  ON stock_adjustments(physical_count_id);

CREATE INDEX idx_stock_adjustments_batch_date
  ON stock_adjustments(batch_id, created_at);

CREATE INDEX idx_stock_adjustments_reason
  ON stock_adjustments(reason_code, created_at);

-- 4. Append-only guard on stock_adjustments (no UPDATE/DELETE once written).
--    stock_movements already has this guard in 0007; we mirror for adjustments.
CREATE TRIGGER trg_stock_adjustments_no_update
BEFORE UPDATE ON stock_adjustments
BEGIN
  SELECT RAISE(ABORT, 'stock_adjustments are append-only');
END;

CREATE TRIGGER trg_stock_adjustments_no_delete
BEFORE DELETE ON stock_adjustments
BEGIN
  SELECT RAISE(ABORT, 'stock_adjustments are append-only');
END;

-- 5. Guard: once a physical_count is finalized or cancelled, its lines are frozen.
CREATE TRIGGER trg_physical_count_lines_freeze_after_final
BEFORE UPDATE ON physical_count_lines
WHEN (SELECT status FROM physical_counts WHERE id = OLD.physical_count_id) <> 'open'
BEGIN
  SELECT RAISE(ABORT, 'cannot modify lines of a closed physical_count');
END;

CREATE TRIGGER trg_physical_count_lines_no_delete_after_final
BEFORE DELETE ON physical_count_lines
WHEN (SELECT status FROM physical_counts WHERE id = OLD.physical_count_id) <> 'open'
BEGIN
  SELECT RAISE(ABORT, 'cannot delete lines of a closed physical_count');
END;

-- 6. Guard: physical_counts status transitions are monotonic.
--    open → finalized or open → cancelled only. No reopen.
CREATE TRIGGER trg_physical_counts_status_transition
BEFORE UPDATE OF status ON physical_counts
WHEN NOT (
  (OLD.status = 'open' AND NEW.status IN ('open','finalized','cancelled'))
)
BEGIN
  SELECT RAISE(ABORT, 'illegal physical_counts status transition');
END;
