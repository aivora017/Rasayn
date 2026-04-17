-- Migration 0016 — A12 e-invoice IRN (Cygnet primary, ClearTax secondary)
-- Adds: irn_records, einvoice_audit tables; extends bills + shops.
-- See docs/adr/0017-a12-einvoice-irn.md for design rationale.

-- ============================================================
-- 1) shops — turnover + feature flag + vendor + encrypted API key
-- ============================================================

ALTER TABLE shops ADD COLUMN annual_turnover_paise INTEGER NOT NULL DEFAULT 0
  CHECK (annual_turnover_paise >= 0);

ALTER TABLE shops ADD COLUMN einvoice_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (einvoice_enabled IN (0, 1));

ALTER TABLE shops ADD COLUMN einvoice_vendor TEXT NOT NULL DEFAULT 'cygnet'
  CHECK (einvoice_vendor IN ('cygnet', 'cleartax'));

ALTER TABLE shops ADD COLUMN einvoice_api_key_enc TEXT NULL;

-- ============================================================
-- 2) bills — denormalised IRN fields for print-time + GSTR-1 reconciliation
-- ============================================================

-- bills.e_invoice_irn already exists (see 0001_init.sql); we reuse it as the IRN column.
ALTER TABLE bills ADD COLUMN ack_no TEXT NULL;
ALTER TABLE bills ADD COLUMN ack_date TEXT NULL;  -- ISO-8601 UTC
ALTER TABLE bills ADD COLUMN qr_code TEXT NULL;   -- signed payload string
ALTER TABLE bills ADD COLUMN einvoice_status TEXT NULL
  CHECK (einvoice_status IS NULL OR einvoice_status IN (
    'n/a', 'pending', 'submitted', 'acked', 'cancelled', 'failed'
  ));

CREATE INDEX IF NOT EXISTS idx_bills_einvoice_status
  ON bills(shop_id, einvoice_status)
  WHERE einvoice_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bills_irn
  ON bills(e_invoice_irn) WHERE e_invoice_irn IS NOT NULL;

-- ============================================================
-- 3) irn_records — one row per submission-attempt-lineage
-- ============================================================

