-- 0012 — A7 (ADR 0011) · Rx capture for Schedule H/H1/X
-- Reuses existing prescriptions table from 0001_init; adds:
--   1. retention_until column + AFTER INSERT populate trigger (2-year retention per
--      D&C Rules 1945, r.65). Nullable column so ALTER is backward-compatible; the
--      trigger populates on every insert.
--   2. Rx-required block trigger on bill_lines (defense-in-depth; the Rust + TS
--      save_bill commands are the user-facing gate that returns RX_REQUIRED).
--   3. Supporting indexes for retention purge job + doctor lookup.

PRAGMA foreign_keys = ON;

-- ---------- 1. retention_until on prescriptions ----------
ALTER TABLE prescriptions ADD COLUMN retention_until TEXT;

CREATE TRIGGER trg_prescriptions_retention_set
AFTER INSERT ON prescriptions
FOR EACH ROW
WHEN NEW.retention_until IS NULL
BEGIN
  UPDATE prescriptions
    SET retention_until = date(NEW.issued_date, '+2 years')
    WHERE id = NEW.id;
END;

-- ---------- 2. block Schedule H/H1/X bill_lines when bills.rx_id IS NULL ----------
-- User-facing gate is save_bill returning RX_REQUIRED. This trigger catches any
-- code path that bypasses save_bill (e.g. direct SQL from admin tools).
CREATE TRIGGER trg_bill_lines_require_rx
BEFORE INSERT ON bill_lines
FOR EACH ROW
WHEN (SELECT schedule FROM products WHERE id = NEW.product_id) IN ('H','H1','X','NDPS')
 AND (SELECT rx_id FROM bills WHERE id = NEW.bill_id) IS NULL
BEGIN
  SELECT RAISE(ABORT, 'schedule H/H1/X/NDPS product requires rx_id on bill');
END;

-- ---------- 3. indexes ----------
CREATE INDEX IF NOT EXISTS idx_prescriptions_retention_until
  ON prescriptions(retention_until);

CREATE INDEX IF NOT EXISTS idx_prescriptions_doctor_id
  ON prescriptions(doctor_id);

CREATE INDEX IF NOT EXISTS idx_prescriptions_issued_date
  ON prescriptions(issued_date);
