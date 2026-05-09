//! S26.I — DPDP §10 DPO/grievance columns + check_billing_consent mirror.
//! Pairs with apps/desktop/src-tauri/src/dpo_compliance.rs (no [lib], SQL-only).

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

#[test]
fn migration_0048_added_seven_dpo_columns_to_shops() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    let cols: Vec<String> = c
        .prepare("PRAGMA table_info(shops)")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    for want in [
        "dpo_name",
        "dpo_email",
        "dpo_phone",
        "grievance_officer_name",
        "grievance_officer_email",
        "cross_border_opinion_at",
        "cross_border_jurisdiction",
    ] {
        assert!(cols.iter().any(|c| c == want), "shops missing col {want}");
    }
}

#[test]
fn billing_consent_false_for_unknown_customer() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    assert!(!billing_consent(&c, "ghost"));
}

#[test]
fn billing_consent_true_for_active_billing_purpose_row() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    c.execute(
        "INSERT INTO dpdp_consents (customer_id, purpose, granted, granted_at, evidence) \
         VALUES ('c1', 'billing', 1, '2026-04-29T10:00:00Z', 'signed-form-v1')",
        [],
    )
    .unwrap();
    assert!(billing_consent(&c, "c1"));
}

#[test]
fn billing_consent_false_after_withdrawn_at_set() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    c.execute(
        "INSERT INTO dpdp_consents (customer_id, purpose, granted, granted_at, evidence) \
         VALUES ('c1', 'billing', 1, '2026-04-29T10:00:00Z', 'sig')",
        [],
    )
    .unwrap();
    c.execute(
        "UPDATE dpdp_consents SET granted = 0, withdrawn_at = '2026-05-01T08:00:00Z' \
         WHERE customer_id = 'c1' AND purpose = 'billing'",
        [],
    )
    .unwrap();
    assert!(!billing_consent(&c, "c1"));
}
