-- PharmaCare Pro · A1 SKU master — NPPA cap + HSN guard + helpful indexes
-- v0.1.0 · 2026-04-15 · ADR 0004 (A1)
--
-- Adds Drug Price Control Order (DPCO 2013) / NPPA ceiling-price column to
-- products and enforces it at write time. Also adds a CHECK to keep HSN to
-- the retail-pharma set (3003 medicaments / 3004 retail-pack / 3005 dressings
-- / 3006 pharma goods / 9018 instruments). Consumer-goods SKUs with non-pharma
-- HSN must flip schedule='OTC' explicitly — the CHECK prevents typos.

PRAGMA foreign_keys = ON;

-- 1. NPPA ceiling-price column (nullable = not price-capped).
ALTER TABLE products ADD COLUMN nppa_max_mrp_paise INTEGER;

-- 2. Index for the master screen (alphabetical listing + active-only filter).
CREATE INDEX IF NOT EXISTS idx_products_active_name
  ON products(is_active, name);

-- 3. HSN whitelist trigger. We avoid ALTER TABLE … ADD CHECK (unsupported
--    on SQLite < 3.38 on Win7 builds); use BEFORE triggers instead.
CREATE TRIGGER trg_products_hsn_ins
BEFORE INSERT ON products
FOR EACH ROW
WHEN NEW.hsn NOT IN ('3003','3004','3005','3006','9018')
BEGIN
  SELECT RAISE(ABORT, 'HSN must be one of 3003/3004/3005/3006/9018');
END;

CREATE TRIGGER trg_products_hsn_upd
BEFORE UPDATE OF hsn ON products
FOR EACH ROW
WHEN NEW.hsn NOT IN ('3003','3004','3005','3006','9018')
BEGIN
  SELECT RAISE(ABORT, 'HSN must be one of 3003/3004/3005/3006/9018');
END;

-- 4. NPPA cap guard on products.mrp_paise. When nppa_max_mrp_paise is set,
--    product-level MRP must not exceed it. Batch-level MRP is re-checked in
--    the bill engine (A4/A6) against the effective cap at sale time.
CREATE TRIGGER trg_products_nppa_ins
BEFORE INSERT ON products
FOR EACH ROW
WHEN NEW.nppa_max_mrp_paise IS NOT NULL
 AND NEW.mrp_paise > NEW.nppa_max_mrp_paise
BEGIN
  SELECT RAISE(ABORT, 'MRP exceeds NPPA ceiling price (DPCO 2013)');
END;

CREATE TRIGGER trg_products_nppa_upd
BEFORE UPDATE ON products
FOR EACH ROW
WHEN NEW.nppa_max_mrp_paise IS NOT NULL
 AND NEW.mrp_paise > NEW.nppa_max_mrp_paise
BEGIN
  SELECT RAISE(ABORT, 'MRP exceeds NPPA ceiling price (DPCO 2013)');
END;
