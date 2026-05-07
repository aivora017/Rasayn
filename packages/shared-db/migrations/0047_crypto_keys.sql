-- 0047_crypto_keys.sql — Crypto key registry (S26.E silent killer #5).
--
-- Stores per-shop Data Encryption Keys (DEKs), wrapped under the
-- shop's Key Encryption Key (KEK). The KEK itself never lives in the
-- database — it sits in the OS keyring (Windows DPAPI / macOS Keychain
-- / Linux Secret Service) and is read on app start by the Tauri side.
--
-- Lifecycle:
--   * status = 'active'  — primary key for new writes
--   * status = 'rotated' — historical, still used for decrypt
--   * status = 'revoked' — quarantined; decrypt callers must skip
--
-- See ADR-0071 for the threat model and rotation policy.

CREATE TABLE IF NOT EXISTS kek_wrapped_dek (
  shop_id     TEXT NOT NULL,
  key_id      TEXT NOT NULL,
  wrapped_dek BLOB NOT NULL,
  algo        TEXT NOT NULL DEFAULT 'aes-256-gcm',
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','rotated','revoked')),
  created_at  TEXT NOT NULL,
  rotated_at  TEXT,
  PRIMARY KEY (shop_id, key_id)
);

CREATE INDEX IF NOT EXISTS idx_kek_wrapped_dek_shop_status
  ON kek_wrapped_dek (shop_id, status);
