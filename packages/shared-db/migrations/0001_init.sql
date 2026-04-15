-- PharmaCare Pro · initial schema
-- v0.1.0 · 2026-04-14 · Playbook v2.0 §8.1
-- All monetary columns are INTEGER paise. Dates are ISO-8601 text.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE shops (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  gstin         TEXT NOT NULL CHECK (length(gstin) = 15),
  state_code    TEXT NOT NULL CHECK (length(state_code) = 2),
  retail_license TEXT NOT NULL,
  address       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('owner','pharmacist','cashier','viewer')),
  pin_hash    TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE suppliers (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  name        TEXT NOT NULL,
  gstin       TEXT,
  phone       TEXT,
  address     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE products (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  generic_name   TEXT,
  manufacturer   TEXT NOT NULL,
  hsn            TEXT NOT NULL,
  gst_rate       INTEGER NOT NULL CHECK (gst_rate IN (0,5,12,18,28)),
  schedule       TEXT NOT NULL CHECK (schedule IN ('OTC','G','H','H1','X','NDPS')),
  pack_form      TEXT NOT NULL,
  pack_size      INTEGER NOT NULL CHECK (pack_size > 0),
  mrp_paise      INTEGER NOT NULL CHECK (mrp_paise > 0),
  image_sha256   TEXT,  -- X2 moat: mandatory for H/H1/X (enforced by trigger below)
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_generic ON products(generic_name);

-- X2 moat: Schedule H/H1/X must have an image.
CREATE TRIGGER trg_products_schedule_img_ins
BEFORE INSERT ON products
FOR EACH ROW
WHEN NEW.schedule IN ('H','H1','X') AND (NEW.image_sha256 IS NULL OR NEW.image_sha256 = '')
BEGIN
  SELECT RAISE(ABORT, 'Schedule H/H1/X product requires image_sha256 (X2 moat)');
END;

CREATE TRIGGER trg_products_schedule_img_upd
BEFORE UPDATE ON products
FOR EACH ROW
WHEN NEW.schedule IN ('H','H1','X') AND (NEW.image_sha256 IS NULL OR NEW.image_sha256 = '')
BEGIN
  SELECT RAISE(ABORT, 'Schedule H/H1/X product requires image_sha256 (X2 moat)');
END;

CREATE TABLE batches (
  id                   TEXT PRIMARY KEY,
  product_id           TEXT NOT NULL REFERENCES products(id),
  batch_no             TEXT NOT NULL,
  mfg_date             TEXT NOT NULL,     -- YYYY-MM-01 by convention
  expiry_date          TEXT NOT NULL,     -- YYYY-MM-<lastday>
  qty_on_hand          INTEGER NOT NULL CHECK (qty_on_hand >= 0),
  purchase_price_paise INTEGER NOT NULL CHECK (purchase_price_paise >= 0),
  mrp_paise            INTEGER NOT NULL CHECK (mrp_paise > 0),
  supplier_id          TEXT NOT NULL REFERENCES suppliers(id),
  grn_id               TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(product_id, batch_no)
);
CREATE INDEX idx_batches_product_expiry ON batches(product_id, expiry_date);

CREATE TABLE customers (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  name        TEXT NOT NULL,
  phone       TEXT,
  dob         TEXT,
  gender      TEXT CHECK (gender IN ('M','F','O') OR gender IS NULL),
  gstin       TEXT,
  address     TEXT,
  consent_marketing         INTEGER NOT NULL DEFAULT 0,
  consent_abdm              INTEGER NOT NULL DEFAULT 0,
  consent_captured_at       TEXT,
  consent_method            TEXT CHECK (consent_method IN ('verbal','signed','otp','app') OR consent_method IS NULL),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_customers_phone ON customers(shop_id, phone);

CREATE TABLE doctors (
  id       TEXT PRIMARY KEY,
  reg_no   TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  phone    TEXT
);

CREATE TABLE prescriptions (
  id            TEXT PRIMARY KEY,
  shop_id       TEXT NOT NULL REFERENCES shops(id),
  customer_id   TEXT NOT NULL REFERENCES customers(id),
  doctor_id     TEXT REFERENCES doctors(id),
  kind          TEXT NOT NULL CHECK (kind IN ('paper','digital','abdm')),
  image_path    TEXT,
  issued_date   TEXT NOT NULL,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE bills (
  id                    TEXT PRIMARY KEY,
  shop_id               TEXT NOT NULL REFERENCES shops(id),
  bill_no               TEXT NOT NULL,
  billed_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  customer_id           TEXT REFERENCES customers(id),
  doctor_id             TEXT REFERENCES doctors(id),
  rx_id                 TEXT REFERENCES prescriptions(id),
  cashier_id            TEXT NOT NULL REFERENCES users(id),
  gst_treatment         TEXT NOT NULL CHECK (gst_treatment IN ('intra_state','inter_state','exempt','nil_rated')),
  subtotal_paise        INTEGER NOT NULL,
  total_discount_paise  INTEGER NOT NULL DEFAULT 0,
  total_cgst_paise      INTEGER NOT NULL DEFAULT 0,
  total_sgst_paise      INTEGER NOT NULL DEFAULT 0,
  total_igst_paise      INTEGER NOT NULL DEFAULT 0,
  total_cess_paise      INTEGER NOT NULL DEFAULT 0,
  round_off_paise       INTEGER NOT NULL DEFAULT 0 CHECK (round_off_paise BETWEEN -50 AND 50),
  grand_total_paise     INTEGER NOT NULL CHECK (grand_total_paise >= 0 AND grand_total_paise % 100 = 0),
  payment_mode          TEXT NOT NULL CHECK (payment_mode IN ('cash','upi','card','credit','wallet','split')),
  e_invoice_irn         TEXT,
  is_voided             INTEGER NOT NULL DEFAULT 0 CHECK (is_voided IN (0,1)),
  UNIQUE(shop_id, bill_no)
);
CREATE INDEX idx_bills_billed_at ON bills(shop_id, billed_at);

CREATE TABLE bill_lines (
  id                  TEXT PRIMARY KEY,
  bill_id             TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  product_id          TEXT NOT NULL REFERENCES products(id),
  batch_id            TEXT NOT NULL REFERENCES batches(id),
  qty                 REAL NOT NULL CHECK (qty > 0),
  mrp_paise           INTEGER NOT NULL CHECK (mrp_paise > 0),
  discount_pct        REAL NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  discount_paise      INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  taxable_value_paise INTEGER NOT NULL CHECK (taxable_value_paise >= 0),
  gst_rate            INTEGER NOT NULL CHECK (gst_rate IN (0,5,12,18,28)),
  cgst_paise          INTEGER NOT NULL DEFAULT 0,
  sgst_paise          INTEGER NOT NULL DEFAULT 0,
  igst_paise          INTEGER NOT NULL DEFAULT 0,
  cess_paise          INTEGER NOT NULL DEFAULT 0,
  line_total_paise    INTEGER NOT NULL
);
CREATE INDEX idx_bill_lines_bill ON bill_lines(bill_id);

-- FEFO + expired-batch hard block at DB layer.
-- Cannot sell an expired batch. expiry_date format: YYYY-MM-DD.
CREATE TRIGGER trg_bill_lines_block_expired
BEFORE INSERT ON bill_lines
FOR EACH ROW
WHEN (SELECT expiry_date FROM batches WHERE id = NEW.batch_id) < strftime('%Y-%m-%d','now')
BEGIN
  SELECT RAISE(ABORT, 'Cannot sell expired batch (Playbook §2.9)');
END;

-- Auto-decrement stock when bill line inserted (only if bill is not voided).
CREATE TRIGGER trg_bill_lines_decrement_stock
AFTER INSERT ON bill_lines
FOR EACH ROW
BEGIN
  UPDATE batches
  SET qty_on_hand = qty_on_hand - NEW.qty
  WHERE id = NEW.batch_id;
END;

-- FEFO view: for any product, batches in ascending expiry (non-expired, qty>0 only).
CREATE VIEW v_fefo_batches AS
SELECT b.*
FROM batches b
WHERE b.qty_on_hand > 0
  AND b.expiry_date >= strftime('%Y-%m-%d','now')
ORDER BY b.product_id, b.expiry_date ASC, b.created_at ASC;

-- Audit log (append-only). Tauri app writes here; never UPDATE/DELETE.
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_id    TEXT,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  payload     TEXT
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);

