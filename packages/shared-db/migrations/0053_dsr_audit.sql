-- 0053_dsr_audit.sql
-- DPDP Act 2023 §11 data principal rights audit log (S28-C1, ADR-0077).
--
-- DPDP §11 grants every Data Principal four rights against the Data
-- Fiduciary (the pharmacy):
--   (a) access to a summary of personal data being processed,
--   (b) correction / completion / erasure (subject to retention limits),
--   (c) nomination of a representative,
--   (d) grievance redressal.
-- §13(2) sets a 30-day SLA for the Fiduciary to respond.
--
-- The existing `dpdp_dsr_requests` table (migration 0033) tracks the
-- request *lifecycle* (received → verifying → in-progress → fulfilled
-- /rejected). This new `dsr_audit_log` table captures EVERY action
-- taken on EVERY request, including walk-in entries the owner records
-- on the spot, plus the auto-respond export bundle's filesystem path.
-- Multiple rows per request_id are expected (one per status transition
-- + one per export run).
--
-- Pairs with `dsr_export.rs` (Tauri commands `request_personal_data_export`,
-- `dsr_get_export_status`, `dsr_list_exports`) and `DSRPanel.tsx`.

CREATE TABLE IF NOT EXISTS dsr_audit_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id          TEXT NOT NULL,
  customer_id         TEXT NOT NULL,
  requester_phone     TEXT,
  reason              TEXT,
  kind                TEXT NOT NULL CHECK (kind IN ('access','correction','erasure','grievance','portability')),
  status              TEXT NOT NULL CHECK (status IN ('received','in-progress','done','failed','rejected')),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  fulfilled_at        TEXT,
  files_path          TEXT,
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_dsr_audit_request_id
  ON dsr_audit_log(request_id);

CREATE INDEX IF NOT EXISTS idx_dsr_audit_customer_id
  ON dsr_audit_log(customer_id);

CREATE INDEX IF NOT EXISTS idx_dsr_audit_created_at
  ON dsr_audit_log(created_at DESC);

-- Open-only filter: exports still in flight or that have failed.
CREATE INDEX IF NOT EXISTS idx_dsr_audit_open
  ON dsr_audit_log(status)
  WHERE status NOT IN ('done','rejected');
