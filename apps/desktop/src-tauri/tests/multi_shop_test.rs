//! Integration tests for migration 0044 (batches.shop_id) and the
//! shop-scoped query patterns that back multi_shop.rs.

use rusqlite::Connection;

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
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) VALUES \
            ('shop_main',     'Jagannath Pharmacy',   '27ABCDE1234F1Z5', '27', 'RL-1', 'Kalyan'),
            ('shop_branch_2', 'Branch 2 Kalyan East', '27ABCDE1234F1Z5', '27', 'RL-2', 'Kalyan East');
         INSERT INTO suppliers (id, shop_id, name) VALUES ('sup_1', 'shop_main', 'TestDist');
         INSERT INTO products (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise, created_at, is_active) \
           VALUES ('p_para', 'Paracetamol 500mg', 'GSK', '30049011', 12, 'OTC', 'tab', 10, 200, '2026-01-01', 1);"
    ).unwrap();
}

#[test]
fn migration_0044_adds_shop_id_to_batches() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    let cols: Vec<String> = c
        .prepare("PRAGMA table_info(batches)")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert!(
        cols.contains(&"shop_id".to_string()),
        "shop_id col missing: {cols:?}"
    );
}

#[test]
fn batches_default_shop_main_when_inserted_without_shop_id() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    c.execute(
        "INSERT INTO batches (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, purchase_price_paise, mrp_paise, supplier_id) \
         VALUES ('b1', 'p_para', 'PARA-001', '2026-01-01', '2027-12-31', 100, 150, 200, 'sup_1')",
        [],
    ).unwrap();
    let shop: String = c
        .query_row("SELECT shop_id FROM batches WHERE id='b1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(shop, "shop_main");
}

#[test]
fn shop_scoped_query_separates_inventory_per_shop() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    // Two shops can't have the same (product_id, batch_no) due to legacy
    // UNIQUE â€” different batch numbers per shop.
    c.execute_batch(
        "INSERT INTO batches (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, purchase_price_paise, mrp_paise, supplier_id, shop_id) VALUES \
            ('b_main',   'p_para', 'PARA-MAIN-1',   '2026-01-01', '2027-12-31', 100, 150, 200, 'sup_1', 'shop_main'),
            ('b_branch', 'p_para', 'PARA-BRANCH-1', '2026-01-01', '2027-12-31',  50, 150, 200, 'sup_1', 'shop_branch_2');"
    ).unwrap();

    let main_qty: i64 = c
        .query_row(
            "SELECT COALESCE(SUM(qty_on_hand), 0) FROM batches WHERE shop_id='shop_main'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let branch_qty: i64 = c
        .query_row(
            "SELECT COALESCE(SUM(qty_on_hand), 0) FROM batches WHERE shop_id='shop_branch_2'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(main_qty, 100);
    assert_eq!(branch_qty, 50);
}

#[test]
fn shop_summary_groups_correctly() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    c.execute_batch(
        "INSERT INTO batches (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, purchase_price_paise, mrp_paise, supplier_id, shop_id) VALUES \
            ('b1', 'p_para', 'B1', '2026-01-01', '2027-12-31', 100, 150, 200, 'sup_1', 'shop_main'),
            ('b2', 'p_para', 'B2', '2026-01-01', '2027-12-31',  50, 150, 200, 'sup_1', 'shop_main'),
            ('b3', 'p_para', 'B3', '2026-01-01', '2027-12-31',  25, 150, 200, 'sup_1', 'shop_branch_2');"
    ).unwrap();

    let mut stmt = c
        .prepare(
            "SELECT s.id, COUNT(b.id), COALESCE(SUM(b.qty_on_hand), 0) \
         FROM shops s LEFT JOIN batches b ON b.shop_id = s.id AND b.qty_on_hand > 0 \
         GROUP BY s.id ORDER BY s.id",
        )
        .unwrap();
    let rows: Vec<(String, i64, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        rows,
        vec![
            ("shop_branch_2".to_string(), 1, 25),
            ("shop_main".to_string(), 2, 150),
        ]
    );
}
