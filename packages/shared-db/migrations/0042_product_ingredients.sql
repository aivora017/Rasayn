-- product_ingredients (S16.2). Many-to-many between products and the
-- formulary's ingredient list (id, inn, atcClass).
--
-- BillingClinicalGuard reads from this table at line-add time to feed the
-- formulary engine real ingredient ids per product. Without this table the
-- guard falls back to empty ingredient arrays and never raises a DDI alert.

CREATE TABLE IF NOT EXISTS product_ingredients (
    id            TEXT PRIMARY KEY,
    product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    ingredient_id TEXT NOT NULL,
    -- Optional per-line dose info (mg per dose, mg per day) so the formulary
    -- dose-range engine can flag pediatric/adult mismatches.
    per_dose_mg   REAL,
    daily_mg      REAL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(product_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_product_ingredients_product
  ON product_ingredients(product_id);
CREATE INDEX IF NOT EXISTS idx_product_ingredients_ingredient
  ON product_ingredients(ingredient_id);
