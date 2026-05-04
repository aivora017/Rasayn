//! Integration tests for stock_movements (migration 0007) and the partial
//! UNIQUE index added in 0041 for stock-transfer reconciliation.

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
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) VALUES \
            ('shop_main', 'Test', '27ABCDE1234F1Z5', '27', 'RL-1', 'Kalyan');
         INSERT INTO suppliers (id, shop_id, name) VALUES ('sup_1', 'shop_main', 'TestDist');
         INSERT INTO products (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise, created_at, is_active) \
           VALUES ('p_para', 'Paracetamol', 'GSK', '30049011', 12, 'OTC', 'tab', 10, 200, '2026-01-01', 1);
         INSERT INTO batches (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, purchase_price_paise, mrp_paise, supplier_id) \
           VALUES ('b1', 'p_para', 'PARA-1', '2026-01-01', '2027-12-31', 100, 150, 200, 'sup_1');"
    ).unwrap();
}

#[test]
fn movement_type_check_blocks_unknown_kind() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    let bad = c.execute(
        "INSERT INTO stock_movements (id, batch_id, product_id, qty_delta, movement_type) \
         VALUES ('m_bad', 'b1', 'p_para', 10, 'magic')",
        [],
    );
    assert!(
        bad.is_err(),
        "movement_type 'magic' should be rejected by CHECK"
    );
}

#[test]
fn qty_delta_zero_blocked() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    let bad = c.execute(
        "INSERT INTO stock_movements (id, batch_id, product_id, qty_delta, movement_type) \
         VALUES ('m_zero', 'b1', 'p_para', 0, 'adjust')",
        [],
    );
    assert!(bad.is_err(), "qty_delta = 0 should be rejected by CHECK");
}

#[test]
fn opening_grn_bill_movements_aggregate_correctly() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    c.execute_batch(
        "INSERT INTO stock_movements (id, batch_id, product_id, qty_delta, movement_type) VALUES \
            ('m2', 'b1', 'p_para',  50, 'grn'),
            ('m3', 'b1', 'p_para', -10, 'bill'),
            ('m4', 'b1', 'p_para',  -5, 'waste');",
    )
    .unwrap();
    let net: i64 = c
        .query_row(
            "SELECT COALESCE(SUM(qty_delta), 0) FROM stock_movements WHERE batch_id='b1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(net, 135);
}

#[test]
fn partial_unique_index_blocks_double_transfer_reconcile() {
    // Migration 0041 added a partial UNIQUE index on
    // stock_movements(ref_id) WHERE ref_table = 'stock_transfer_lines'
    // so a transfer line can be reconciled exactly once.
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    c.execute(
        "INSERT INTO stock_movements (id, batch_id, product_id, qty_delta, movement_type, ref_table, ref_id) \
         VALUES ('m_tr', 'b1', 'p_para', -5, 'transfer_out', 'stock_transfer_lines', 'stl_1')",
        [],
    ).unwrap();
    let dup = c.execute(
        "INSERT INTO stock_movements (id, batch_id, product_id, qty_delta, movement_type, ref_table, ref_id) \
         VALUES ('m_tr2', 'b1', 'p_para', -5, 'transfer_out', 'stock_transfer_lines', 'stl_1')",
        [],
    );
    assert!(dup.is_err(), "Partial UNIQUE on (ref_id) WHERE ref_table='stock_transfer_lines' should block double reconcile");

    // But a movement with a different ref_table Ã¢â‚¬â€ say a bill Ã¢â‚¬â€ can reuse the same ref_id.
    c.execute(
        "INSERT INTO stock_movements (id, batch_id, product_id, qty_delta, movement_type, ref_table, ref_id) \
         VALUES ('m_bill', 'b1', 'p_para', -3, 'bill', 'bill_lines', 'stl_1')",
        [],
    ).unwrap();
    let n_bill: i64 = c
        .query_row(
            "SELECT count(*) FROM stock_movements WHERE ref_table='bill_lines' AND ref_id='stl_1'",
            params![],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n_bill, 1);
}
