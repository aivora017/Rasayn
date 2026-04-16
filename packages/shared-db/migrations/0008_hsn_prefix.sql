-- PharmaCare Pro · HSN trigger — first-4-prefix rule (fix for seed data + real GST filing)
-- v0.1.0 · 2026-04-16 · ADR 0004 row A1 follow-up
--
-- Migration 0006 whitelisted HSN as a full-string match against
-- ('3003','3004','3005','3006','9018'). That's correct for the chapter
-- heading, but Indian GST filing for pharma shops > ₹5 Cr turnover requires
-- 8-digit HSN (e.g. '30049099' = chapter 30.04, heading 9099). Retail seed
-- data + GRN fixtures already use 8-digit codes — they failed the 4-only
-- trigger even though the chapter prefix is valid.
--
-- Correct rule: the FIRST FOUR CHARS of HSN must be in the whitelist. The
-- full string may be 4, 6, or 8 characters — all three are accepted by
-- GSTN.
--
-- This migration DROPS the old 4-only triggers and recreates them with the
-- prefix rule. Existing rows (all currently 4-char) continue to satisfy
-- the new rule trivially.

PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS trg_products_hsn_ins;
DROP TRIGGER IF EXISTS trg_products_hsn_upd;

CREATE TRIGGER trg_products_hsn_ins
BEFORE INSERT ON products
FOR EACH ROW
WHEN substr(NEW.hsn, 1, 4) NOT IN ('3003','3004','3005','3006','9018')
  OR length(NEW.hsn) NOT IN (4, 6, 8)
BEGIN
  SELECT RAISE(ABORT, 'HSN prefix must be 3003/3004/3005/3006/9018 and length 4, 6, or 8');
END;

CREATE TRIGGER trg_products_hsn_upd
BEFORE UPDATE OF hsn ON products
FOR EACH ROW
WHEN substr(NEW.hsn, 1, 4) NOT IN ('3003','3004','3005','3006','9018')
  OR length(NEW.hsn) NOT IN (4, 6, 8)
BEGIN
  SELECT RAISE(ABORT, 'HSN prefix must be 3003/3004/3005/3006/9018 and length 4, 6, or 8');
END;
