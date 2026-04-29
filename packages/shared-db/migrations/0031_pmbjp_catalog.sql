-- 0031_pmbjp_catalog.sql
-- PMBJP Jan Aushadhi catalog cache + generic-substitution suggestions.
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3.

-- 0031: pmbjp_catalog (refreshed nightly from pmbjp.gov.in)

CREATE TABLE IF NOT EXISTS pmbjp_catalog (
  drug_code      TEXT PRIMARY KEY,
  molecule       TEXT NOT NULL,
  strength       TEXT NOT NULL,
  form           TEXT NOT NULL,
  mrp_paise      INTEGER NOT NULL,
  available      INTEGER NOT NULL DEFAULT 1,
  refreshed_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pmbjp_molecule ON pmbjp_catalog(molecule);
