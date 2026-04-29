-- 0029_fraud_alerts.sql
-- Fraud / staff-theft anomaly alerts.
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3.

-- 0029: fraud_alerts (Isolation Forest + LLM narrative)

CREATE TABLE IF NOT EXISTS fraud_alerts (
  id              TEXT PRIMARY KEY,
  shop_id         TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('high-discount-rate','after-hours','frequent-voids','duplicate-refunds','schedX-velocity','other')),
  score           REAL NOT NULL CHECK (score BETWEEN 0 AND 1),
  window_start    TEXT NOT NULL,
  window_end      TEXT NOT NULL,
  narrative       TEXT NOT NULL,
  evidence_json   TEXT NOT NULL,
  reviewed_at     TEXT,
  reviewed_by_user_id TEXT,
  resolution      TEXT,                       -- 'false-positive' | 'investigation' | 'action-taken'
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_shop_date ON fraud_alerts(shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_unresolved ON fraud_alerts(shop_id) WHERE reviewed_at IS NULL;
