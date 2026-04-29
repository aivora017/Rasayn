-- 0023_cash_shifts.sql
-- Cash shift table — opening + closing denominations + Z-report aggregations.
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3.

-- 0023: cash_shifts (A6 Pharmacy-OS table-stakes)
-- Owner of: @pharmacare/cash-shift package.
-- Read-pattern: latest open shift per shop (single row index hit), all closed shifts per period.

CREATE TABLE IF NOT EXISTS cash_shifts (
  id                            TEXT PRIMARY KEY,
  shop_id                       TEXT NOT NULL,
  opened_by_user_id             TEXT NOT NULL,
  opened_at                     TEXT NOT NULL,                    -- ISO 8601
  opening_balance_paise         INTEGER NOT NULL CHECK (opening_balance_paise >= 0),
  opening_denominations_json    TEXT NOT NULL,                    -- DenominationCount as JSON
  closed_at                     TEXT,
  closed_by_user_id             TEXT,
  closing_balance_paise         INTEGER,
  closing_denominations_json    TEXT,
  expected_closing_paise        INTEGER,                          -- derived at close
  variance_paise                INTEGER,                          -- closing - expected
  variance_approved_by_user_id  TEXT,
  z_report_json                 TEXT,                             -- snapshot at close
  FOREIGN KEY (shop_id) REFERENCES shops(id),
  FOREIGN KEY (opened_by_user_id) REFERENCES users(id),
  FOREIGN KEY (closed_by_user_id) REFERENCES users(id),
  FOREIGN KEY (variance_approved_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_cash_shifts_open  ON cash_shifts(shop_id, closed_at) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cash_shifts_period ON cash_shifts(shop_id, opened_at);
