-- Migration 0021 — Fix A8 partial-refund stock_movement trigger.
--
-- The trg_return_lines_stock_movement trigger created in 0020 referenced
-- columns that don't exist in stock_movements:
--   * NEW.qty                -> column is named qty_delta (INTEGER)
--   * ref_entity             -> column is named ref_table
--   * (missing) product_id   -> NOT NULL FK to products
--
-- It also tried to write movement_type='return_to_expired_quarantine',
-- which is not in the CHECK list ('opening','grn','bill','return',
-- 'adjust','waste','transfer_in','transfer_out').
--
-- Net effect: ANY save_partial_return_impl call that hit a non-empty
-- return_lines path crashed at the trigger. Caught only when the cargo
-- test gate was added in scripts/own-shop-verify.ps1 — never previously
-- exercised in CI.
--
-- This migration:
--   1. DROPs the broken trigger.
--   2. Recreates it correctly:
--        * uses qty_delta + ref_table + product_id (joined from batches);
--        * skips expired-at-return rows entirely (WHEN clause), so
--          expired qty does NOT re-enter salable stock and the invariant
--          SUM(qty_delta) == batches.qty_on_hand stays intact;
--        * UPDATEs batches.qty_on_hand += qty for non-expired returns,
--          mirroring the trg_bill_lines_decrement_stock pattern.
--   3. Casts qty_returned (REAL) to INTEGER for qty_delta — strip-level
--      returns are whole units in the pilot ICP. ADR-0021 §5 reserves a
--      future amendment for sub-strip granularity if pilots need it.

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
    CAST(NEW.qty_returned AS INTEGER),
    'return',
    'return_lines',
    NEW.id,
    strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM batches b WHERE b.id = NEW.batch_id;

  UPDATE batches
     SET qty_on_hand = qty_on_hand + CAST(NEW.qty_returned AS INTEGER)
   WHERE id = NEW.batch_id;
END;
