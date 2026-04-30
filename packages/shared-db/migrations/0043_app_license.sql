-- App license (singleton row). S16.3 — Phase-C licence-key persistence.
-- Validation logic lives in @pharmacare/license; this table just stores the
-- last-issued key + decoded metadata so the desktop app can load it on boot
-- without re-prompting.

CREATE TABLE IF NOT EXISTS app_license (
    id              TEXT PRIMARY KEY DEFAULT 'singleton',
    key_text        TEXT NOT NULL,
    edition_flags   INTEGER NOT NULL,
    expiry_iso      TEXT NOT NULL,
    fingerprint     TEXT NOT NULL,
    issued_at       TEXT NOT NULL DEFAULT (datetime('now')),
    last_validated  TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (id = 'singleton')
);
