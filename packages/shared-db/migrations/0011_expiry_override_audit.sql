-- A13 · Expiry override audit trail (ADR 0013).
-- Written by the owner-only override flow when a cashier-added line has a batch
-- with 0 < days_to_expiry <= 30. Hard-blocked expired lines (days <= 0) never
-- reach save_bill at all; if one is detected server-side the save returns
-- EXPIRED_BATCH and this table is not consulted.
--
-- The row is written BEFORE save_bill so save_bill can verify the presence of
-- a matching audit row by (batch_id, actor_user_id) within the last ~60 s
-- window. We key by bill_line_id once the bill commits; until then we key by
-- (batch_id, actor_user_id, created_at) — see defensive re-check in save_bill.

CREATE TABLE expiry_override_audit (
  id               TEXT PRIMARY KEY,
  bill_line_id     TEXT,  -- filled in after save_bill commits (nullable window)
  bill_no          TEXT,  -- cross-ref convenience for the auditor view
  product_id       TEXT NOT NULL REFERENCES products(id),
  batch_id         TEXT NOT NULL REFERENCES batches(id),
  actor_user_id    TEXT NOT NULL REFERENCES users(id),
  actor_role       TEXT NOT NULL CHECK (actor_role IN ('owner','pharmacist','cashier','viewer')),
  reason           TEXT NOT NULL CHECK (length(trim(reason)) >= 4),
  days_past_expiry INTEGER NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_expiry_override_audit_batch ON expiry_override_audit(batch_id, actor_user_id, created_at);
CREATE INDEX idx_expiry_override_audit_bill_line ON expiry_override_audit(bill_line_id);
