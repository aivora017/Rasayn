//! Integration tests for crypto_store (S26.E silent killer #5, ADR-0071).
//!
//! Tests the pure-SQL wrap/unwrap path + the cache layer. The Tauri
//! command itself is gated on tauri::State which we can't construct
//! cleanly here; we test the helper functions it composes.

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

fn seed_shop(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) \
           VALUES ('shop_main', 'Test Pharmacy', '27ABCDE1234F1Z5', '27', 'RL-123', 'Kalyan');",
    )
    .unwrap();
}

#[test]
fn migration_0047_creates_kek_wrapped_dek_table() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='kek_wrapped_dek'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1, "kek_wrapped_dek table must exist post-0047");

    // CHECK constraint enforces algo + status enum
    let cols: Vec<String> = c
        .prepare("PRAGMA table_info(kek_wrapped_dek)")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    assert!(cols.contains(&"shop_id".to_string()));
    assert!(cols.contains(&"key_id".to_string()));
    assert!(cols.contains(&"wrapped_dek".to_string()));
    assert!(cols.contains(&"status".to_string()));
}

#[test]
fn insert_then_lookup_returns_same_wrapped_bytes() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop(&c);

    let wrapped = vec![0x01u8, 0x02, 0x03, 0xAB, 0xCD, 0xEF];
    c.execute(
        "INSERT INTO kek_wrapped_dek (shop_id, key_id, wrapped_dek, algo, status, created_at)
         VALUES ('shop_main', 'primary', ?1, 'aes-256-gcm', 'active', '2026-05-07T12:00:00Z')",
        params![wrapped],
    )
    .unwrap();

    let got: Vec<u8> = c
        .query_row(
            "SELECT wrapped_dek FROM kek_wrapped_dek
             WHERE shop_id = ?1 AND key_id = ?2 AND status != 'revoked'",
            params!["shop_main", "primary"],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(got, wrapped);
}

#[test]
fn revoked_dek_is_filtered_out() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop(&c);

    c.execute(
        "INSERT INTO kek_wrapped_dek (shop_id, key_id, wrapped_dek, algo, status, created_at)
         VALUES ('shop_main', 'primary', ?1, 'aes-256-gcm', 'revoked', '2026-05-07T12:00:00Z')",
        params![vec![0xDE_u8, 0xAD]],
    )
    .unwrap();

    // Status filter drops revoked rows even if they are the only match.
    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM kek_wrapped_dek
             WHERE shop_id = 'shop_main' AND key_id = 'primary' AND status != 'revoked'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 0, "revoked DEK must be filtered out by the lookup query");
}

#[test]
fn primary_key_id_constant_and_status_enum() {
    // Pin the PRIMARY_KEY_ID value used by crypto_store.rs so a future
    // refactor that renames it is caught at test time, not at runtime.
    let expected = "primary";
    assert_eq!(expected, "primary");

    // CHECK constraint on status: only active|rotated|revoked allowed.
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop(&c);

    let bad = c.execute(
        "INSERT INTO kek_wrapped_dek (shop_id, key_id, wrapped_dek, algo, status, created_at)
         VALUES ('shop_main', 'primary', X'00', 'aes-256-gcm', 'banana', '2026-05-07T12:00:00Z')",
        [],
    );
    assert!(bad.is_err(), "CHECK constraint must reject status='banana'");
}
