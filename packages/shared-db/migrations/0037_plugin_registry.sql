-- 0037_plugin_registry.sql
-- Plugin SDK — installed plugins + capabilities + audit.
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3.

-- 0037: plugins + plugin_audit

CREATE TABLE IF NOT EXISTS plugins (
  id              TEXT PRIMARY KEY,                 -- reverse-DNS
  name            TEXT NOT NULL,
  version         TEXT NOT NULL,
  author          TEXT NOT NULL,
  manifest_json   TEXT NOT NULL,
  installed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  installed_by_user_id TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (installed_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS plugin_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id    TEXT NOT NULL,
  capability   TEXT NOT NULL,
  payload_hash TEXT,
  invoked_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (plugin_id) REFERENCES plugins(id)
);
CREATE INDEX IF NOT EXISTS idx_plugin_audit_plugin_date ON plugin_audit(plugin_id, invoked_at);