CREATE TABLE irn_records (
  id                TEXT PRIMARY KEY,
  bill_id           TEXT NOT NULL REFERENCES bills(id),
  shop_id           TEXT NOT NULL REFERENCES shops(id),
  vendor            TEXT NOT NULL
                     CHECK (vendor IN ('cygnet', 'cleartax', 'mock')),
  status            TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN (
                       'pending', 'submitted', 'acked',
                       'cancelled', 'failed'
                     )),
  irn               TEXT NULL,
  ack_no            TEXT NULL,
  ack_date          TEXT NULL,
  signed_invoice    TEXT NULL,
  qr_code           TEXT NULL,
  payload_json      TEXT NOT NULL,
  response_json     TEXT NULL,
  error_code        TEXT NULL,
  error_msg         TEXT NULL,
  attempt_count     INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at   TEXT NULL,
  submitted_at      TEXT NULL,
  cancelled_at      TEXT NULL,
  cancel_reason     TEXT NULL,
  cancel_remarks    TEXT NULL,
  actor_user_id     TEXT NOT NULL REFERENCES users(id),
  created_at        TEXT NOT NULL
                     DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- ack fields required once status = 'acked'
  CHECK (
    (status <> 'acked') OR
    (irn IS NOT NULL AND ack_no IS NOT NULL
     AND ack_date IS NOT NULL AND signed_invoice IS NOT NULL
     AND qr_code IS NOT NULL)
  ),

  -- cancel fields required once status = 'cancelled'
  CHECK (
    (status <> 'cancelled') OR
    (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)
  ),

  -- failed must have error
  CHECK (
    (status <> 'failed') OR
    (error_code IS NOT NULL AND error_msg IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_irn_records_bill
  ON irn_records(bill_id);

CREATE INDEX IF NOT EXISTS idx_irn_records_shop_status
  ON irn_records(shop_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_irn_records_irn
  ON irn_records(irn) WHERE irn IS NOT NULL;

-- At most one active (non-failed non-cancelled) record per bill.
CREATE UNIQUE INDEX IF NOT EXISTS uq_irn_records_one_active_per_bill
  ON irn_records(bill_id)
  WHERE status IN ('pending', 'submitted', 'acked');

-- ============================================================
-- 4) Triggers — enforce status monotonic transitions
-- ============================================================

-- Allowed transitions:
--   pending   -> submitted | acked | failed | cancelled
--   submitted -> acked | failed | cancelled
--   acked     -> cancelled
--   failed    -> (terminal; create a new row to retry)
--   cancelled -> (terminal)
CREATE TRIGGER trg_irn_records_status_transition
BEFORE UPDATE OF status ON irn_records
FOR EACH ROW
WHEN NEW.status <> OLD.status
BEGIN
  SELECT CASE
    WHEN OLD.status = 'pending'   AND NEW.status IN ('submitted','acked','failed','cancelled') THEN NULL
    WHEN OLD.status = 'submitted' AND NEW.status IN ('acked','failed','cancelled') THEN NULL
    WHEN OLD.status = 'acked'     AND NEW.status =  'cancelled' THEN NULL
    ELSE RAISE(ABORT, 'IRN_STATUS_TRANSITION_INVALID')
  END;
END;

-- attempt_count is monotonic non-decreasing
CREATE TRIGGER trg_irn_records_attempt_count_monotonic
BEFORE UPDATE OF attempt_count ON irn_records
FOR EACH ROW
WHEN NEW.attempt_count < OLD.attempt_count
BEGIN
  SELECT RAISE(ABORT, 'IRN_ATTEMPT_COUNT_DECREASE');
END;

-- Mirror latest irn_records status onto bills.einvoice_status
CREATE TRIGGER trg_bills_einvoice_status_sync_insert
AFTER INSERT ON irn_records
FOR EACH ROW
BEGIN
  UPDATE bills SET einvoice_status = NEW.status
    WHERE id = NEW.bill_id;
END;

CREATE TRIGGER trg_bills_einvoice_status_sync_update
AFTER UPDATE OF status ON irn_records
FOR EACH ROW
WHEN NEW.status <> OLD.status
BEGIN
  UPDATE bills SET
    einvoice_status = NEW.status,
    e_invoice_irn = COALESCE(NEW.irn, e_invoice_irn),
    ack_no = COALESCE(NEW.ack_no, ack_no),
    ack_date = COALESCE(NEW.ack_date, ack_date),
    qr_code = COALESCE(NEW.qr_code, qr_code)
  WHERE id = NEW.bill_id;
END;

-- No DELETE on irn_records (audit trail)
CREATE TRIGGER trg_irn_records_no_delete
BEFORE DELETE ON irn_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'IRN_RECORDS_APPEND_ONLY');
END;

-- ============================================================
-- 5) einvoice_audit — CERT-In compliance (every submit/cancel attempt)
-- ============================================================

CREATE TABLE einvoice_audit (
  id             TEXT PRIMARY KEY,
  irn_record_id  TEXT NOT NULL REFERENCES irn_records(id),
  event          TEXT NOT NULL
                  CHECK (event IN (
                    'submit_attempt', 'submit_success', 'submit_failure',
                    'cancel_attempt', 'cancel_success', 'cancel_failure',
                    'manual_retry'
                  )),
  actor_user_id  TEXT NOT NULL REFERENCES users(id),
  shop_id        TEXT NOT NULL REFERENCES shops(id),
  details        TEXT NULL,  -- JSON; API key redacted
  at             TEXT NOT NULL
                  DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_einvoice_audit_irn
  ON einvoice_audit(irn_record_id);

CREATE INDEX IF NOT EXISTS idx_einvoice_audit_shop_at
  ON einvoice_audit(shop_id, at);

-- No UPDATE / DELETE on audit
CREATE TRIGGER trg_einvoice_audit_no_update
BEFORE UPDATE ON einvoice_audit
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'EINVOICE_AUDIT_APPEND_ONLY');
END;

CREATE TRIGGER trg_einvoice_audit_no_delete
BEFORE DELETE ON einvoice_audit
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'EINVOICE_AUDIT_APPEND_ONLY');
END;
