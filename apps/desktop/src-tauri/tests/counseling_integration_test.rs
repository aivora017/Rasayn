//! S28-A1 -- counsel_log table + save_bill counseling gate mirror
//! (ADR-0073). Schedule-H / H1 / X mandate.
//!
//! Same pattern as save_bill_consent_gate_test.rs: save_bill is a
//! #[tauri::command] that needs a tauri::State, so we mirror the gate's
//! branches against a real DB. The mirror functions in this file are
//! byte-for-byte equivalent to the production helpers in
//! src/counseling.rs (drift would surface as a contract bug; the
//! production module also has unit tests of its own once cargo
//! supports them in this workspace).
//!
//! Branches under test:
//!   1. Empty bill / no H/H1/X products in basket -> gate clears.
//!   2. Basket with H/H1/X products but no counsel_log rows -> gate
//!      returns a non-empty Vec<MissingCounsel>; mirror save_bill aborts.
//!   3. After log_counseling for every missing drug, gate clears.
//!   4. log_counseling rejects patient_consented = false (server-side).
//!   5. log_counseling rejects schedule_class outside H/H1/X.
//!   6. list_counseling_for_bill returns the rows in id-ASC order.
//!   7. counsel_log row ON DELETE CASCADE when its bills row is purged.

use rusqlite::{params, params_from_iter, Connection};

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
           VALUES ('s1', 'Vaidyanath Pilot', '27ABCDE1234F1Z5', '27', 'RL-1', 'Kalyan');\
         INSERT INTO users (id, shop_id, name, role, pin_hash) \
           VALUES ('u_rph', 's1', 'RPh Sourav', 'pharmacist', 'h');\
         INSERT INTO products (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise, image_sha256) \
           VALUES ('p_h', 'Atorvastatin 10mg', 'PharmaCo', '3004', 12, 'H', 'tablet', 10, 4000, 'sha-img');\
         INSERT INTO products (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise, image_sha256) \
           VALUES ('p_h1', 'Tramadol 50mg', 'PharmaCo', '3004', 12, 'H1', 'capsule', 10, 6000, 'sha-img2');\
         INSERT INTO products (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise) \
           VALUES ('p_otc', 'Multivitamin', 'OtcCo', '3004', 12, 'OTC', 'tablet', 30, 8000);\
         INSERT INTO suppliers (id, shop_id, name, gstin) \
           VALUES ('sup', 's1', 'Sup', '27SUP1234F1Z5');\
         INSERT INTO batches (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, purchase_price_paise, mrp_paise, supplier_id) \
           VALUES ('b_h', 'p_h', 'BH001', '2026-01-01', '2027-12-31', 100, 3500, 4000, 'sup');\
         INSERT INTO batches (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, purchase_price_paise, mrp_paise, supplier_id) \
           VALUES ('b_h1', 'p_h1', 'BH101', '2026-01-01', '2027-12-31', 100, 5500, 6000, 'sup');\
         INSERT INTO batches (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, purchase_price_paise, mrp_paise, supplier_id) \
           VALUES ('b_otc', 'p_otc', 'B100', '2026-01-01', '2027-12-31', 200, 6000, 8000, 'sup');",
    )
    .unwrap();
}

fn seed_bill(c: &Connection, bill_id: &str) {
    c.execute(
        "INSERT INTO bills (id, shop_id, bill_no, cashier_id, gst_treatment, \
              subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, \
              grand_total_paise, payment_mode) \
         VALUES (?1, 's1', 'B-1', 'u_rph', 'intra_state', \
              1000, 60, 60, 0, 1100, 'cash')",
        params![bill_id],
    )
    .unwrap();
}

#[derive(Debug, PartialEq, Eq)]
struct MissingCounsel {
    drug_id: String,
    drug_name: String,
    schedule_class: String,
}

