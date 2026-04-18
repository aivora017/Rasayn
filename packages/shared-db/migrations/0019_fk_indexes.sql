-- Migration 0019: covering indexes on FK columns flagged by D04 in
-- docs/reviews/tech-debt-2026-04-18.md.
--
-- SQLite does NOT auto-index FK columns — only PRIMARY KEY and UNIQUE
-- columns get implicit indexes. At 100 shops × 3 years of audit data,
-- queries like "all overrides by pharmacist X" or "all images uploaded
-- by user Y" do a full-scan; CSV exports slow quadratically.
--
-- `oauth_accounts.shop_id` is NOT indexed here — the composite PK
-- (shop_id, provider) already creates a usable index whose leading
-- column is shop_id. No redundant index needed.
--
-- All indexes are `IF NOT EXISTS` so this migration is idempotent if a
-- future migration ever pre-creates any of these names.

-- expiry_override_audit.product_id — "all overrides for product X"
-- (pharmacist looking at repeat expiry overrides on the same SKU).
CREATE INDEX IF NOT EXISTS idx_expiry_override_audit_product
  ON expiry_override_audit(product_id, created_at DESC);

-- expiry_override_audit.actor_user_id — "all overrides by pharmacist X"
-- (Schedule H compliance audit, staff accountability).
-- Composite with created_at so audit-report sort also uses the index.
CREATE INDEX IF NOT EXISTS idx_expiry_override_audit_actor
  ON expiry_override_audit(actor_user_id, created_at DESC);

-- product_images.uploaded_by — "who uploaded missing/wrong images"
-- (pilot data-quality sweep, training reviews).
CREATE INDEX IF NOT EXISTS idx_product_images_uploaded_by
  ON product_images(uploaded_by, uploaded_at DESC);

-- product_image_audit.actor_user_id — append-only audit, same access
-- pattern as expiry override audit. Bonus find during D04 review.
CREATE INDEX IF NOT EXISTS idx_product_image_audit_actor
  ON product_image_audit(actor_user_id, at_ts DESC);

-- supplier_templates.supplier_id — "all templates for supplier X"
-- (X1.2 Gmail→GRN bridge picks a template per supplier_id; at 50+ suppliers
-- with templates this starts mattering).
CREATE INDEX IF NOT EXISTS idx_supplier_templates_supplier
  ON supplier_templates(supplier_id);
