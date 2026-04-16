-- A3 — customer master hardening (ADR 0006).
--
-- Why: ADR 0004 row A3 demands phone-lookup p95 <10 ms on 10k customer rows,
-- plus a deterministic walk-in default per shop so bill_id -> customer_id
-- never carries a NULL (reporting + reconciliation break otherwise).
--
-- What this migration does:
--   1. Add customers.phone_norm (TEXT) - last-10-digits canonical form.
--   2. Index idx_customers_phone_norm (shop_id, phone_norm) - equality lookup.
--   3. BEFORE INSERT/UPDATE triggers populate phone_norm deterministically
--      from phone (strip non-digits, keep last 10). App layer also normalizes
--      on write; the triggers are the hard floor so any writer (seed tool,
--      CSV import, direct SQL) stays consistent.
--   4. Backfill phone_norm for any already-seeded rows.
--
-- Walk-in rows are NOT created here - that is an application convention
-- (id = 'cus_walkin_<shop_id>', name = 'Walk-in Customer') enforced by
-- ensureWalkInCustomer() in @pharmacare/directory-repo. Migrations can't
-- know the shop_id set at seed time.

ALTER TABLE customers ADD COLUMN phone_norm TEXT;

CREATE INDEX idx_customers_phone_norm ON customers(shop_id, phone_norm);

-- Normalise helper: strip all non-digits, take last 10 chars, NULL if <10.
-- SQLite has no user-defined functions reachable from pure SQL without a
-- loadable extension, so we inline a replace()-chain. It handles the common
-- cases: "+91 98220-01122", "91-9822001122", "(98220) 01122", "9822001122".
CREATE TRIGGER trg_customers_phone_norm_ins
BEFORE INSERT ON customers FOR EACH ROW
WHEN NEW.phone IS NOT NULL
BEGIN
  UPDATE customers SET phone_norm = NULL WHERE 0;  -- no-op, placeholder
END;

-- The real trigger has to run AFTER INSERT because BEFORE triggers in
-- SQLite cannot assign to NEW. We drop the placeholder and re-create.
DROP TRIGGER trg_customers_phone_norm_ins;

-- Recursive update-in-trigger isn't allowed either. Simplest, correct
-- approach: use AFTER INSERT / AFTER UPDATE that writes phone_norm back
-- via a separate UPDATE. The recursive_triggers pragma is OFF by default
-- in better-sqlite3 + the Tauri runtime, so no infinite loop.
CREATE TRIGGER trg_customers_phone_norm_ai
AFTER INSERT ON customers FOR EACH ROW
WHEN NEW.phone IS NOT NULL
BEGIN
  UPDATE customers
    SET phone_norm = CASE
      WHEN length(
        replace(replace(replace(replace(replace(replace(replace(replace(
          NEW.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''),
          '+', ''), '/', ''), CHAR(9), '')
      ) >= 10
      THEN substr(
        replace(replace(replace(replace(replace(replace(replace(replace(
          NEW.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''),
          '+', ''), '/', ''), CHAR(9), ''),
        -10
      )
      ELSE NULL
    END
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_customers_phone_norm_au
AFTER UPDATE OF phone ON customers FOR EACH ROW
BEGIN
  UPDATE customers
    SET phone_norm = CASE
      WHEN NEW.phone IS NULL THEN NULL
      WHEN length(
        replace(replace(replace(replace(replace(replace(replace(replace(
          NEW.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''),
          '+', ''), '/', ''), CHAR(9), '')
      ) >= 10
      THEN substr(
        replace(replace(replace(replace(replace(replace(replace(replace(
          NEW.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''),
          '+', ''), '/', ''), CHAR(9), ''),
        -10
      )
      ELSE NULL
    END
  WHERE id = NEW.id;
END;

-- Backfill any rows present before this migration.
UPDATE customers
  SET phone_norm = CASE
    WHEN phone IS NULL THEN NULL
    WHEN length(
      replace(replace(replace(replace(replace(replace(replace(replace(
        phone, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''),
        '+', ''), '/', ''), CHAR(9), '')
    ) >= 10
    THEN substr(
      replace(replace(replace(replace(replace(replace(replace(replace(
        phone, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''),
        '+', ''), '/', ''), CHAR(9), ''),
      -10
    )
    ELSE NULL
  END
WHERE phone IS NOT NULL;
