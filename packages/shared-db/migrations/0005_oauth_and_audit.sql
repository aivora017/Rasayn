-- Migration 0005: oauth_accounts
-- Per ADR 0002: refresh tokens live in OS keyring; this table holds only
-- non-secret metadata needed to render Connect/Disconnect UI without
-- unlocking the keyring on every render.
--
-- Note: audit_log already exists from migration 0001 with the canonical
-- shape (actor_id, entity, entity_id, action, payload). OAuth side-effects
-- write to that same table with entity='oauth:gmail' — see
-- apps/desktop/src-tauri/src/oauth/mod.rs::audit.

CREATE TABLE IF NOT EXISTS oauth_accounts (
  shop_id        TEXT NOT NULL REFERENCES shops(id),
  provider       TEXT NOT NULL CHECK (provider IN ('gmail','outlook')),
  account_email  TEXT NOT NULL,
  scopes         TEXT NOT NULL,        -- space-separated
  granted_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_refresh_at TEXT,
  last_error     TEXT,
  PRIMARY KEY (shop_id, provider)
);
