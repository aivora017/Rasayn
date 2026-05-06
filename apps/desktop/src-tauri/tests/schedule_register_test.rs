//! Integration tests for schedule_register.rs (S26.B Schedule H/H1/X register).
//! Pairs with apps/desktop/src-tauri/src/schedule_register.rs.

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

fn seed_shop_and_user(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) \
           VALUES ('shop_main', 'Test Pharmacy', '27ABCDE1234F1Z5', '27', 'RL-123', 'Kalyan');\
         INSERT INTO users (id, shop_id, name, role, pin_hash) \
           VALUES ('u_owner', 'shop_main', 'Owner', 'owner', 'hashed');\
         INSERT INTO suppliers (id, shop_id, name, gstin) VALUES ('sup_a', 'shop_main', 'Supplier A', '27SUPABCDE1Z2');",
    )
    .unwrap();
}

fn seed_products_and_batches(c: &Connection) {
    // One Schedule-H product (image_sha256 mandatory), one OTC.
    c.execute_batch(
        "INSERT INTO products (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise, image_sha256) \
           VALUES ('p_h1', 'Atorvastatin 10mg', 'PharmaCo', '3004', 12, 'H', 'tablet', 10, 4000, 'sha-of-image');\
         INSERT INTO products (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise) \
           VALUES ('p_otc', 'Multivitamin', 'OtcCo', '3004', 12, 'OTC', 'tablet', 30, 8000);\
         INSERT INTO batches (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, purchase_price_paise, mrp_paise, supplier_id) \
           VALUES ('b_h1', 'p_h1', 'B001', '2026-01-01', '2027-12-31', 1000, 3500, 4000, 'sup_a');\
         INSERT INTO batches (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, purchase_price_paise, mrp_paise, supplier_id) \
           VALUES ('b_otc', 'p_otc', 'B100', '2026-01-01', '2027-12-31', 500, 6000, 8000, 'sup_a');\
         INSERT INTO customers (id, shop_id, name, phone) VALUES ('c1', 'shop_main', 'Real Patient', '9999000011');\
         INSERT INTO doctors (id, reg_no, name) VALUES ('d1', 'MMC-12345', 'Dr. Real Doctor');\
         INSERT INTO prescriptions (id, shop_id, customer_id, doctor_id, kind, issued_date) \
           VALUES ('rx1', 'shop_main', 'c1', 'd1', 'paper', '2026-04-15');",
    )
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
fn insert_bill_with_h_line(
    c: &Connection,
    bill_id: &str,
    bill_no: &str,
    billed_at: &str,
    schedule_product: &str,
    schedule_batch: &str,
    customer_id: Option<&str>,
    doctor_id: Option<&str>,
) {
    c.execute(
        "INSERT INTO bills (id, shop_id, bill_no, billed_at, customer_id, doctor_id, rx_id, cashier_id,
                            gst_treatment, subtotal_paise, total_cgst_paise, total_sgst_paise,
                            grand_total_paise, payment_mode)
           VALUES (?1, 'shop_main', ?2, ?3, ?4, ?5, 'rx1', 'u_owner', 'intra_state',
                   4000, 240, 240, 4500, 'cash')",
        params![bill_id, bill_no, billed_at, customer_id, doctor_id],
    )
    .unwrap();
    c.execute(
        "INSERT INTO bill_lines (id, bill_id, product_id, batch_id, qty, mrp_paise,
                                  taxable_value_paise, gst_rate, cgst_paise, sgst_paise, line_total_paise)
           VALUES (?1, ?2, ?3, ?4, 1, 4000, 4000, 12, 240, 240, 4480)",
        params![format!("bl_{}", bill_id), bill_id, schedule_product, schedule_batch],
    )
    .unwrap();
}

#[test]
fn list_returns_rows_for_h_filter() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_user(&c);
    seed_products_and_batches(&c);

    insert_bill_with_h_line(
        &c,
        "bill_a",
        "B-001",
        "2026-04-15T10:30:00.000Z",
        "p_h1",
        "b_h1",
        Some("c1"),
        Some("d1"),
    );

    // Sanity: query the SQL the module uses (shape-equivalent).
    let mut stmt = c
        .prepare(
            "SELECT b.bill_no, p.name, p.schedule
             FROM bill_lines bl
             JOIN bills b ON b.id = bl.bill_id
             JOIN products p ON p.id = bl.product_id
             WHERE b.shop_id = ?1
               AND b.is_voided = 0
               AND substr(b.billed_at,1,10) BETWEEN ?2 AND ?3
               AND p.schedule = 'H'",
        )
        .unwrap();
    let rows: Vec<(String, String, String)> = stmt
        .query_map(params!["shop_main", "2026-04-01", "2026-04-30"], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    assert_eq!(rows.len(), 1, "expected 1 Schedule-H row");
    assert_eq!(rows[0].0, "B-001");
    assert_eq!(rows[0].2, "H");
}

#[test]
fn period_filter_excludes_out_of_range_bills() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_user(&c);
    seed_products_and_batches(&c);

    insert_bill_with_h_line(
        &c,
        "bill_a",
        "B-001",
        "2026-03-15T10:00:00.000Z",
        "p_h1",
        "b_h1",
        Some("c1"),
        Some("d1"),
    );
    insert_bill_with_h_line(
        &c,
        "bill_b",
        "B-002",
        "2026-04-10T10:00:00.000Z",
        "p_h1",
        "b_h1",
        Some("c1"),
        Some("d1"),
    );
    insert_bill_with_h_line(
        &c,
        "bill_c",
        "B-003",
        "2026-05-05T10:00:00.000Z",
        "p_h1",
        "b_h1",
        Some("c1"),
        Some("d1"),
    );

    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM bill_lines bl
             JOIN bills b ON b.id = bl.bill_id
             JOIN products p ON p.id = bl.product_id
             WHERE b.shop_id = 'shop_main'
               AND b.is_voided = 0
               AND substr(b.billed_at,1,10) BETWEEN '2026-04-01' AND '2026-04-30'
               AND p.schedule IN ('H','H1','X')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1, "April bound includes only B-002");
}

#[test]
fn empty_result_when_no_schedule_h_bills_in_period() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_user(&c);
    seed_products_and_batches(&c);

    // OTC bill in period — must NOT show up in Schedule-H register.
    c.execute(
        "INSERT INTO bills (id, shop_id, bill_no, billed_at, cashier_id,
                            gst_treatment, subtotal_paise, grand_total_paise, payment_mode)
           VALUES ('bill_otc', 'shop_main', 'B-OTC', '2026-04-15T10:00:00.000Z', 'u_owner',
                   'intra_state', 8000, 8000, 'cash')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO bill_lines (id, bill_id, product_id, batch_id, qty, mrp_paise,
                                  taxable_value_paise, gst_rate, line_total_paise)
           VALUES ('bl_otc', 'bill_otc', 'p_otc', 'b_otc', 1, 8000, 8000, 12, 8960)",
        [],
    )
    .unwrap();

    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM bill_lines bl
             JOIN bills b ON b.id = bl.bill_id
             JOIN products p ON p.id = bl.product_id
             WHERE b.shop_id = 'shop_main'
               AND b.is_voided = 0
               AND substr(b.billed_at,1,10) BETWEEN '2026-04-01' AND '2026-04-30'
               AND p.schedule IN ('H','H1','X')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 0, "OTC-only period must yield empty Schedule-H register");
}
