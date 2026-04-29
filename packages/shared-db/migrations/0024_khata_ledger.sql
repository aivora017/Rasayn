-- 0024_khata_ledger.sql
-- Khata (credit) ledger — append-only entries, derived balances/aging.
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3.

-- 0024: khata_entries + khata_customer_limits  (Pharmacy-OS table-stakes)

CREATE TABLE IF NOT EXISTS khata_customer_limits (
  customer_id            TEXT PRIMARY KEY,
  credit_limit_paise     INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_paise >= 0),
  current_due_paise      INTEGER NOT NULL DEFAULT 0,
  default_risk_score     REAL    NOT NULL DEFAULT 0 CHECK (default_risk_score BETWEEN 0 AND 1),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS khata_entries (
  id              TEXT PRIMARY KEY,
  customer_id     TEXT NOT NULL,
  bill_id         TEXT,
  debit_paise     INTEGER NOT NULL DEFAULT 0 CHECK (debit_paise >= 0),
  credit_paise    INTEGER NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  note            TEXT,
  recorded_by_user_id TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (bill_id) REFERENCES bills(id),
  FOREIGN KEY (recorded_by_user_id) REFERENCES users(id),
  CHECK (debit_paise = 0 OR credit_paise = 0)  -- single side per row
);

CREATE INDEX IF NOT EXISTS idx_khata_entries_cust_date ON khata_entries(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_khata_entries_bill      ON khata_entries(bill_id);
