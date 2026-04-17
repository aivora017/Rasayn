-- Migration 0010 · A8 payments table (ADR 0012)
-- Split-tender record per bill. N rows per bill; sum(amount_paise) must equal
-- bills.grand_total_paise (validated at save_bill command level, not by trigger
-- because grand_total computation happens in same txn before payments insert).
--
-- `mode` domain matches bills.payment_mode but is intentionally NOT a FK —
-- payments.mode is the per-tender mode (e.g. 'cash'); bills.payment_mode is
-- the bill-level summary ('split' when >1 tender row, else the single mode).

CREATE TABLE payments (
  id           TEXT PRIMARY KEY,
  bill_id      TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  mode         TEXT NOT NULL CHECK (mode IN ('cash','upi','card','credit','wallet')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  ref_no       TEXT,                                  -- card-last-4 / UPI-RRN / NULL for cash
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_payments_bill_id ON payments(bill_id);

