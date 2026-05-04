//! Bill-save budget: §10 GA gate requires p95 < 400ms (warm DB, single-shop).
//! This bench seeds a realistic in-memory DB (1 shop, 1 user, 1 supplier,
//! 1 customer, 100 products, 200 batches) and measures one full bill-save:
//! 1 bill row + 5 bill_lines + 1 payment.
//!
//! NOTE: this file is a scaffold (ADR 0067). It must compile under
//! `cargo check --benches`; running it for real numbers happens at S25
//! on the reference rig at Jagannath Pharmacy (Kalyan pilot shop).

use criterion::{criterion_group, criterion_main, BatchSize, Criterion};
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

/// Seed the schema with the volumes a typical pilot shop carries on day-1:
/// 1 shop, 1 owner-user, 1 supplier, 1 customer, 100 OTC products, and
/// 200 batches (two batches per product, FEFO-ordered with future expiry).
///
/// All NOT NULL columns are populated against the schema in 0001_init.sql:
/// products require gst_rate / hsn / schedule / pack_form / pack_size /
/// mrp_paise; batches require mfg_date / expiry_date / qty_on_hand /
/// purchase_price_paise / mrp_paise / supplier_id (and shop_id from 0044).
fn setup_seeded_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&conn);

    // --- shop / user / supplier / customer ---
    conn.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) \
            VALUES ('shop_main', 'Jagannath Pharmacy', '27ABCDE1234F1Z5', '27', 'RL-1', 'Kalyan');
         INSERT INTO users (id, shop_id, name, role, pin_hash) \
            VALUES ('u_owner', 'shop_main', 'Owner', 'owner', 'hash');
         INSERT INTO suppliers (id, shop_id, name) \
            VALUES ('sup_1', 'shop_main', 'TestDist');
         INSERT INTO customers (id, shop_id, name, phone) \
            VALUES ('cust_1', 'shop_main', 'Walk-in', '9999999999');",
    )
    .unwrap();

    // --- 100 products + 200 batches ---
    let tx = conn.unchecked_transaction().unwrap();
    for i in 0..100 {
        let pid = format!("p_{i:03}");
        tx.execute(
            "INSERT INTO products \
              (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise) \
             VALUES (?, ?, 'GenericMfr', '30049011', 12, 'OTC', 'tab', 10, ?)",
            params![pid, format!("Product {i}"), 10_000i64 + (i as i64) * 100],
        )
        .unwrap();
        // two batches per product (FEFO-ordered: 2027 then 2028 expiry)
        for k in 0..2 {
            let bid = format!("b_{i:03}_{k}");
            let expiry = if k == 0 { "2027-12-31" } else { "2028-12-31" };
            tx.execute(
                "INSERT INTO batches \
                  (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, \
                   purchase_price_paise, mrp_paise, supplier_id) \
                 VALUES (?, ?, ?, '2026-01-01', ?, 100, 8000, 10000, 'sup_1')",
                params![bid, pid, format!("BN-{i:03}-{k}"), expiry],
            )
            .unwrap();
        }
    }
    tx.commit().unwrap();
    conn
}

fn bench_bill_save(c: &mut Criterion) {
    c.bench_function("bill_save_5_lines_1_payment", |b| {
        b.iter_batched(
            setup_seeded_db,
            |conn| {
                // Stub bill-save path. Each iteration uses a fresh in-memory
                // DB, so we can hardcode the IDs and not worry about UNIQUE
                // collisions. Real bill-save pipeline is in src/main.rs's
                // `save_bill` command (out of this lane); when the perf
                // run is wired up at S25 we'll call into the same code path.
                conn.execute(
                    "INSERT INTO bills \
                      (id, shop_id, bill_no, cashier_id, gst_treatment, \
                       subtotal_paise, grand_total_paise, payment_mode) \
                     VALUES ('bill_1', 'shop_main', 'INV-1', 'u_owner', 'intra_state', \
                             50000, 50000, 'cash')",
                    [],
                )
                .unwrap();
                // Five bill_lines (FEFO uses the 2027-expiry batch first).
                for line_ix in 0..5 {
                    let lid = format!("bl_{line_ix}");
                    let pid = format!("p_{line_ix:03}");
                    let bid = format!("b_{line_ix:03}_0");
                    conn.execute(
                        "INSERT INTO bill_lines \
                          (id, bill_id, product_id, batch_id, qty, mrp_paise, \
                           taxable_value_paise, gst_rate, line_total_paise) \
                         VALUES (?, 'bill_1', ?, ?, 1.0, 10000, 10000, 12, 10000)",
                        params![lid, pid, bid],
                    )
                    .unwrap();
                }
                // One payment row.
                conn.execute(
                    "INSERT INTO payments (id, bill_id, mode, amount_paise) \
                     VALUES ('pay_1', 'bill_1', 'cash', 50000)",
                    [],
                )
                .unwrap();
            },
            BatchSize::SmallInput,
        );
    });
}

criterion_group!(benches, bench_bill_save);
criterion_main!(benches);
