-- Stock-transfer reconciliation hooks (S16.1).
-- Phase-2 of migration 0040.
--
-- The stock_movements table (migration 0007) already has 'transfer_in' and
-- 'transfer_out' movement_type values. This migration adds two helpful
-- indexes and an idempotency-friendly UNIQUE constraint on (movement_type,
-- ref_table, ref_id) so we never double-write a reconciliation row when
-- dispatch / receive is retried after a transient error.
--
-- Application logic in apps/desktop/src-tauri/src/stock_transfer.rs writes:
--   * dispatch(transfer_id) → one transfer_out row per line (qty_delta = -qty_dispatched)
--   * receive (line)        → one transfer_in row per line  (qty_delta = +qty_received)
--   * cancel from in_transit→ reversal transfer_in row to undo the transfer_out
--
-- ref_table = 'stock_transfer_lines' for all 3 cases; ref_id = transfer_line_id.

CREATE INDEX IF NOT EXISTS idx_stock_movements_transfer_ref
  ON stock_movements(ref_table, ref_id, movement_type);

-- Best-effort uniqueness on the (movement_type, ref_table, ref_id) triple
-- specifically for transfer movements. Older bill_line / grn_line refs are
-- left untouched.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_movements_transfer_unique
  ON stock_movements(movement_type, ref_table, ref_id)
  WHERE ref_table = 'stock_transfer_lines'
    AND movement_type IN ('transfer_in','transfer_out');
