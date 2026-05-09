//! S26.E silent killer #5 — kek_wrapped_dek schema + insert/lookup mirror.
//! Pairs with apps/desktop/src-tauri/src/crypto_store.rs (no [lib], so SQL-only).

use rusqlite::{params, Connection};

fn apply_migrations(c: &Connection) {
    let dir = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/shared-db/migrations"
    );
    let mut e: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "sql"))
        .collect();
    e.sort_by_key(|e| e.file_name());
    for entry in e {
        let sql = std::fs::read_to_string(entry.path()).unwrap();
        c.execute_batch(&sql)
            .unwrap_or_else(|err| panic!("{}: {err}", entry.file_name().to_string_lossy()));
    }
}

#[test]
fn migration_0047_creates_seven_columns() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    let cols: Vec<String> = c
        .prepare("PRAGMA table_info(kek_wrapped_dek)")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    for want in [
        "shop_id",
        "key_id",
        "wrapped_dek",
        "algo",
        "status",
        "created_at",
        "rotated_at",
    ] {
        assert!(cols.iter().any(|c| c == want), "missing col {want}");
    }
    assert_eq!(cols.len(), 7, "expected 7 columns, got {cols:?}");
}

#[test]
fn insert_then_lookup_round_trip_same_bytes() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    let payload: Vec<u8> = vec![1, 2, 3, 4, 5, 6, 7, 8];
    c.execute(
        "INSERT INTO kek_wrapped_dek (shop_id, key_id, wrapped_dek, algo, status, created_at)
         VALUES ('s1', 'primary', ?1, 'aes-256-gcm', 'active', '2026-05-08T10:00:00Z')",
        params![payload],
    )
    .unwrap();
    let got: Vec<u8> = c
        .query_row(
            "SELECT wrapped_dek FROM kek_wrapped_dek
         WHERE shop_id = ?1 AND key_id = ?2 AND status != 'revoked'",
            params!["s1", "primary"],
            |r| r.get::<_, Vec<u8>>(0),
        )
        .unwrap();
    assert_eq!(got, payload);
}

#[test]
fn revoked_row_filtered_out_by_lookup_clause() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    c.execute(
        "INSERT INTO kek_wrapped_dek (shop_id, key_id, wrapped_dek, algo, status, created_at)
         VALUES ('s1', 'primary', x'aa', 'aes-256-gcm', 'revoked', '2026-05-08T10:00:00Z')",
        [],
    )
    .unwrap();
    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM kek_wrapped_dek
         WHERE shop_id = ?1 AND key_id = ?2 AND status != 'revoked'",
            params!["s1", "primary"],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 0, "revoked rows must be excluded");
}

#[test]
fn status_check_rejects_bad_enum_value() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    let r = c.execute(
        "INSERT INTO kek_wrapped_dek (shop_id, key_id, wrapped_dek, algo, status, created_at)
         VALUES ('s1', 'primary', x'aa', 'aes-256-gcm', 'banana', '2026-05-08T10:00:00Z')",
        [],
    );
    assert!(r.is_err(), "status CHECK must reject unknown enum values");
}
