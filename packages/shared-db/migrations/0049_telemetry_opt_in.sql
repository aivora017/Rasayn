-- 0049_telemetry_opt_in.sql
-- S27.E telemetry opt-in (Sentry crash reporting). ADR-0072.
--
-- Per Playbook v2.0 §11 + §12: every cloud egress is per-shop and
-- explicitly consented. Sentry is the FIRST outbound network dep on
-- the desktop binary; this column gates `telemetry::cloud_egress_allowed`.
--
-- Default 0 (OFF). Owner toggles via Settings -> Telemetry. The toggle
-- writes telemetry_opt_in=1 AND telemetry_dsn_set_at=ISO8601 in the same
-- transaction. cross_border_opinion_at (from 0048) MUST also be non-null
-- before opt-in is allowed (DPDP §16 — Sentry is hosted in EU/US).
--
-- Per-shop, never global. Multi-tenant rigs (parent-worker model, ADR-0028)
-- can have shop A opted in and shop B opted out simultaneously.

ALTER TABLE shops ADD COLUMN telemetry_opt_in INTEGER NOT NULL DEFAULT 0
  CHECK (telemetry_opt_in IN (0, 1));

-- Audit trail: when did this shop first configure a Sentry DSN?
-- NULL = never; non-NULL = ISO-8601 timestamp of first configuration.
-- Used by ADR-0072 GA gate (>=100 events captured + 0 PII leaks before pilot).
ALTER TABLE shops ADD COLUMN telemetry_dsn_set_at TEXT;

CREATE INDEX IF NOT EXISTS idx_shops_telemetry_opt_in ON shops (telemetry_opt_in);
