#![allow(dead_code)]

// Idempotency token helper (ADR-0030).
//
// Closes coverage gap C03 Ã¢â‚¬â€ duplicate bill/GRN/refund on network retry.
//
// Contract (mirrored in @pharmacare/idempotency TS package):
//   1. Caller passes (token: UUIDv7, request_hash: SHA-256 hex) alongside the payload.
//   2. We `SELECT response_json, request_hash FROM idempotency_tokens WHERE token = ?`.
//      - Hit + matching hash Ã¢â€ â€™ return cached response_json (no DB writes happened twice).
//      - Hit + different hash Ã¢â€ â€™ return Err("IDEMPOTENCY_CONFLICT") Ã¢â‚¬â€ caller bug.
//      - Miss Ã¢â€ â€™ caller proceeds; on success calls `record(...)` to persist.
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
///   Ok(Some(cached_response_json)) Ã¢â‚¬â€ token seen, hashes match Ã¢â€ â€™ caller MUST replay.
///   Ok(None)                       Ã¢â‚¬â€ token unseen Ã¢â€ â€™ caller proceeds; must call record() on success.
///   Err("IDEMPOTENCY_CONFLICT: ...") Ã¢â‚¬â€ token seen but request_hash differs.
///   Err(other)                      Ã¢â‚¬â€ DB error.
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

/// Nightly GC. Returns number of rows deleted. Cheap Ã¢â‚¬â€ index on expires_at.
pub fn gc(conn: &Connection) -> Result<usize, String> {
    let n = conn
        .execute(
            "DELETE FROM idempotency_tokens WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            [],
        )
        .map_err(|e| format!("idempotency gc: {e}"))?;
    Ok(n)
}
