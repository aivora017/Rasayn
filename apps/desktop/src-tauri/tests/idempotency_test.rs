//! Integration tests for idempotency_tokens (migration 0038).
//! Pairs with apps/desktop/src-tauri/src/idempotency.rs.

use rusqlite::{params, Connection};

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
fn duplicate_token_insert_blocked_by_pk() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    c.execute(
        "INSERT INTO idempotency_tokens (token, command, request_hash, response_json, shop_id, actor_user_id, expires_at) \
         VALUES ('t1', 'save_bill', 'h1', '{\"ok\":1}', 'shop_main', 'u_owner', '2026-05-01T00:00:00Z')",
        [],
    ).unwrap();

    let dup = c.execute(
        "INSERT INTO idempotency_tokens (token, command, request_hash, response_json, shop_id, actor_user_id, expires_at) \
         VALUES ('t1', 'save_bill', 'h1', '{\"ok\":1}', 'shop_main', 'u_owner', '2026-05-01T00:00:00Z')",
        [],
    );
    assert!(dup.is_err(), "PK should reject duplicate token");
}

#[test]
fn gc_query_finds_only_expired() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    c.execute_batch(
        "INSERT INTO idempotency_tokens (token, command, request_hash, response_json, shop_id, actor_user_id, expires_at) VALUES \
            ('expired_1', 'save_bill', 'h', '{}', 'shop_main', 'u_owner', '2025-01-01T00:00:00Z'),
            ('expired_2', 'save_grn',  'h', '{}', 'shop_main', 'u_owner', '2025-12-31T23:59:59Z'),
            ('fresh_1',   'save_bill', 'h', '{}', 'shop_main', 'u_owner', '2099-12-31T00:00:00Z');"
    ).unwrap();

    let cutoff = "2026-04-30T00:00:00Z";
    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM idempotency_tokens WHERE expires_at < ?1",
            params![cutoff],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 2);
}

#[test]
fn audit_index_per_command() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    c.execute_batch(
        "INSERT INTO idempotency_tokens (token, command, request_hash, response_json, shop_id, actor_user_id, expires_at) VALUES \
            ('t1', 'save_bill', 'h1', '{}', 'shop_main', 'u_owner', '2099-12-31T00:00:00Z'),
            ('t2', 'save_bill', 'h2', '{}', 'shop_main', 'u_owner', '2099-12-31T00:00:00Z'),
            ('t3', 'save_grn',  'h3', '{}', 'shop_main', 'u_owner', '2099-12-31T00:00:00Z');"
    ).unwrap();

    let bills: i64 = c.query_row(
        "SELECT count(*) FROM idempotency_tokens WHERE shop_id='shop_main' AND command='save_bill'",
        [], |r| r.get(0),
    ).unwrap();
    assert_eq!(bills, 2);
}
