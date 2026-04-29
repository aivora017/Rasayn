-- 0030_cold_chain.sql
-- Cold-chain BLE temp sensor readings + excursion alerts + AEFI prep.
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3.

-- 0030: cold_chain_sensors + cold_chain_readings + cold_chain_excursions

CREATE TABLE IF NOT EXISTS cold_chain_sensors (
  id           TEXT PRIMARY KEY,
  shop_id      TEXT NOT NULL,
  ble_mac      TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,                  -- "Vaccine Fridge 1", etc.
  min_safe_c   REAL NOT NULL DEFAULT 2.0,
  max_safe_c   REAL NOT NULL DEFAULT 8.0,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id)
);

CREATE TABLE IF NOT EXISTS cold_chain_readings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sensor_id   TEXT NOT NULL,
  temp_c      REAL NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (sensor_id) REFERENCES cold_chain_sensors(id)
);
CREATE INDEX IF NOT EXISTS idx_cc_readings_sensor_time ON cold_chain_readings(sensor_id, recorded_at);

CREATE TABLE IF NOT EXISTS cold_chain_batch_links (
  sensor_id TEXT NOT NULL,
  batch_id  TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  unlinked_at TEXT,
  PRIMARY KEY (sensor_id, batch_id, linked_at),
  FOREIGN KEY (sensor_id) REFERENCES cold_chain_sensors(id),
  FOREIGN KEY (batch_id)  REFERENCES batches(id)
);

CREATE TABLE IF NOT EXISTS cold_chain_excursions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sensor_id       TEXT NOT NULL,
  batch_id        TEXT,
  excursion_start TEXT NOT NULL,
  excursion_end   TEXT,
  min_temp_c      REAL,
  max_temp_c      REAL,
  minutes_outside INTEGER NOT NULL DEFAULT 0,
  aefi_filed      INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  FOREIGN KEY (sensor_id) REFERENCES cold_chain_sensors(id),
  FOREIGN KEY (batch_id)  REFERENCES batches(id)
);
