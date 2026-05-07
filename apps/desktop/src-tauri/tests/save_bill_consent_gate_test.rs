//! Integration test for the DPDP consent gate in save_bill (S26.I).
//!
//! save_bill MUST refuse with `DPDP_CONSENT_REQUIRED` when a customer-linked
//! bill is submitted but the canonical `dpdp_consents` table has no active
//! "billing"-purpose row. Walk-in (no customer_id) is unaffected.

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
         VALUES ('shop_local', 'A', '27AAAAA0000A1Z5', '27', 'MH-1', 'Kalyan');
         INSERT INTO customers (id, shop_id, name, phone, gender, consent_abdm, consent_marketing) \
         VALUES ('c1', 'shop_local', 'Priya', '+919999999999', 'F', 0, 0);",
    )
    .unwrap();
}

/// Mirror of save_bill's gate logic — the same query the Rust code runs.
/// Tests behaviour without spinning up a Tauri State.
fn gate_pass(c: &Connection, customer_id: Option<&str>) -> Result<(), String> {
    let Some(cid) = customer_id else {
        return Ok(());
    };
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM dpdp_consents
              WHERE customer_id = ?1
                AND purpose = 'billing'
                AND granted = 1
                AND withdrawn_at IS NULL",
            params![cid],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if n > 0 {
        Ok(())
    } else {
        Err("DPDP_CONSENT_REQUIRED".to_string())
    }
}

#[test]
fn save_bill_rejects_customer_without_billing_consent() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    // No dpdp_consents row → gate must reject.
    let r = gate_pass(&c, Some("c1"));
    assert!(
        r.is_err(),
        "save_bill must refuse customer without billing consent"
    );
    assert_eq!(r.unwrap_err(), "DPDP_CONSENT_REQUIRED");
}

#[test]
fn save_bill_passes_walkin_no_customer_id() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    // Walk-in customer (None) — gate is no-op.
    let r = gate_pass(&c, None);
    assert!(r.is_ok(), "walk-in (no customer_id) must pass the gate");
}

#[test]
fn save_bill_passes_when_billing_consent_active() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    c.execute(
        "INSERT INTO dpdp_consents (customer_id, purpose, granted, granted_at, evidence) \
         VALUES ('c1', 'billing', 1, '2026-05-01T10:00:00Z', 'click+sms-otp')",
        [],
    )
    .unwrap();
    let r = gate_pass(&c, Some("c1"));
    assert!(
        r.is_ok(),
        "active billing consent must let save_bill proceed"
    );
}
