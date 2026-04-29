-- 0034_loyalty_campaigns.sql
-- Loyalty tiers + campaigns + cashback ledger.
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3.

-- 0034: loyalty_tiers (config) + loyalty_campaigns + loyalty_cashback

CREATE TABLE IF NOT EXISTS loyalty_tiers (
  tier                       TEXT PRIMARY KEY CHECK (tier IN ('bronze','silver','gold','platinum')),
  min_lifetime_spend_paise   INTEGER NOT NULL,
  default_discount_pct       REAL NOT NULL,
  birthday_bonus_paise       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS loyalty_campaigns (
  id              TEXT PRIMARY KEY,
  shop_id         TEXT NOT NULL,
  name            TEXT NOT NULL,
  trigger_kind    TEXT NOT NULL CHECK (trigger_kind IN ('birthday','drugClass','manual')),
  trigger_atc     TEXT,                            -- when trigger_kind='drugClass'
  discount_pct    REAL,
  bonus_paise     INTEGER,
  valid_from      TEXT NOT NULL,
  valid_to        TEXT NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (shop_id) REFERENCES shops(id)
);

CREATE TABLE IF NOT EXISTS loyalty_cashback (
  id              TEXT PRIMARY KEY,
  customer_id     TEXT NOT NULL,
  bill_id         TEXT,
  delta_paise     INTEGER NOT NULL,                -- positive earn, negative redeem
  reason          TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (bill_id) REFERENCES bills(id)
);
CREATE INDEX IF NOT EXISTS idx_loyalty_cashback_cust_date ON loyalty_cashback(customer_id, created_at);
