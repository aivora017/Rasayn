//! Integration tests for khata_entries + khata_customer_limits (migration 0024).
//! Pairs with apps/desktop/src-tauri/src/khata.rs.

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
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) \
           VALUES ('shop_main', 'Test', '27ABCDE1234F1Z5', '27', 'RL-1', 'Kalyan');
         INSERT INTO users (id, shop_id, name, role, pin_hash) \
           VALUES ('u_owner', 'shop_main', 'Owner', 'owner', 'h');
         INSERT INTO customers (id, shop_id, name) \
           VALUES ('c1', 'shop_main', 'Asha Patil');"
    ).unwrap();
}

#[test]
fn purchase_then_payment_balances_zero() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    c.execute(
        "INSERT INTO khata_entries (id, customer_id, debit_paise, recorded_by_user_id) VALUES (?1, 'c1', ?2, 'u_owner')",
        params!["k1", 50000_i64],
    ).unwrap();
    c.execute(
        "INSERT INTO khata_entries (id, customer_id, credit_paise, recorded_by_user_id) VALUES (?1, 'c1', ?2, 'u_owner')",
        params!["k2", 50000_i64],
    ).unwrap();

    let bal: i64 = c.query_row(
        "SELECT COALESCE(SUM(debit_paise) - SUM(credit_paise), 0) FROM khata_entries WHERE customer_id='c1'",
        [], |r| r.get(0),
    ).unwrap();
    assert_eq!(bal, 0);
}

#[test]
fn check_constraint_blocks_both_sides_set() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    let r = c.execute(
        "INSERT INTO khata_entries (id, customer_id, debit_paise, credit_paise, recorded_by_user_id) \
         VALUES ('k_bad', 'c1', 100, 100, 'u_owner')",
        [],
    );
    assert!(r.is_err(), "CHECK constraint should reject both-sides-non-zero");
}

#[test]
fn customer_limits_default_risk_score_in_range() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    c.execute(
        "INSERT INTO khata_customer_limits (customer_id, credit_limit_paise, current_due_paise, default_risk_score) \
         VALUES ('c1', 100000, 0, 0.25)",
        [],
    ).unwrap();
    let bad = c.execute(
        "INSERT INTO khata_customer_limits (customer_id, credit_limit_paise, current_due_paise, default_risk_score) \
         VALUES ('c2', 100000, 0, 1.5)",
        [],
    );
    assert!(bad.is_err(), "default_risk_score CHECK should reject > 1.0");
}

#[test]
fn aging_query_orders_by_created_at() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    c.execute_batch(
        "INSERT INTO khata_entries (id, customer_id, debit_paise, recorded_by_user_id, created_at) VALUES \
            ('e1', 'c1', 1000, 'u_owner', '2026-01-01T10:00:00Z'),
            ('e2', 'c1', 2000, 'u_owner', '2026-04-01T10:00:00Z'),
            ('e3', 'c1', 3000, 'u_owner', '2026-04-30T10:00:00Z');"
    ).unwrap();

    let mut stmt = c.prepare(
        "SELECT id FROM khata_entries WHERE customer_id='c1' ORDER BY created_at ASC"
    ).unwrap();
    let ids: Vec<String> = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap()
        .collect::<Result<Vec<_>, _>>().unwrap();
    assert_eq!(ids, vec!["e1", "e2", "e3"]);
}
