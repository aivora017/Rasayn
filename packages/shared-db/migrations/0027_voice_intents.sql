-- 0027_voice_intents.sql
-- Voice billing — intent log + ASR transcripts + corrections (training data).
-- Scaffold v1 generated 2026-04-28 from MASTER_PLAN_v3.

-- 0027: voice_intents (Whisper-Indic + Sarvam-Indus telemetry)

CREATE TABLE IF NOT EXISTS voice_intents (
  id              TEXT PRIMARY KEY,
  shop_id         TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  bill_id         TEXT,
  locale          TEXT NOT NULL CHECK (locale IN ('en-IN','hi-IN','mr-IN','gu-IN','ta-IN')),
  raw_audio_path  TEXT,
  transcript      TEXT NOT NULL,
  intent          TEXT NOT NULL,
  slots_json      TEXT NOT NULL,
  confidence      REAL NOT NULL,
  accepted        INTEGER,                  -- NULL = pending, 1 = accepted, 0 = corrected
  correction_json TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bill_id) REFERENCES bills(id)
);
CREATE INDEX IF NOT EXISTS idx_voice_intents_locale_acc ON voice_intents(locale, accepted);
