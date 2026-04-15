-- Migration 0004: supplier_templates (Tier A parser config for X1 moat).
-- One per supplier. Stores regex header patterns, line-row regex, and a
-- column-index map for tabular CSV/PDF-as-text rows. Serialised JSON in TEXT
-- columns to keep SQLite simple and portable.

CREATE TABLE IF NOT EXISTS supplier_templates (
  id                   TEXT PRIMARY KEY,
  shop_id              TEXT NOT NULL REFERENCES shops(id),
  supplier_id          TEXT NOT NULL REFERENCES suppliers(id),
  name                 TEXT NOT NULL,

  -- JSON: { invoiceNo: string, invoiceDate: string, total: string, supplier?: string }
  header_patterns      TEXT NOT NULL,
  -- JSON: { row: string }  -- regex with named groups or fixed capture order
  line_patterns        TEXT NOT NULL,
  -- JSON: { product: number|string, hsn: number|string, batchNo: ..., mfgDate: ..., expiryDate: ..., qty: ..., ratePaise: ..., mrpPaise: ..., gstRate: ... }
  column_map           TEXT NOT NULL,

  date_format          TEXT NOT NULL DEFAULT 'DD/MM/YYYY'
                         CHECK (date_format IN ('DD/MM/YYYY','YYYY-MM-DD','MM/DD/YYYY','DD-MMM-YYYY')),
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  last_tested_at       TEXT,
  last_test_ok         INTEGER CHECK (last_test_ok IS NULL OR last_test_ok IN (0,1)),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(supplier_id, name)
);

CREATE INDEX IF NOT EXISTS idx_supplier_templates_shop
  ON supplier_templates(shop_id, is_active);
