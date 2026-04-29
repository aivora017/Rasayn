-- 0032_abdm_consents.sql
-- ABDM/ABHA verifications + dispensation FHIR push log.
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3.

-- 0032: abha_profiles + abdm_dispensations

CREATE TABLE IF NOT EXISTS abha_profiles (
  customer_id     TEXT PRIMARY KEY,
  abha_number     TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  dob             TEXT,
  gender          TEXT,
  mobile_e164     TEXT,
  verified_at     TEXT NOT NULL,
  consent_token_encrypted TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS abdm_dispensations (
  bill_id         TEXT PRIMARY KEY,
  abha_number     TEXT NOT NULL,
  fhir_payload_json TEXT NOT NULL,
  uhi_event_id    TEXT,
  pushed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  status          TEXT NOT NULL CHECK (status IN ('pending','ok','failed')),
  error           TEXT,
  FOREIGN KEY (bill_id) REFERENCES bills(id)
);
