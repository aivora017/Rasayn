-- 0025_rbac_roles.sql
-- RBAC — every user is god-mode today. This widens the role enum and adds MFA enrollment.
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3 (ADR-0038).

-- 0001 already created users.role with CHECK ('owner','pharmacist','cashier','viewer').
-- We need 5 roles per @pharmacare/rbac: owner / manager / pharmacist / technician / cashier.
-- SQLite cannot ALTER a CHECK constraint, so we rebuild the table preserving columns.

CREATE TABLE users_v2 (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'owner'
                CHECK (role IN ('owner','manager','pharmacist','technician','cashier')),
  pin_hash    TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- New RBAC + MFA columns:
  mfa_enrolled              INTEGER NOT NULL DEFAULT 0 CHECK (mfa_enrolled IN (0,1)),
  totp_secret_encrypted     TEXT,                  -- AES-GCM via @pharmacare/crypto
  webauthn_credential_id    TEXT
);

INSERT INTO users_v2 (id, shop_id, name, role, pin_hash, is_active, created_at)
  SELECT id, shop_id, name,
         CASE role WHEN 'viewer' THEN 'technician' ELSE role END,
         pin_hash, is_active, created_at
  FROM users;

DROP TABLE users;
ALTER TABLE users_v2 RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_shop ON users(shop_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Per-user permission overrides (optional grants/revocations beyond role default)
CREATE TABLE IF NOT EXISTS rbac_permission_overrides (
  user_id              TEXT NOT NULL,
  permission           TEXT NOT NULL,
  granted              INTEGER NOT NULL DEFAULT 1 CHECK (granted IN (0,1)),
  reason               TEXT,
  granted_by_user_id   TEXT NOT NULL,
  granted_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, permission),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (granted_by_user_id) REFERENCES users(id)
);
