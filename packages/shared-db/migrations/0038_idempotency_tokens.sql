-- 0038_idempotency_tokens.sql
-- Idempotency tokens on critical Tauri write commands (ADR-0030).
-- Closes C03 from coverage_gaps_2026_04_18 — duplicate bill / GRN / refund risk
-- on network retry. UUIDv7 token in the command, dedup row keyed on token,
-- 24h TTL with periodic GC.

CREATE TABLE IF NOT EXISTS idempotency_tokens (
  token              TEXT PRIMARY KEY,                -- UUIDv7 from client
  command            TEXT NOT NULL,                   -- e.g. 'save_bill', 'save_grn', 'save_partial_return'
  request_hash       TEXT NOT NULL,                   -- SHA-256 of canonicalized request payload
  response_json      TEXT NOT NULL,                   -- cached successful response (replayed on retry)
  shop_id            TEXT NOT NULL,
  actor_user_id      TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at         TEXT NOT NULL,                   -- created_at + 24h
  FOREIGN KEY (shop_id) REFERENCES shops(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

-- GC index — find expired rows fast for nightly purge.
CREATE INDEX IF NOT EXISTS idx_idem_expires ON idempotency_tokens(expires_at);

-- Per-command audit index (debugging duplicate-submit incidents).
CREATE INDEX IF NOT EXISTS idx_idem_cmd_shop ON idempotency_tokens(shop_id, command, created_at);
