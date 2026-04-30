-- product_ingredients dose extension (S16.2 + S18 hotfix).
-- The base table was created in migration 0026 with composite PK
-- (product_id, ingredient_id). This migration adds the dose columns
-- the formulary engine needs without disturbing existing rows.

ALTER TABLE product_ingredients ADD COLUMN per_dose_mg REAL;
ALTER TABLE product_ingredients ADD COLUMN daily_mg REAL;
ALTER TABLE product_ingredients ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'));

CREATE INDEX IF NOT EXISTS idx_product_ingredients_product
  ON product_ingredients(product_id);
CREATE INDEX IF NOT EXISTS idx_product_ingredients_ingredient
  ON product_ingredients(ingredient_id);
