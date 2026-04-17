-- Migration 0018 — X2b perceptual hash (pHash) on product_images
-- ADR: docs/adr/0019-x2b-phash.md
-- Playbook: §4 Three Moats → X2 ("match precision ≥97% golden set")
-- Supersedes: none. Extends 0017_x2_product_images.sql.

-- 64-bit DCT-based perceptual hash stored as 16 hex chars.
-- NULL allowed for rows attached before X2b (backfill offline).
-- Reason: X2a shipped without phash; upgrading existing rows is a batch job, not a blocking migration.
ALTER TABLE product_images ADD COLUMN phash TEXT CHECK (phash IS NULL OR length(phash) = 16);

-- Index for Hamming-distance candidate lookup. SQLite has no native hamming;
-- application-layer filters on prefix buckets (first 2 hex chars) then computes distance.
CREATE INDEX IF NOT EXISTS idx_product_images_phash_prefix
  ON product_images(substr(phash, 1, 2))
  WHERE phash IS NOT NULL;

-- Audit column on product_image_audit for pHash visibility in forensics.
-- Optional since X2b may run behind a feature flag during rollout.
ALTER TABLE product_image_audit ADD COLUMN phash TEXT;
