//! Integration tests for dpdp — consent registry + DSR queue.

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

fn seed_customer(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address, created_at) \
         VALUES ('shop_local', 'A', '27AAAAA0000A1Z5', '27', 'MH-1', 'Kalyan', '2026-01-01');
         INSERT INTO customers (id, shop_id, name, phone, gender, consent_abdm, consent_marketing, created_at) \
         VALUES ('c1', 'shop_local', 'Priya', '+919999999999', 'F', 0, 0, '2026-01-01');"
    ).unwrap();
}

#[test]
fn migration_creates_dpdp_tables() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    for tbl in ["dpdp_consents", "dpdp_dsr_requests"] {
        let n: i64 = c.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
            params![tbl], |r| r.get(0),
        ).unwrap();
        assert_eq!(n, 1);
    }
}

#[test]
fn consent_check_rejects_invalid_purpose() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_customer(&c);
    let r = c.execute(
        "INSERT INTO dpdp_consents (customer_id, purpose, granted, evidence) \
         VALUES ('c1', 'bogus_purpose', 1, 'sig')",
        [],
    );
    assert!(r.is_err(), "purpose CHECK must reject unknown values");
}

#[test]
fn consent_grant_then_withdraw_persists_both_timestamps() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_customer(&c);
    c.execute(
        "INSERT INTO dpdp_consents (customer_id, purpose, granted, granted_at, evidence) \
         VALUES ('c1', 'marketing', 1, '2026-04-29T10:00:00Z', 'click+sms-otp')",
        [],
    ).unwrap();
    c.execute(
        "UPDATE dpdp_consents SET granted = 0, withdrawn_at = '2026-05-15T08:00:00Z' \
         WHERE customer_id = 'c1' AND purpose = 'marketing'",
        [],
    ).unwrap();
    let (granted, granted_at, withdrawn): (i64, Option<String>, Option<String>) = c.query_row(
        "SELECT granted, granted_at, withdrawn_at FROM dpdp_consents WHERE customer_id='c1' AND purpose='marketing'",
        [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).unwrap();
    assert_eq!(granted, 0);
    assert!(granted_at.is_some());
    assert!(withdrawn.is_some());
}

#[test]
fn dsr_status_check_blocks_invalid() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_customer(&c);
    let r = c.execute(
        "INSERT INTO dpdp_dsr_requests (id, customer_id, kind, status) VALUES ('d1', 'c1', 'access', 'bogus')",
        [],
    );
    assert!(r.is_err());
}

#[test]
fn dsr_kind_check_blocks_invalid() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_customer(&c);
    let r = c.execute(
        "INSERT INTO dpdp_dsr_requests (id, customer_id, kind) VALUES ('d1', 'c1', 'bogus_kind')",
        [],
    );
    assert!(r.is_err());
}
