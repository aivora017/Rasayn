-- 0050_counseling_log.sql
-- Schedule-H mandatory counseling log (S28-A1, ADR-0073).
--
-- Drugs & Cosmetics Act 1940 §22 + §27 + Rules 1945 r.65 require that the
-- pharmacist (RPh) counsel the patient at the point of dispense for every
-- Schedule H, H1, and X line. Pre-pilot, save_bill must hard-block when
-- any H/H1/X line in a bill has no matching counsel_log row. Soft-warning
-- is rejected as it invites D&C §27 prosecution risk during an FDA
-- inspector visit (see SILENT_KILLERS row #2 history + S28 dispatch).
--
-- The sister table `counseling_records` from migration 0035 stores the
-- AI-drafted long-form counseling SCRIPT (multi-product roll-up). This
-- table is per-line evidence — one row per (bill, drug) — and is what
-- save_bill consults to decide pass/fail.

CREATE TABLE IF NOT EXISTS counsel_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id             TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  drug_id             TEXT NOT NULL,
  drug_name           TEXT NOT NULL,
  schedule_class      TEXT NOT NULL CHECK (schedule_class IN ('H','H1','X')),
  counseled_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  counselor_user_id   TEXT REFERENCES users(id),
  notes               TEXT,
  patient_consented   INTEGER NOT NULL CHECK (patient_consented IN (0,1)),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_counsel_log_bill_drug ON counsel_log(bill_id, drug_id);
CREATE INDEX IF NOT EXISTS idx_counsel_log_bill ON counsel_log(bill_id);
