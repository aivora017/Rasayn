-- Migration 0017 — X2 mandatory SKU images (X2a: storage + compliance gate)
-- ADR: docs/adr/0018-x2-sku-images.md
-- Playbook: §4 Three Moats → X2

-- One canonical image per product (X2a: byte-exact SHA256 identity).
-- BLOB stored in-SQLite (Hard Rule 1: LAN-first, no cloud dependency).
-- Size/MIME enforced at write time — UI wrapper must also validate client-side.
CREATE TABLE IF NOT EXISTS product_images (
  product_id    TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  sha256        TEXT NOT NULL CHECK (length(sha256) = 64),
  mime          TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
  width_px      INTEGER,
  height_px     INTEGER,
  bytes         BLOB NOT NULL,
  uploaded_by   TEXT NOT NULL REFERENCES users(id),
  uploaded_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_product_images_sha256 ON product_images(sha256);
CREATE INDEX IF NOT EXISTS idx_product_images_uploaded_at ON product_images(uploaded_at DESC);

-- Append-only audit of every attach/replace/delete on product_images.
-- Required by §8 compliance guardrails (evidence for Schedule H/H1/X image enforcement).
CREATE TABLE IF NOT EXISTS product_image_audit (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id     TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('attach','replace','delete')),
  prior_sha256   TEXT,
  new_sha256     TEXT,
  actor_user_id  TEXT NOT NULL REFERENCES users(id),
  at_ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_product_image_audit_product ON product_image_audit(product_id);
CREATE INDEX IF NOT EXISTS idx_product_image_audit_ts ON product_image_audit(at_ts DESC);

-- Append-only guarantee: reject any UPDATE/DELETE on audit rows.
CREATE TRIGGER IF NOT EXISTS trg_product_image_audit_no_update
BEFORE UPDATE ON product_image_audit
BEGIN
  SELECT RAISE(ABORT, 'product_image_audit is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_product_image_audit_no_delete
BEFORE DELETE ON product_image_audit
BEGIN
  SELECT RAISE(ABORT, 'product_image_audit is append-only');
END;

-- Keep products.image_sha256 in sync with product_images.sha256 on every mutation.
-- The Schedule H/H1/X compliance gate (migration 0001 triggers) reads products.image_sha256,
-- so these sync triggers are what actually enforce the X2 moat on the billing / returns path.
CREATE TRIGGER IF NOT EXISTS trg_product_images_sync_after_insert
AFTER INSERT ON product_images
BEGIN
  UPDATE products SET image_sha256 = NEW.sha256 WHERE id = NEW.product_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_product_images_sync_after_update
AFTER UPDATE OF sha256 ON product_images
BEGIN
  UPDATE products SET image_sha256 = NEW.sha256 WHERE id = NEW.product_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_product_images_sync_after_delete
AFTER DELETE ON product_images
BEGIN
  UPDATE products SET image_sha256 = NULL WHERE id = OLD.product_id;
END;