/// Mirror of counseling::log_counseling_inner.
#[allow(clippy::too_many_arguments)]
fn log_counseling(
    c: &Connection,
    bill_id: &str,
    drug_id: &str,
    drug_name: &str,
    schedule_class: &str,
    notes: Option<&str>,
    patient_consented: bool,
    counselor_user_id: Option<&str>,
) -> Result<i64, String> {
    if !matches!(schedule_class, "H" | "H1" | "X") {
        return Err(format!("INVALID_SCHEDULE_CLASS:{schedule_class}"));
    }
    if !patient_consented {
        return Err("PATIENT_CONSENT_REQUIRED".into());
    }
    if drug_name.trim().is_empty() {
        return Err("DRUG_NAME_REQUIRED".into());
    }
    c.execute(
        "INSERT INTO counsel_log
           (bill_id, drug_id, drug_name, schedule_class, notes,
            patient_consented, counselor_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            bill_id,
            drug_id,
            drug_name,
            schedule_class,
            notes,
            if patient_consented { 1 } else { 0 },
            counselor_user_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(c.last_insert_rowid())
}

/// Mirror of counseling::check_counseling_complete_for_basket.
fn check_counseling_for_basket(
    c: &Connection,
    bill_id: &str,
    product_ids: &[String],
) -> Vec<MissingCounsel> {
    if product_ids.is_empty() {
        return vec![];
    }
    let placeholders: Vec<String> = (2..=(product_ids.len() + 1))
        .map(|i| format!("?{i}"))
        .collect();
    let in_clause = placeholders.join(",");
    let sql = format!(
        "SELECT p.id, p.name, p.schedule
           FROM products p
          WHERE p.id IN ({in_clause})
            AND p.schedule IN ('H','H1','X')
            AND NOT EXISTS (
                  SELECT 1 FROM counsel_log cl
                   WHERE cl.bill_id = ?1
                     AND cl.drug_id = p.id
              )
          GROUP BY p.id
          ORDER BY p.name ASC"
    );
    let mut stmt = c.prepare(&sql).unwrap();
    let mut bound: Vec<&dyn rusqlite::ToSql> = vec![&bill_id];
    for pid in product_ids {
        bound.push(pid);
    }
    let rows = stmt
        .query_map(params_from_iter(bound.iter()), |r| {
            Ok(MissingCounsel {
                drug_id: r.get(0)?,
                drug_name: r.get(1)?,
                schedule_class: r.get(2)?,
            })
        })
        .unwrap();
    rows.collect::<Result<Vec<_>, _>>().unwrap()
}

/// Mirror of counseling::list_counseling_for_bill_inner -> only the
/// fields relevant to the assertions.
fn list_for_bill_minimal(c: &Connection, bill_id: &str) -> Vec<(i64, String, String)> {
    let mut stmt = c
        .prepare(
            "SELECT id, drug_id, schedule_class FROM counsel_log
              WHERE bill_id = ?1 ORDER BY id ASC",
        )
        .unwrap();
    let rows = stmt
        .query_map(params![bill_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .unwrap();
    rows.collect::<Result<Vec<_>, _>>().unwrap()
}

#[test]
fn migration_0050_creates_counsel_log() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='counsel_log'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1);
}

#[test]
fn empty_basket_clears_gate() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    seed_bill(&c, "bill_empty");
    let missing = check_counseling_for_basket(&c, "bill_empty", &[]);
    assert!(missing.is_empty());
}

#[test]
fn otc_only_basket_clears_gate() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    seed_bill(&c, "bill_otc");
    let missing = check_counseling_for_basket(&c, "bill_otc", &["p_otc".to_string()]);
    assert!(missing.is_empty());
}

#[test]
fn h_basket_with_no_counsel_log_blocks_gate() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    seed_bill(&c, "bill_h");
    let missing =
        check_counseling_for_basket(&c, "bill_h", &["p_h".to_string(), "p_otc".to_string()]);
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0].drug_id, "p_h");
    assert_eq!(missing[0].schedule_class, "H");
}

