-- 0026_formulary.sql
-- Drug formulary — DDI pairs + allergy ingredients + dose ranges (FDA Orange + CIMS-India seed).
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3.

-- 0026: formulary (DDI/allergy/dose check engine)
-- Seeded from FDA Orange Book + CIMS-India + BNF dose ranges.

CREATE TABLE IF NOT EXISTS formulary_ingredients (
  id            TEXT PRIMARY KEY,
  inn           TEXT NOT NULL,                -- International Non-proprietary Name
  atc_class     TEXT,                          -- Anatomical Therapeutic Chemical
  is_allergen_common INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_ingredients (
  product_id    TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  strength_mg   REAL,
  PRIMARY KEY (product_id, ingredient_id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (ingredient_id) REFERENCES formulary_ingredients(id)
);

CREATE TABLE IF NOT EXISTS ddi_pairs (
  ingredient_a   TEXT NOT NULL,
  ingredient_b   TEXT NOT NULL,
  severity       TEXT NOT NULL CHECK (severity IN ('info','warn','block')),
  mechanism      TEXT,
  clinical_effect TEXT,
  references_json TEXT,
  PRIMARY KEY (ingredient_a, ingredient_b),
  FOREIGN KEY (ingredient_a) REFERENCES formulary_ingredients(id),
  FOREIGN KEY (ingredient_b) REFERENCES formulary_ingredients(id),
  CHECK (ingredient_a < ingredient_b)
);

CREATE TABLE IF NOT EXISTS dose_ranges (
  ingredient_id     TEXT NOT NULL,
  age_min_years     INTEGER NOT NULL DEFAULT 0,
  age_max_years     INTEGER NOT NULL DEFAULT 120,
  daily_min_mg      REAL,
  daily_max_mg      REAL,
  per_dose_max_mg   REAL,
  PRIMARY KEY (ingredient_id, age_min_years, age_max_years),
  FOREIGN KEY (ingredient_id) REFERENCES formulary_ingredients(id)
);

CREATE TABLE IF NOT EXISTS customer_allergies (
  customer_id   TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'warn',
  recorded_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (customer_id, ingredient_id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (ingredient_id) REFERENCES formulary_ingredients(id)
);
