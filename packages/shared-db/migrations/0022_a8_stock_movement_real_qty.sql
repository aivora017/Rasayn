-- Migration 0022 — A8 stock_movement trigger: drop the INTEGER cast.
--
-- The trigger from 0021 used CAST(NEW.qty_returned AS INTEGER) so that
-- qty_delta would be a clean integer. That truncates fractional strips
-- to 0 (0.5 -> 0) and hits the schema-level CHECK qty_delta <> 0.
--
-- The trg_bill_lines_decrement_stock trigger from 0007 writes -NEW.qty
-- into qty_delta directly without a CAST and works fine on fractional
-- bill quantities (SQLite stores the REAL value in the INTEGER-affinity
-- column without complaint as long as CHECK passes). Mirror that
-- pattern for symmetry — REAL qty_returned -> REAL qty_delta -> REAL
-- batches.qty_on_hand += qty_returned.
--
-- This unblocks half-strip and quarter-strip refunds (ADR-0021 §5
-- explicitly contemplates sub-strip granularity once the pilot needs
-- it; this migration takes us there at the schema level).

DROP TRIGGER IF EXISTS trg_return_lines_stock_movement;

CREATE TRIGGER trg_return_lines_stock_movement
AFTER INSERT ON return_lines
FOR EACH ROW
WHEN NEW.reason_code <> 'expired_at_return'
BEGIN
  INSERT INTO stock_movements
    (id, batch_id, product_id, qty_delta, movement_type, ref_table, ref_id, created_at)
  SELECT
    'sm_' || NEW.id,
    NEW.batch_id,
    b.product_id,
    NEW.qty_returned,
    'return',
    'return_lines',
    NEW.id,
    strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM batches b WHERE b.id = NEW.batch_id;

  UPDATE batches
     SET qty_on_hand = qty_on_hand + NEW.qty_returned
   WHERE id = NEW.batch_id;
END;
