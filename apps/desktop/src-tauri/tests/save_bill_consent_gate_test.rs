//! S26.I — save_bill DPDP consent gate (silent killer #5 follow-up).
//! Pairs with commands.rs ~line 267 (`if let Some(cid) = input.customer_id...`).
//!
//! save_bill is a #[tauri::command] that requires a tauri::State, which is
//! impractical to construct from an integration test. This file mirrors
//! ONLY the gate's three branches against a real DB so the contract is
//! pinned: walk-in bypasses, missing consent rejects with the exact error
//! string `DPDP_CONSENT_REQUIRED`, active consent passes through.

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

fn seed(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) \
           VALUES ('s1', 'A', '27ABCDE1234F1Z5', '27', 'RL-1', 'Kalyan');
         INSERT INTO customers (id, shop_id, name) VALUES ('c1', 's1', 'Priya');",
    )
    .unwrap();
}

/// Mirror of check_billing_consent_inner (dpo_compliance.rs).
fn billing_consent(c: &Connection, cid: &str) -> bool {
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM dpdp_consents
          WHERE customer_id = ?1 AND purpose = 'billing'
            AND granted = 1 AND withdrawn_at IS NULL",
            params![cid],
            |r| r.get(0),
        )
        .unwrap();
    n > 0
}

/// Mirror of the save_bill consent gate in commands.rs (~line 267).
/// Returns Ok(()) if the bill may proceed, Err("DPDP_CONSENT_REQUIRED")
/// otherwise. Walk-in bills (`customer_id == None`) skip the gate entirely.
fn consent_gate(c: &Connection, customer_id: Option<&str>) -> Result<(), String> {
    if let Some(cid) = customer_id {
        if !billing_consent(c, cid) {
            return Err("DPDP_CONSENT_REQUIRED".to_string());
        }
    }
    Ok(())
}

#[test]
fn walk_in_bill_with_no_customer_id_bypasses_gate() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    assert!(consent_gate(&c, None).is_ok());
}

#[test]
fn customer_without_consent_returns_dpdp_consent_required() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    let r = consent_gate(&c, Some("c1"));
    assert_eq!(r, Err("DPDP_CONSENT_REQUIRED".to_string()));
}

#[test]
fn customer_with_active_billing_consent_passes_gate() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    c.execute(
        "INSERT INTO dpdp_consents (customer_id, purpose, granted, granted_at, evidence) \
         VALUES ('c1', 'billing', 1, '2026-04-29T10:00:00Z', 'signed-form-v1')",
        [],
    )
    .unwrap();
    assert!(consent_gate(&c, Some("c1")).is_ok());
}
