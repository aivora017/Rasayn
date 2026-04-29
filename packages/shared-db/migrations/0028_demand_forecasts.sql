-- 0028_demand_forecasts.sql
-- Demand forecasting cache + reorder recommendations + auto-PO drafts.
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3.

-- 0028: demand_forecasts + reorder_recommendations + product_locations (rack-wise)

CREATE TABLE IF NOT EXISTS demand_forecasts (
  product_id    TEXT NOT NULL,
  shop_id       TEXT NOT NULL,
  forecast_date TEXT NOT NULL,
  expected_qty  REAL NOT NULL,
  p90_qty       REAL NOT NULL,
  generated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  model_version TEXT NOT NULL,
  PRIMARY KEY (product_id, shop_id, forecast_date),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (shop_id)    REFERENCES shops(id)
);

CREATE TABLE IF NOT EXISTS reorder_recommendations (
  product_id              TEXT NOT NULL,
  shop_id                 TEXT NOT NULL,
  recommended_qty         INTEGER NOT NULL,
  safety_stock_qty        INTEGER NOT NULL,
  reorder_point_qty       INTEGER NOT NULL,
  suggested_distributor_id TEXT,
  est_cost_paise          INTEGER NOT NULL,
  generated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  acted_on_at             TEXT,
  PRIMARY KEY (product_id, shop_id, generated_at),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (shop_id)    REFERENCES shops(id)
);

CREATE TABLE IF NOT EXISTS product_locations (
  product_id  TEXT NOT NULL,
  shop_id     TEXT NOT NULL,
  rack_code   TEXT NOT NULL,
  shelf_code  TEXT,
  PRIMARY KEY (product_id, shop_id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (shop_id)    REFERENCES shops(id)
);
CREATE INDEX IF NOT EXISTS idx_product_locations_rack ON product_locations(shop_id, rack_code);
