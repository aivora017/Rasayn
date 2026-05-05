-- 0045_photo_grn_models.sql — photo-GRN model registry (S24.3, ADR-0069).
-- Tracks installed model bundles for the X3 Tier-B / Tier-C extractors.
-- A row is inserted by the installer post-step (S25) once the signed
-- bundle is verified; status flips to 'active' after the loader confirms
-- the sha256 matches the manifest.json shipped alongside the .onnx.

CREATE TABLE IF NOT EXISTS photo_grn_models (
  id          TEXT PRIMARY KEY,
  tier        TEXT NOT NULL CHECK (tier IN ('tier_b','tier_c')),
  version     TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  loaded_at   TEXT NOT NULL,           -- ISO 8601
  status      TEXT NOT NULL DEFAULT 'inactive'
              CHECK (status IN ('active','inactive','revoked'))
);

CREATE INDEX IF NOT EXISTS idx_photo_grn_models_tier_status
  ON photo_grn_models (tier, status);
