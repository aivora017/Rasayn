-- Migration 0003: grns (goods receipt note) header table.
-- Purpose: every batch created on receipt must link to a GRN header carrying
-- supplier, invoice details, and total cost. Enables: 3-way PO/GRN match,
-- reprint of paper GRN, audit trail for Schedule H/H1/X inward flow.

CREATE TABLE IF NOT EXISTS grns (
  id                   TEXT PRIMARY KEY,
  shop_id              TEXT NOT NULL REFERENCES shops(id),
  supplier_id          TEXT NOT NULL REFERENCES suppliers(id),
  invoice_no           TEXT NOT NULL,
  invoice_date         TEXT NOT NULL,    -- YYYY-MM-DD
  total_cost_paise     INTEGER NOT NULL CHECK (total_cost_paise >= 0),
  line_count           INTEGER NOT NULL CHECK (line_count > 0),
  status               TEXT NOT NULL DEFAULT 'posted'
                         CHECK (status IN ('draft','posted','voided')),
  source               TEXT NOT NULL DEFAULT 'manual'
                         CHECK (source IN ('manual','gmail','photo','po_match')),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(supplier_id, invoice_no)
);

CREATE INDEX IF NOT EXISTS idx_grns_shop_date ON grns(shop_id, invoice_date);
CREATE INDEX IF NOT EXISTS idx_grns_supplier ON grns(supplier_id, invoice_date);
