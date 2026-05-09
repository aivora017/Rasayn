//! S26.I — auto_irn threshold gate (silent killer #1 follow-up).
//! Pairs with apps/desktop/src-tauri/src/auto_irn.rs.
//!
//! The desktop crate has no [lib] target so we cannot import
//! auto_submit_irn_inner directly. This test mirrors its three guard
//! clauses against a freshly migrated SQLite. NOTE: the production
//! `mock vendor` arm is gated on `!cfg!(debug_assertions)` AND the
//! shops.einvoice_vendor CHECK only allows 'cygnet'/'cleartax', so we
//! cover the threshold + bill-not-found paths here. The mock-vendor
//! release-build branch is already pinned by mock_adapter_release_gate_test.

use rusqlite::{params, Connection};

const TURNOVER_THRESHOLD_PAISE: i64 = 5_000_000_000;

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

/// Mirror of auto_submit_irn_inner (auto_irn.rs). In test builds the
/// "submitted" branch fires synchronously so the gate is observable.
fn auto_submit(c: &Connection, bill_id: &str) -> String {
    let row: Result<(i64, String, i64), _> = c.query_row(
        "SELECT s.einvoice_enabled, s.einvoice_vendor, s.annual_turnover_paise
         FROM bills b JOIN shops s ON s.id = b.shop_id WHERE b.id = ?1",
        params![bill_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    );
    let Ok((enabled, _vendor, turnover)) = row else {
        return "skipped (bill_not_found)".to_string();
    };
    if enabled == 0 || turnover < TURNOVER_THRESHOLD_PAISE {
        return "skipped (below threshold)".to_string();
    }
    "submitted".to_string()
}

fn seed_bill(c: &Connection, turnover: i64, einvoice_enabled: i64) {
    c.execute(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address, \
            annual_turnover_paise, einvoice_enabled, einvoice_vendor) \
         VALUES ('s1', 'A', '27ABCDE1234F1Z5', '27', 'RL-1', 'Kalyan', ?1, ?2, 'cygnet')",
        params![turnover, einvoice_enabled],
    )
    .unwrap();
    c.execute(
        "INSERT INTO users (id, shop_id, name, role, pin_hash) \
         VALUES ('u1', 's1', 'Cashier', 'cashier', 'hash')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO bills (id, shop_id, bill_no, cashier_id, gst_treatment, subtotal_paise, \
            grand_total_paise, payment_mode) \
         VALUES ('b1', 's1', 'INV-1', 'u1', 'intra_state', 50000, 50000, 'cash')",
        [],
    )
    .unwrap();
}

#[test]
fn returns_skipped_below_threshold_when_turnover_under_5cr() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed_bill(&c, 1_000_000, 1);
    assert_eq!(auto_submit(&c, "b1"), "skipped (below threshold)");
}

#[test]
fn returns_skipped_when_einvoice_disabled_even_above_threshold() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed_bill(&c, 6_000_000_000, 0);
    assert_eq!(auto_submit(&c, "b1"), "skipped (below threshold)");
}

#[test]
fn returns_bill_not_found_for_missing_bill_id() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    assert_eq!(auto_submit(&c, "ghost"), "skipped (bill_not_found)");
}
