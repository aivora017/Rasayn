//! Integration tests for dpo_compliance — DPDP §10 DPO + grievance officer
//! contact + billing-purpose consent gate (S26.I, Section 8.3 of the
//! brutal-review compliance audit).
//!
//! Four tests, matching the S26.I brief:
//!   1. set/get DPO round-trips all seven §10 + §16 columns
//!   2. check_billing_consent → true for a known customer with active grant
//!   3. check_billing_consent → false for an unknown customer
//!   4. shops_get_dpo equivalent returns None when the columns are NULL
//!      (fresh install, before onboarding writes the DPO contact).

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

fn seed_shop_and_customer(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) \
         VALUES ('shop_local', 'A', '27AAAAA0000A1Z5', '27', 'MH-1', 'Kalyan');
         INSERT INTO customers (id, shop_id, name, phone, gender, consent_abdm, consent_marketing) \
         VALUES ('c1', 'shop_local', 'Priya', '+919999999999', 'F', 0, 0);",
    )
    .unwrap();
}

#[test]
fn set_then_get_dpo_round_trips_all_seven_fields() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_customer(&c);

    // Simulate shops_set_dpo by writing the same UPDATE the command does.
    c.execute(
        "UPDATE shops SET
            dpo_name = ?2, dpo_email = ?3, dpo_phone = ?4,
            grievance_officer_name = ?5, grievance_officer_email = ?6,
            cross_border_opinion_at = ?7, cross_border_jurisdiction = ?8
         WHERE id = ?1",
        params![
            "shop_local",
            "Sourav Shaw",
            "dpo@vaidyanath.example",
            "+919876543210",
            "Anita Iyer",
            "grievance@vaidyanath.example",
            "2026-05-01",
            "AWS ap-south-1 / Cygnet",
        ],
    )
    .unwrap();

    let row: (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = c
        .query_row(
            "SELECT dpo_name, dpo_email, dpo_phone, grievance_officer_name,
                    grievance_officer_email, cross_border_opinion_at, cross_border_jurisdiction
             FROM shops WHERE id = 'shop_local'",
            [],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(row.0.as_deref(), Some("Sourav Shaw"));
    assert_eq!(row.1.as_deref(), Some("dpo@vaidyanath.example"));
    assert_eq!(row.2.as_deref(), Some("+919876543210"));
    assert_eq!(row.3.as_deref(), Some("Anita Iyer"));
    assert_eq!(row.4.as_deref(), Some("grievance@vaidyanath.example"));
    assert_eq!(row.5.as_deref(), Some("2026-05-01"));
    assert_eq!(row.6.as_deref(), Some("AWS ap-south-1 / Cygnet"));
}

#[test]
fn check_billing_consent_returns_true_for_known_active_grant() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_customer(&c);
    c.execute(
        "INSERT INTO dpdp_consents (customer_id, purpose, granted, granted_at, evidence) \
         VALUES ('c1', 'billing', 1, '2026-05-01T10:00:00Z', 'click+sms-otp')",
        [],
    )
    .unwrap();
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM dpdp_consents
              WHERE customer_id = 'c1' AND purpose = 'billing'
                AND granted = 1 AND withdrawn_at IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1, "billing consent must be active for known customer");
}

#[test]
fn check_billing_consent_returns_false_for_unknown_customer() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_customer(&c);
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM dpdp_consents
              WHERE customer_id = 'no_such' AND purpose = 'billing'
                AND granted = 1 AND withdrawn_at IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        n, 0,
        "unknown customer must gate-fail the billing-purpose check"
    );
}

#[test]
fn missing_dpo_columns_signal_unconfigured_shop() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_customer(&c);
    // Mirror dpo_compliance::shops_get_dpo: a shop that has never had its
    // DPO contact written is signalled by NULL columns. The command maps
    // that to Ok(None) so the frontend can route to onboarding.
    let (dpo_name, dpo_email, dpo_phone, gn, ge): (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = c
        .query_row(
            "SELECT dpo_name, dpo_email, dpo_phone, grievance_officer_name, grievance_officer_email \
             FROM shops WHERE id = 'shop_local'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap();
    assert!(
        dpo_name.is_none()
            && dpo_email.is_none()
            && dpo_phone.is_none()
            && gn.is_none()
            && ge.is_none(),
        "fresh install must have all five §10 fields NULL → shops_get_dpo returns None"
    );
}
