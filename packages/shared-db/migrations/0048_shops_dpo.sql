-- 0048_shops_dpo.sql
-- DPDP §10 mandate: every Data Fiduciary (i.e. each pharmacy) must publish
-- a Data Protection Officer (DPO) and a grievance officer contact. The
-- founder is personally on the line for the first DSR (S26.I — Section 8.3
-- of the brutal-review compliance audit).
--
-- DPDP §16 cross-border-transfer status: before any cloud egress (Cygnet
-- IRP, ClearTax, future analytics), the shop must record (a) whether a
-- legal opinion has been filed and (b) the destination jurisdiction. NULL
-- means "not yet" — the auto-IRN scheduler reads these columns and refuses
-- to ship payloads when they are blank in a release build.

ALTER TABLE shops ADD COLUMN dpo_name TEXT;
ALTER TABLE shops ADD COLUMN dpo_email TEXT;
ALTER TABLE shops ADD COLUMN dpo_phone TEXT;
ALTER TABLE shops ADD COLUMN grievance_officer_name TEXT;
ALTER TABLE shops ADD COLUMN grievance_officer_email TEXT;

-- Cross-border transfer status (DPDP §16) — required to record before any
-- cloud egress.
ALTER TABLE shops ADD COLUMN cross_border_opinion_at TEXT; -- ISO date when legal opinion was filed; NULL = not yet
ALTER TABLE shops ADD COLUMN cross_border_jurisdiction TEXT; -- e.g. "AWS ap-south-1 / Cygnet"

CREATE INDEX IF NOT EXISTS idx_shops_dpo_email ON shops (dpo_email);
