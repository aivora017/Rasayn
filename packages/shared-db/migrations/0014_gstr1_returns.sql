-- A10: GSTR-1 returns storage + bill doc-series / filed-period columns
-- ADR 0015

-- 1. bills gains doc_series + filed_period (nullable until filed)
ALTER TABLE bills ADD COLUMN doc_series TEXT NOT NULL DEFAULT 'INV';
ALTER TABLE bills ADD COLUMN filed_period TEXT;  -- 'MMYYYY' format, e.g. '032026'

-- Index for period-range queries during GSTR-1 generation
CREATE INDEX idx_bills_shop_billed_at ON bills(shop_id, billed_at);
CREATE INDEX idx_bills_filed_period ON bills(shop_id, filed_period) WHERE filed_period IS NOT NULL;

-- 2. gst_returns table — one row per generated return per status bucket
CREATE TABLE gst_returns (
  id                  TEXT PRIMARY KEY,
  shop_id             TEXT NOT NULL REFERENCES shops(id),
  return_type         TEXT NOT NULL CHECK (return_type IN ('GSTR1')),
  period              TEXT NOT NULL,  -- MMYYYY
  status              TEXT NOT NULL CHECK (status IN ('draft','filed','amended')) DEFAULT 'draft',
  json_blob           TEXT NOT NULL,
  csv_b2b             TEXT NOT NULL,
  csv_b2cl            TEXT NOT NULL,
  csv_b2cs            TEXT NOT NULL,
  csv_hsn             TEXT NOT NULL,
  csv_exemp           TEXT NOT NULL,
  csv_doc             TEXT NOT NULL,
  hash_sha256         TEXT NOT NULL CHECK (length(hash_sha256) = 64),
  bill_count          INTEGER NOT NULL CHECK (bill_count >= 0),
  grand_total_paise   INTEGER NOT NULL CHECK (grand_total_paise >= 0),
  generated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  filed_at            TEXT,
  filed_by_user_id    TEXT REFERENCES users(id),
  UNIQUE(shop_id, return_type, period, status)
);
CREATE INDEX idx_gst_returns_shop_period ON gst_returns(shop_id, period);
CREATE INDEX idx_gst_returns_status ON gst_returns(shop_id, status);

-- 3. Period-format check: 'MMYYYY' must be 6 digits; MM in 01..12
-- Enforced at application layer (Rust + TS); SQLite CHECK lacks pattern regex
-- without app-compiled extension. Document-only comment here.
