-- 0036_inspector_reports.sql
-- Inspector Mode generated reports + plugin registry.
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3.

-- 0036: inspector_reports (generated bundles for FDA / Drug Inspector)

CREATE TABLE IF NOT EXISTS inspector_reports (
  id                  TEXT PRIMARY KEY,
  shop_id             TEXT NOT NULL,
  period_start        TEXT NOT NULL,
  period_end          TEXT NOT NULL,
  bundle_pdf_path     TEXT,
  generated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  generated_by_user_id TEXT NOT NULL,
  served_to_inspector_at TEXT,
  inspector_name      TEXT,
  inspector_id        TEXT,
  notes               TEXT,
  FOREIGN KEY (shop_id) REFERENCES shops(id),
  FOREIGN KEY (generated_by_user_id) REFERENCES users(id)
);
