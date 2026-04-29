-- 0044_whatsapp_outbox.sql
-- WhatsApp outbound queue. Persisted so messages survive app restart.
-- Status state machine: queued → sending → sent → delivered → read
--                                      → failed (retryable until attempts >= 5)

CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id                   TEXT PRIMARY KEY,
  to_phone             TEXT NOT NULL,
  template_key         TEXT NOT NULL,
  locale               TEXT NOT NULL,
  values_json          TEXT NOT NULL,
  rendered_body        TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('queued','sending','sent','delivered','read','failed')),
  attempts             INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at      TEXT,
  last_attempt_at      TEXT,
  provider_message_id  TEXT,
  error_reason         TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_status ON whatsapp_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_phone  ON whatsapp_outbox(to_phone);
