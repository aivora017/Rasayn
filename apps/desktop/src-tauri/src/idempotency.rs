// Idempotency token helper (ADR-0030).
//
// Closes coverage gap C03 — duplicate bill/GRN/refund on network retry.
//
// Contract (mirrored in @pharmacare/idempotency TS package):
//   1. Caller passes (token: UUIDv7, request_hash: SHA-256 hex) alongside the payload.
//   2. We `SELECT response_json, request_hash FROM idempotency_tokens WHERE token = ?`.
//      - Hit + matching hash → return cached response_json (no DB writes happened twice).
//      - Hit + different hash → return Err("IDEMPOTENCY_CONFLICT") — caller bug.
//      - Miss → caller proceeds; on success calls `record(...)` to persist.
//   3. Nightly GC removes rows where expires_at < now (run from backup_scheduler).
//
// Rationale:
//   * Per-row TTL = 24h matches @pharmacare/idempotency TOKEN_TTL_MS.
//   * `request_hash` lets us detect same-token-different-payload (which would
//      otherwise silently replay the wrong cached response).
//   * `command` is stored for forensic queries (which command was retried).

use rusqlite::{params, Connection, OptionalExtension};

/// Check whether this token has been seen before.
///
/// Returns:
///   Ok(Some(cached_response_json)) — token seen, hashes match → caller MUST replay.
///   Ok(None)                       — token unseen → caller proceeds; must call record() on success.
///   Err("IDEMPOTENCY_CONFLICT: ...") — token seen but request_hash differs.
///   Err(other)                      — DB error.
pub fn check(
    conn: &Connection,
    token: &str,
    command: &str,
    request_hash: &str,
) -> Result<Option<String>, String> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT request_hash, response_json FROM idempotency_tokens WHERE token = ?1",
            params![token],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match row {
        None => Ok(None),
        Some((stored_hash, response_json)) => {
            if stored_hash == request_hash {
                Ok(Some(response_json))
            } else {
                Err(format!(
                    "IDEMPOTENCY_CONFLICT: token {} previously used for command {} \
                     with a different payload. Generate a new token for new requests.",
                    token, command
                ))
            }
        }
    }
}

/// Persist a (token, command, request_hash, response_json) tuple after the
/// command succeeds. Caller is responsible for ensuring this happens inside
/// the same transaction as the side-effects of the command (otherwise a crash
/// between commit() and record() would leave a window where the retry still
/// duplicates work).
pub fn record(
    conn: &Connection,
    token: &str,
    command: &str,
    request_hash: &str,
    response_json: &str,
    shop_id: &str,
    actor_user_id: &str,
) -> Result<(), String> {
    // expires_at = now + 24h, ISO 8601 UTC. SQLite's strftime gives us this.
    conn.execute(
        "INSERT INTO idempotency_tokens
           (token, command, request_hash, response_json, shop_id, actor_user_id, created_at, expires_at)
         VALUES
           (?1, ?2, ?3, ?4, ?5, ?6,
            strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            strftime('%Y-%m-%dT%H:%M:%fZ','now', '+1 day'))",
        params![token, command, request_hash, response_json, shop_id, actor_user_id],
    )
    .map_err(|e| format!("idempotency record: {e}"))?;
    Ok(())
}

/// Nightly GC. Returns number of rows deleted. Cheap — index on expires_at.
pub fn gc(conn: &Connection) -> Result<usize, String> {
    let n = conn
        .execute(
            "DELETE FROM idempotency_tokens WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            [],
        )
        .map_err(|e| format!("idempotency gc: {e}"))?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn make_db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE idempotency_tokens (
                token TEXT PRIMARY KEY,
                command TEXT NOT NULL,
                request_hash TEXT NOT NULL,
                response_json TEXT NOT NULL,
                shop_id TEXT NOT NULL,
                actor_user_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                expires_at TEXT NOT NULL
            );
            CREATE INDEX idx_idem_expires ON idempotency_tokens(expires_at);",
        )
        .unwrap();
        c
    }

    #[test]
    fn check_returns_none_for_unseen_token() {
        let c = make_db();
        let r = check(&c, "tok-1", "save_bill", "hash-a").unwrap();
        assert!(r.is_none());
    }

    #[test]
    fn record_then_check_replays_response() {
        let c = make_db();
        record(&c, "tok-1", "save_bill", "hash-a", r#"{"ok":true}"#, "shop_local", "user_owner").unwrap();
        let r = check(&c, "tok-1", "save_bill", "hash-a").unwrap();
        assert_eq!(r, Some(r#"{"ok":true}"#.to_string()));
    }

    #[test]
    fn check_returns_conflict_when_hash_differs() {
        let c = make_db();
        record(&c, "tok-1", "save_bill", "hash-a", r#"{"ok":true}"#, "shop_local", "user_owner").unwrap();
        let err = check(&c, "tok-1", "save_bill", "hash-DIFFERENT").unwrap_err();
        assert!(err.starts_with("IDEMPOTENCY_CONFLICT"));
        assert!(err.contains("tok-1"));
    }

    #[test]
    fn record_twice_with_same_token_fails_unique() {
        let c = make_db();
        record(&c, "tok-1", "save_bill", "hash-a", r#"{}"#, "shop_local", "user_owner").unwrap();
        let err = record(&c, "tok-1", "save_bill", "hash-a", r#"{}"#, "shop_local", "user_owner").unwrap_err();
        assert!(err.contains("UNIQUE") || err.contains("PRIMARY"), "got: {err}");
    }

    #[test]
    fn gc_purges_expired_rows() {
        let c = make_db();
        // Insert with manually crafted expires_at in the past.
        c.execute(
            "INSERT INTO idempotency_tokens
               (token, command, request_hash, response_json, shop_id, actor_user_id, created_at, expires_at)
             VALUES
               ('tok-old', 'save_bill', 'h', '{}', 'shop_local', 'user', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')",
            [],
        )
        .unwrap();
        // And one fresh.
        record(&c, "tok-new", "save_bill", "h", "{}", "shop_local", "user").unwrap();

        let n = gc(&c).unwrap();
        assert_eq!(n, 1, "exactly one expired row");

        // The fresh one should still be there.
        let still: Option<String> = c
            .query_row(
                "SELECT response_json FROM idempotency_tokens WHERE token = 'tok-new'",
                [],
                |r| r.get(0),
            )
            .ok();
        assert!(still.is_some());
    }
}
