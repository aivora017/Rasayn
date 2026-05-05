//! Unit tests for src/idempotency.rs (S24.1).
//!
//! The desktop crate has no `[lib]` target (binary-only), so we include the
//! source file directly via `#[path = ...]` — same trick used by
//! photo_grn_tiers_test.rs. The idempotency module is self-contained
//! (no `crate::` references), so this works cleanly.
//!
//! Pairs with apps/desktop/src-tauri/tests/idempotency_test.rs (schema-only
//! integration tests). This file exercises the pub fns: check/record/gc.

#[path = "../src/idempotency.rs"]
mod idempotency;

use rusqlite::Connection;

fn apply_migrations_from_dir(c: &Connection) {
    let dir = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/shared-db/migrations"
    );
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "sql"))
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let sql = std::fs::read_to_string(entry.path()).unwrap();
        c.execute_batch(&sql)
            .unwrap_or_else(|e| panic!("migration {}: {e}", entry.file_name().to_string_lossy()));
    }
}

fn seed(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) \
           VALUES ('shop_main', 'Test', '27ABCDE1234F1Z5', '27', 'RL-1', 'Kalyan');
         INSERT INTO users (id, shop_id, name, role, pin_hash) \
           VALUES ('u_owner', 'shop_main', 'Owner', 'owner', 'h');",
    )
    .unwrap();
}

#[test]
fn check_returns_none_for_unseen_token() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    let got = idempotency::check(&c, "unseen-token", "save_bill", "abc123").unwrap();
    assert!(got.is_none(), "unseen token must return None");
}

#[test]
fn record_then_check_returns_cached_response() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    idempotency::record(
        &c,
        "tok-1",
        "save_bill",
        "hash-abc",
        "{\"billId\":\"b_1\"}",
        "shop_main",
        "u_owner",
    )
    .unwrap();

    let cached = idempotency::check(&c, "tok-1", "save_bill", "hash-abc")
        .unwrap()
        .expect("second check must replay cached response");
    assert_eq!(cached, "{\"billId\":\"b_1\"}");
}

#[test]
fn check_rejects_same_token_with_different_hash() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    idempotency::record(
        &c,
        "tok-2",
        "save_bill",
        "hash-aaa",
        "{\"ok\":1}",
        "shop_main",
        "u_owner",
    )
    .unwrap();

    let err = idempotency::check(&c, "tok-2", "save_bill", "hash-bbb").unwrap_err();
    assert!(
        err.contains("IDEMPOTENCY_CONFLICT"),
        "different-hash replay must surface IDEMPOTENCY_CONFLICT, got: {err}"
    );
}

#[test]
fn gc_deletes_only_expired_rows() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    // Insert two rows directly so we control expires_at — record() always
    // sets expires_at = now + 24h, which would leave nothing for gc to find.
    c.execute_batch(
        "INSERT INTO idempotency_tokens \
           (token, command, request_hash, response_json, shop_id, actor_user_id, expires_at) VALUES \
            ('gc_old', 'save_bill', 'h', '{}', 'shop_main', 'u_owner', '2020-01-01T00:00:00.000Z'),
            ('gc_new', 'save_bill', 'h', '{}', 'shop_main', 'u_owner', '2099-12-31T00:00:00.000Z');"
    ).unwrap();

    let deleted = idempotency::gc(&c).unwrap();
    assert_eq!(deleted, 1, "gc should drop exactly the one expired row");

    let remaining: i64 = c
        .query_row(
            "SELECT count(*) FROM idempotency_tokens WHERE token = 'gc_new'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(remaining, 1, "fresh token must survive gc");

    let gone: i64 = c
        .query_row(
            "SELECT count(*) FROM idempotency_tokens WHERE token = 'gc_old'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(gone, 0, "expired token must be deleted by gc");
}

#[test]
fn round_trip_check_then_record_then_check() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    // 1st call: cache miss.
    let first = idempotency::check(&c, "rt-1", "save_grn", "h-rt").unwrap();
    assert!(first.is_none(), "first check must be a miss");

    // Caller proceeds with the command, then records.
    idempotency::record(
        &c,
        "rt-1",
        "save_grn",
        "h-rt",
        "{\"grnId\":\"g_1\"}",
        "shop_main",
        "u_owner",
    )
    .unwrap();

    // 2nd call (network retry): cache hit with replayed response.
    let second = idempotency::check(&c, "rt-1", "save_grn", "h-rt")
        .unwrap()
        .expect("retry must hit cache");
    assert_eq!(second, "{\"grnId\":\"g_1\"}");
}
