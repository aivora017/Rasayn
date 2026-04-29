-- 0033_dpdp_consents.sql
-- DPDP Act consent registry + data-subject-rights queue.
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3.

-- 0033: dpdp_consents + dpdp_dsr_requests

CREATE TABLE IF NOT EXISTS dpdp_consents (
  customer_id   TEXT NOT NULL,
  purpose       TEXT NOT NULL CHECK (purpose IN ('billing','compliance','marketing','abdm','loyalty','research-anon')),
  granted       INTEGER NOT NULL,
  granted_at    TEXT,
  withdrawn_at  TEXT,
  evidence      TEXT NOT NULL,
  PRIMARY KEY (customer_id, purpose),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS dpdp_dsr_requests (
  id              TEXT PRIMARY KEY,
  customer_id     TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('access','erasure','correction','portability')),
  received_at     TEXT NOT NULL DEFAULT (datetime('now')),
  status          TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received','verifying','in-progress','fulfilled','rejected')),
  fulfilled_at    TEXT,
  response_payload_path TEXT,
  handled_by_user_id TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (handled_by_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_dsr_open ON dpdp_dsr_requests(status) WHERE status NOT IN ('fulfilled','rejected');
