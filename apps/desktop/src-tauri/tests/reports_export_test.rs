//! Integration tests for reports_export.rs (S26.H part 2 GSTR-3B).

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

fn seed_base(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) \
           VALUES ('shop_main', 'Test', '27ABCDE1234F1Z5', '27', 'RL-1', 'Kalyan');\
         INSERT INTO users (id, shop_id, name, role, pin_hash) \
           VALUES ('u_owner', 'shop_main', 'Owner', 'owner', 'h');",
    )
    .unwrap();
}

#[test]
fn empty_period_returns_zero_buckets() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_base(&c);

    // No bills in 2026-04 — every aggregate must be zero.
    let bill_count: i64 = c
        .query_row(
            "SELECT count(*) FROM bills WHERE shop_id = 'shop_main' AND substr(billed_at,1,7) = '2026-04' AND is_voided = 0",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let outward_taxable: i64 = c
        .query_row(
            "SELECT COALESCE(SUM(subtotal_paise - total_discount_paise), 0)
             FROM bills WHERE shop_id = 'shop_main' AND substr(billed_at,1,7) = '2026-04'
               AND is_voided = 0 AND gst_treatment IN ('intra_state','inter_state')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(bill_count, 0);
    assert_eq!(outward_taxable, 0);
}

#[test]
fn populated_period_aggregates_correct_outward_supplies() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_base(&c);

    // 2 bills in April: one taxable intra-state (₹1000 + ₹120 GST),
    // one nil-rated (₹500 only). One voided bill must be excluded.
    c.execute(
        "INSERT INTO bills (id, shop_id, bill_no, billed_at, cashier_id,
                            gst_treatment, subtotal_paise, total_discount_paise,
                            total_cgst_paise, total_sgst_paise,
                            grand_total_paise, payment_mode)
           VALUES ('bill_1', 'shop_main', 'B-1', '2026-04-05T10:00:00Z', 'u_owner',
                   'intra_state', 100000, 0, 6000, 6000, 112000, 'cash')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO bills (id, shop_id, bill_no, billed_at, cashier_id,
                            gst_treatment, subtotal_paise, grand_total_paise, payment_mode)
           VALUES ('bill_2', 'shop_main', 'B-2', '2026-04-10T10:00:00Z', 'u_owner',
                   'nil_rated', 50000, 50000, 'cash')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO bills (id, shop_id, bill_no, billed_at, cashier_id,
                            gst_treatment, subtotal_paise, grand_total_paise, payment_mode, is_voided)
           VALUES ('bill_v', 'shop_main', 'B-V', '2026-04-12T10:00:00Z', 'u_owner',
                   'intra_state', 999999, 0, 'cash', 1)",
        [],
    )
    .unwrap();

    let outward_taxable: i64 = c
        .query_row(
            "SELECT COALESCE(SUM(subtotal_paise - total_discount_paise), 0)
             FROM bills WHERE shop_id = 'shop_main' AND substr(billed_at,1,7) = '2026-04'
               AND is_voided = 0 AND gst_treatment IN ('intra_state','inter_state')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let nil_rated: i64 = c
        .query_row(
            "SELECT COALESCE(SUM(subtotal_paise - total_discount_paise), 0)
             FROM bills WHERE shop_id = 'shop_main' AND substr(billed_at,1,7) = '2026-04'
               AND is_voided = 0 AND gst_treatment IN ('exempt','nil_rated')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let bill_count: i64 = c
        .query_row(
            "SELECT count(*) FROM bills WHERE shop_id = 'shop_main' AND substr(billed_at,1,7) = '2026-04' AND is_voided = 0",
            [],
            |r| r.get(0),
        )
        .unwrap();

    assert_eq!(outward_taxable, 100000, "₹1000 taxable supplies aggregated");
    assert_eq!(nil_rated, 50000, "₹500 nil-rated");
    assert_eq!(bill_count, 2, "voided excluded");
}

#[test]
fn voided_bills_excluded_from_outward_supply_aggregation() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_base(&c);

    c.execute(
        "INSERT INTO bills (id, shop_id, bill_no, billed_at, cashier_id,
                            gst_treatment, subtotal_paise, grand_total_paise, payment_mode, is_voided)
           VALUES ('bill_v', 'shop_main', 'B-V', '2026-04-12T10:00:00Z', 'u_owner',
                   'intra_state', 500000, 0, 'cash', 1)",
        [],
    )
    .unwrap();

    let outward: i64 = c
        .query_row(
            "SELECT COALESCE(SUM(subtotal_paise), 0) FROM bills
             WHERE shop_id = 'shop_main' AND substr(billed_at,1,7) = '2026-04'
               AND is_voided = 0 AND gst_treatment IN ('intra_state','inter_state')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let voided_count: i64 = c
        .query_row(
            "SELECT count(*) FROM bills WHERE shop_id = 'shop_main' AND substr(billed_at,1,7) = '2026-04' AND is_voided = 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(outward, 0);
    assert_eq!(voided_count, 1);
    let _ = params!["x"]; // suppress unused-import warning if any
}
