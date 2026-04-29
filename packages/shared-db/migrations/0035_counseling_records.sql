-- 0035_counseling_records.sql
-- Patient counseling records (Schedule-H mandate) + auto-drafted scripts.
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3.

-- 0035: counseling_records

CREATE TABLE IF NOT EXISTS counseling_records (
  id                  TEXT PRIMARY KEY,
  bill_id             TEXT NOT NULL,
  customer_id         TEXT NOT NULL,
  counseled_by_user_id TEXT NOT NULL,
  product_ids_json    TEXT NOT NULL,
  script_text         TEXT NOT NULL,
  script_lang         TEXT NOT NULL DEFAULT 'en-IN',
  ai_draft            INTEGER NOT NULL DEFAULT 0,
  patient_acknowledged INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bill_id)              REFERENCES bills(id),
  FOREIGN KEY (customer_id)          REFERENCES customers(id),
  FOREIGN KEY (counseled_by_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_counseling_bill ON counseling_records(bill_id);
