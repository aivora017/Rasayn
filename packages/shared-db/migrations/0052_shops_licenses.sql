-- 0052_shops_licenses.sql
-- S28-B3: OnboardingWizard polish — extra license + grievance fields.
--
-- Drugs & Cosmetics Act 1940 + Rules 1945:
--   - Form 20 / 21 retail sale licence number is already collected as
--     `shops.retail_license` (migration 0001). This migration adds the
--     OPTIONAL PDF attestation path so the founder can attach a scan of
--     the licence inside the wizard (DPDP §8 + D&C compliance).
--   - Schedule-H sales without a corresponding licence number is a §22
--     violation; we add a SEPARATE column rather than overload
--     `retail_license` because some shops hold the Schedule-H licence
--     under a different number (e.g. linked to the registered pharmacist
--     rather than the shop).
--
-- DPDP Act 2023 §10:
--   - Migration 0048 already added `dpo_*` and `grievance_officer_*name/email`
--     columns. This adds the missing `grievance_officer_phone` so we can
--     mirror the wizard rules: name/email/phone for both DPO AND grievance
--     officer.
--
-- All columns are nullable (no `NOT NULL`) so the migration applies cleanly
-- to existing shop rows. Validation lives at the wizard / Tauri-cmd layer.

ALTER TABLE shops ADD COLUMN retail_license_pdf_path TEXT;
ALTER TABLE shops ADD COLUMN schedule_h_license_no TEXT;
ALTER TABLE shops ADD COLUMN grievance_officer_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_shops_schedule_h_license_no
  ON shops (schedule_h_license_no)
  WHERE schedule_h_license_no IS NOT NULL;