#[test]
fn h_and_h1_basket_returns_both_missing() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    seed_bill(&c, "bill_h_h1");
    let missing =
        check_counseling_for_basket(&c, "bill_h_h1", &["p_h".to_string(), "p_h1".to_string()]);
    assert_eq!(missing.len(), 2);
    let drug_ids: Vec<&str> = missing.iter().map(|m| m.drug_id.as_str()).collect();
    assert!(drug_ids.contains(&"p_h"));
    assert!(drug_ids.contains(&"p_h1"));
}

#[test]
fn logging_counseling_clears_gate() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    seed_bill(&c, "bill_clear");
    let pids = vec!["p_h".to_string(), "p_h1".to_string()];
    let m1 = check_counseling_for_basket(&c, "bill_clear", &pids);
    assert_eq!(m1.len(), 2);

    log_counseling(
        &c,
        "bill_clear",
        "p_h",
        "Atorvastatin 10mg",
        "H",
        Some("Take at night with food"),
        true,
        Some("u_rph"),
    )
    .unwrap();
    let m2 = check_counseling_for_basket(&c, "bill_clear", &pids);
    assert_eq!(m2.len(), 1, "p_h should clear, p_h1 should remain");
    assert_eq!(m2[0].drug_id, "p_h1");

    log_counseling(
        &c,
        "bill_clear",
        "p_h1",
        "Tramadol 50mg",
        "H1",
        None,
        true,
        Some("u_rph"),
    )
    .unwrap();
    let m3 = check_counseling_for_basket(&c, "bill_clear", &pids);
    assert!(m3.is_empty(), "all H/H1 counseled, gate must clear");
}

#[test]
fn log_counseling_rejects_no_consent() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    seed_bill(&c, "bill_nc");
    let r = log_counseling(
        &c,
        "bill_nc",
        "p_h",
        "Atorvastatin 10mg",
        "H",
        None,
        false,
        None,
    );
    assert_eq!(r, Err("PATIENT_CONSENT_REQUIRED".into()));
}

#[test]
fn log_counseling_rejects_invalid_schedule() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    seed_bill(&c, "bill_isch");
    let r = log_counseling(
        &c,
        "bill_isch",
        "p_otc",
        "Multivitamin",
        "OTC",
        None,
        true,
        None,
    );
    assert!(r.is_err());
    assert!(r.unwrap_err().starts_with("INVALID_SCHEDULE_CLASS:"));
}

#[test]
fn list_for_bill_returns_in_id_asc_order() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    seed_bill(&c, "bill_l");
    let id_h = log_counseling(
        &c,
        "bill_l",
        "p_h",
        "Atorvastatin 10mg",
        "H",
        None,
        true,
        None,
    )
    .unwrap();
    let id_h1 = log_counseling(
        &c,
        "bill_l",
        "p_h1",
        "Tramadol 50mg",
        "H1",
        None,
        true,
        None,
    )
    .unwrap();
    assert!(id_h < id_h1);
    let rows = list_for_bill_minimal(&c, "bill_l");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].0, id_h);
    assert_eq!(rows[1].0, id_h1);
    assert_eq!(rows[0].1, "p_h");
    assert_eq!(rows[1].2, "H1");
}

#[test]
fn cascade_delete_with_bill() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed(&c);
    seed_bill(&c, "bill_cas");
    log_counseling(
        &c,
        "bill_cas",
        "p_h",
        "Atorvastatin 10mg",
        "H",
        None,
        true,
        None,
    )
    .unwrap();
    // Default rusqlite connections do not enable foreign_keys; turn it
    // on to assert cascade behaviour matches what the desktop binary
    // sees (db.rs sets PRAGMA foreign_keys=ON on init).
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    c.execute("DELETE FROM bills WHERE id = ?1", params!["bill_cas"])
        .unwrap();
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM counsel_log WHERE bill_id = ?1",
            params!["bill_cas"],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 0, "ON DELETE CASCADE should drop counsel_log rows");
}
