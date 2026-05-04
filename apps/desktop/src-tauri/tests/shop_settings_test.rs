//! Integration tests for shop_settings + return_no_counters (migration 0020).
//! Covers partial-refund window CHECK + per-shop FY sequence counter.

use rusqlite::{params, Connection};

fn apply_migrations_from_dir(c: &Connection) {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../packages/shared-db/migrations");
    let mut entries: Vec<_> = std::fs::read_dir(dir).unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "sql"))
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let sql = std::fs::read_to_string(entry.path()).unwrap();
        c.execute_batch(&sql).unwrap_or_else(|e| panic!("migration {}: {e}", entry.file_name().to_string_lossy()));
    }
}

fn seed(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) VALUES \
            ('shop_main', 'Test', '27ABCDE1234F1Z5', '27', 'RL-1', 'Kalyan');"
    ).unwrap();
}

#[test]
fn shop_settings_default_partial_refund_window_30() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    c.execute(
        "INSERT INTO shop_settings (shop_id, created_at) VALUES ('shop_main', datetime('now'))",
        [],
    ).unwrap();
    let days: i64 = c.query_row(
        "SELECT partial_refund_max_days FROM shop_settings WHERE shop_id='shop_main'",
        [], |r| r.get(0),
    ).unwrap();
    assert_eq!(days, 30);
}

#[test]
fn partial_refund_max_days_check_rejects_above_180() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    let bad = c.execute(
        "INSERT INTO shop_settings (shop_id, partial_refund_max_days, created_at) VALUES ('shop_main', 200, datetime('now'))",
        [],
    );
    assert!(bad.is_err(), "partial_refund_max_days > 180 should be rejected");
}

#[test]
fn return_no_counter_per_shop_per_fy_starts_at_zero() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    c.execute(
        "INSERT INTO return_no_counters (shop_id, fy_start_year, last_seq) VALUES ('shop_main', 2026, 0)",
        [],
    ).unwrap();
    let last: i64 = c.query_row(
        "SELECT last_seq FROM return_no_counters WHERE shop_id='shop_main' AND fy_start_year=2026",
        [], |r| r.get(0),
    ).unwrap();
    assert_eq!(last, 0);
}

#[test]
fn return_no_counter_increment_via_update_returning() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    c.execute(
        "INSERT INTO return_no_counters (shop_id, fy_start_year, last_seq) VALUES ('shop_main', 2026, 5)",
        [],
    ).unwrap();
    let next: i64 = c.query_row(
        "UPDATE return_no_counters SET last_seq = last_seq + 1 \
         WHERE shop_id = ?1 AND fy_start_year = ?2 \
         RETURNING last_seq",
        params!["shop_main", 2026], |r| r.get(0),
    ).unwrap();
    assert_eq!(next, 6);
}

#[test]
fn return_no_counter_pk_blocks_duplicate() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    c.execute(
        "INSERT INTO return_no_counters (shop_id, fy_start_year, last_seq) VALUES ('shop_main', 2026, 0)",
        [],
    ).unwrap();
    let dup = c.execute(
        "INSERT INTO return_no_counters (shop_id, fy_start_year, last_seq) VALUES ('shop_main', 2026, 0)",
        [],
    );
    assert!(dup.is_err(), "PK (shop_id, fy_start_year) should reject duplicates");
}
