-- 0013 — A9 (ADR 0014) · Invoice print
--   1. print_audit table for ORIGINAL-vs-DUPLICATE receipt trail (D&C inspector).
--   2. shops columns for pharmacist block printed in every bill footer
--      (Pharmacy Practice Regulations 2015 — pharmacist name + reg no must appear
--      on any Schedule H/H1/X dispensing record).
--   3. default_invoice_layout on shops so billing screen picks the right CSS.
--      Forward-compatible fssai_no (FSSAI 2006 requirement for OTC + food-grade)
--      and pharmacist_signature_path (image embed, deferred to A9 addendum).

PRAGMA foreign_keys = ON;

-- ---------- 1. print_audit ----------
CREATE TABLE print_audit (
  id              TEXT PRIMARY KEY,
  bill_id         TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  layout          TEXT NOT NULL CHECK (layout IN ('thermal_80mm','a5_gst')),
  actor_user_id   TEXT NOT NULL REFERENCES users(id),
  is_duplicate    INTEGER NOT NULL DEFAULT 0 CHECK (is_duplicate IN (0,1)),
  printed_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Fast prior-print count for the duplicate stamp decision.
CREATE INDEX idx_print_audit_bill_id ON print_audit(bill_id);
CREATE INDEX idx_print_audit_printed_at ON print_audit(printed_at);

-- ---------- 2. shops — pharmacist block + fssai + default layout ----------
ALTER TABLE shops ADD COLUMN pharmacist_name TEXT;
ALTER TABLE shops ADD COLUMN pharmacist_reg_no TEXT;
ALTER TABLE shops ADD COLUMN fssai_no TEXT;
ALTER TABLE shops ADD COLUMN pharmacist_signature_path TEXT;
ALTER TABLE shops ADD COLUMN default_invoice_layout TEXT
  NOT NULL DEFAULT 'thermal_80mm'
  CHECK (default_invoice_layout IN ('thermal_80mm','a5_gst'));
