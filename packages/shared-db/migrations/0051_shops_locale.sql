-- 0051_shops_locale.sql
-- S28-B2 — owner UI locale per shop. Default Marathi per Q-007 (Kalyan
-- pilot at Vaidyanath Pharmacy). The settings dropdown writes through
-- set_locale() Tauri command; the UI bootstrap reads localStorage first
-- (boot speed) and then reconciles against this column on first idle so
-- stale localStorage cannot diverge from the persisted shop preference.

ALTER TABLE shops ADD COLUMN locale TEXT NOT NULL DEFAULT 'mr';

-- Cheap lookup; only ever a handful of shops, but keep the index pattern
-- consistent with the rest of the shops table (idx_shops_dpo_email etc.).
CREATE INDEX IF NOT EXISTS idx_shops_locale ON shops (locale);
