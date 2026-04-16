-- PharmaCare Pro · A2 batch stock — deterministic FEFO + append-only movement ledger
-- v0.1.0 · 2026-04-16 · ADR 0005 (A2)
--
-- Builds on 0001_init.sql which already has:
--   * batches(product_id, batch_no, expiry_date, qty_on_hand, ...) with UNIQUE(product_id, batch_no)
--   * idx_batches_product_expiry(product_id, expiry_date)
--   * trg_bill_lines_block_expired                    (Hard Rule 9 — expired sale = hard block)
--   * trg_bill_lines_decrement_stock                  (AFTER INSERT on bill_lines → UPDATE qty_on_hand)
--   * v_fefo_batches view                             (ordered by product_id, expiry_date, created_at)
--
-- A2 upgrades:
--   1. Partial composite index on (product_id, expiry_date, batch_no) WHERE qty_on_hand > 0
--      → FEFO query plan is pure index scan; batch_no makes order deterministic.
--   2. v_fefo_batches re-created with batch_no tiebreaker (was created_at which drifts across
--      clone/restore).
--   3. stock_movements append-only ledger table — double-entry invariant for A10 returns,
--      A11 day-close, A15 perf audit and any GRN/adjust flow downstream.
--   4. trg_bill_lines_decrement_stock replaced by a version that ALSO writes a 'bill' movement
--      row, so the ledger reflects every outbound automatically.
--   5. Append-only guard triggers: UPDATE / DELETE on stock_movements is rejected.
--   6. Opening-balance trigger + backfill so the invariant holds for fresh AND upgraded DBs.
--
-- Acceptance gate (ADR 0004, A2 row):
--   * FEFO query returns oldest non-expired batch in p95 <5 ms on 50 k rows.
--   * movement ledger double-entry balances (auditLedger() returns []).
--   * expired rows excluded from pickable view.

PRAGMA foreign_keys = ON;

-- 1. Deterministic FEFO composite index. Partial keeps it small and makes the
--    planner pick it for "WHERE qty_on_hand > 0" queries (the pickable shape).
CREATE INDEX IF NOT EXISTS idx_batches_fefo
  ON batches(product_id, expiry_date, batch_no)
  WHERE qty_on_hand > 0;

-- 2. Refine v_fefo_batches: deterministic tiebreak on batch_no.
DROP VIEW IF EXISTS v_fefo_batches;
CREATE VIEW v_fefo_batches AS
SELECT b.*
FROM batches b
WHERE b.qty_on_hand > 0
  AND b.expiry_date >= strftime('%Y-%m-%d','now')
ORDER BY b.product_id, b.expiry_date ASC, b.batch_no ASC;

-- 3. Stock-movement ledger. Append-only; one row per qty delta.
--    Invariant: SUM(qty_delta) GROUP BY batch_id == batches.qty_on_hand at all times.
CREATE TABLE stock_movements (
  id             TEXT PRIMARY KEY,
  batch_id       TEXT NOT NULL REFERENCES batches(id),
  product_id     TEXT NOT NULL REFERENCES products(id),
  qty_delta      INTEGER NOT NULL,
  movement_type  TEXT NOT NULL CHECK (movement_type IN (
                   'opening','grn','bill','return','adjust','waste',
                   'transfer_in','transfer_out')),
  ref_table      TEXT,
  ref_id         TEXT,
  actor_id       TEXT,
  reason         TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (qty_delta <> 0)
);

CREATE INDEX idx_stock_movements_batch    ON stock_movements(batch_id, created_at);
CREATE INDEX idx_stock_movements_product  ON stock_movements(product_id, created_at);
CREATE INDEX idx_stock_movements_ref      ON stock_movements(ref_table, ref_id);

-- 4a. Opening-balance rows for any batches already on disk at upgrade time.
INSERT INTO stock_movements (id, batch_id, product_id, qty_delta, movement_type, actor_id, created_at)
SELECT 'mv_opn_' || b.id, b.id, b.product_id, b.qty_on_hand, 'opening', 'system', b.created_at
FROM batches b
LEFT JOIN stock_movements m ON m.batch_id = b.id
WHERE m.id IS NULL AND b.qty_on_hand > 0;

-- 4b. Auto-opening trigger: every NEW batch with qty_on_hand > 0 gets its
--     opening movement row written atomically. Fresh DBs thus satisfy the
--     invariant from t=0. Callers that add stock via a 'grn' movement should
--     INSERT the batch with qty_on_hand=0 and then call
--     recordMovement('grn', +qty, alsoUpdateBatch=true).
CREATE TRIGGER trg_batches_opening_mv_ins
AFTER INSERT ON batches
FOR EACH ROW
WHEN NEW.qty_on_hand > 0
BEGIN
  INSERT INTO stock_movements
    (id, batch_id, product_id, qty_delta, movement_type, actor_id, created_at)
  VALUES
    ('mv_opn_' || NEW.id, NEW.id, NEW.product_id, NEW.qty_on_hand,
     'opening', 'system', NEW.created_at);
END;

-- 5. Upgrade the bill-line decrement trigger: also write a 'bill' movement row.
DROP TRIGGER IF EXISTS trg_bill_lines_decrement_stock;
CREATE TRIGGER trg_bill_lines_decrement_stock
AFTER INSERT ON bill_lines
FOR EACH ROW
BEGIN
  UPDATE batches SET qty_on_hand = qty_on_hand - NEW.qty WHERE id = NEW.batch_id;

  INSERT INTO stock_movements
    (id, batch_id, product_id, qty_delta, movement_type, ref_table, ref_id, actor_id, created_at)
  SELECT
    'mv_bl_' || NEW.id,
    NEW.batch_id,
    b.product_id,
    -NEW.qty,
    'bill',
    'bills',
    NEW.bill_id,
    (SELECT cashier_id FROM bills WHERE id = NEW.bill_id),
    strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM batches b WHERE b.id = NEW.batch_id;
END;

-- 6. Append-only guards: UPDATE / DELETE on stock_movements is rejected.
CREATE TRIGGER trg_stock_movements_no_update
BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only — record an offsetting adjust row instead');
END;

CREATE TRIGGER trg_stock_movements_no_delete
BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only');
END;
