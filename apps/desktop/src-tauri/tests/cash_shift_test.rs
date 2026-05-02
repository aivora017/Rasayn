//! Integration tests for cash_shifts schema (migration 0023).
//! Pairs with apps/desktop/src-tauri/src/cash_shift.rs.

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

fn seed_shop_and_user(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) \
           VALUES ('shop_main', 'Test Pharmacy', '27ABCDE1234F1Z5', '27', 'RL-123', 'Kalyan');
         INSERT INTO users (id, shop_id, name, role, pin_hash) \
           VALUES ('u_owner', 'shop_main', 'Owner', 'owner', 'hashed');"
    ).unwrap();
}

#[test]
fn open_shift_then_partial_index_finds_only_open() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_user(&c);

    c.execute(
        "INSERT INTO cash_shifts (id, shop_id, opened_by_user_id, opened_at, opening_balance_paise, opening_denominations_json) \
         VALUES (?1, 'shop_main', 'u_owner', ?2, ?3, ?4)",
        params!["s1", "2026-04-30T09:00:00Z", 100000_i64, "{\"100\":1000}"],
    ).unwrap();

    let n: i64 = c.query_row(
        "SELECT count(*) FROM cash_shifts WHERE shop_id='shop_main' AND closed_at IS NULL",
        [], |r| r.get(0),
    ).unwrap();
    assert_eq!(n, 1);
}

#[test]
fn close_shift_records_variance() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_user(&c);

    c.execute(
        "INSERT INTO cash_shifts (id, shop_id, opened_by_user_id, opened_at, opening_balance_paise, opening_denominations_json) \
         VALUES ('s1', 'shop_main', 'u_owner', '2026-04-30T09:00:00Z', 100000, '{}')",
        []
    ).unwrap();
    c.execute(
        "UPDATE cash_shifts SET closed_at=?1, closed_by_user_id='u_owner', \
            closing_balance_paise=?2, closing_denominations_json='{}', \
            expected_closing_paise=?3, variance_paise=?4 WHERE id='s1'",
        params!["2026-04-30T21:00:00Z", 250000_i64, 252000_i64, -2000_i64],
    ).unwrap();

    let (variance, expected): (i64, i64) = c.query_row(
        "SELECT variance_paise, expected_closing_paise FROM cash_shifts WHERE id='s1'",
        [], |r| Ok((r.get(0)?, r.get(1)?)),
    ).unwrap();
    assert_eq!(variance, -2000);
    assert_eq!(expected, 252000);
}

#[test]
fn partial_index_excludes_closed_shifts() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_user(&c);

    c.execute_batch(
        "INSERT INTO cash_shifts (id, shop_id, opened_by_user_id, opened_at, opening_balance_paise, opening_denominations_json, closed_at) \
           VALUES ('s_closed', 'shop_main', 'u_owner', '2026-04-29T09:00:00Z', 100000, '{}', '2026-04-29T21:00:00Z');
         INSERT INTO cash_shifts (id, shop_id, opened_by_user_id, opened_at, opening_balance_paise, opening_denominations_json) \
           VALUES ('s_open',   'shop_main', 'u_owner', '2026-04-30T09:00:00Z', 100000, '{}');"
    ).unwrap();

    let open_n: i64 = c.query_row(
        "SELECT count(*) FROM cash_shifts WHERE shop_id='shop_main' AND closed_at IS NULL",
        [], |r| r.get(0),
    ).unwrap();
    let total: i64 = c.query_row(
        "SELECT count(*) FROM cash_shifts WHERE shop_id='shop_main'",
        [], |r| r.get(0),
    ).unwrap();
    assert_eq!(open_n, 1);
    assert_eq!(total, 2);
}
