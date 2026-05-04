-- 0044_batches_shop_id.sql — multi-shop foundation (S22a).
-- Adds shop_id to batches so the same product/batch can carry separate
-- on-hand counts at each location. Existing single-shop installs are
-- backfilled to 'shop_main' (matches the default seed in 0001_init).
--
-- The legacy UNIQUE(product_id, batch_no) is intentionally left alone
-- on this migration — single-shop installs continue to enforce it via
-- the existing constraint, and the new (shop_id, product_id, batch_no)
-- composite uniqueness will land in a follow-up migration once we have
-- a real customer with two locations to test against.

ALTER TABLE batches ADD COLUMN shop_id TEXT NOT NULL DEFAULT 'shop_main';

UPDATE batches SET shop_id = 'shop_main' WHERE shop_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_batches_shop_product
  ON batches(shop_id, product_id);

CREATE INDEX IF NOT EXISTS idx_batches_shop_expiry
  ON batches(shop_id, expiry_date);
