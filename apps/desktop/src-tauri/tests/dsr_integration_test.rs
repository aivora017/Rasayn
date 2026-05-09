//! Integration tests for `dsr_export` — DPDP §11 personal data export bundle.
//!
//! Uses the same mirror pattern as `counseling_integration_test.rs`: the
//! production module lives behind a #[tauri::command] that needs a
//! tauri::State, and the desktop crate is binary-only (no lib.rs), so we
//! mirror the data-collection + bundle-write logic against a real
//! sqlite-in-memory + tempdir on-disk run. Drift between this mirror and
//! `src/dsr_export.rs` would surface as a contract bug; production code
//! also has its own logic exercised by the Tauri command surface.
//!
//! Branches under test:
//!   1. Migration 0053 creates the `dsr_audit_log` table.
//!   2. CHECK constraint rejects bogus `kind`.
//!   3. Bundle writes 3 files (JSON + CSV + README) on disk.
//!   4. JSON file is well-formed + carries the synthetic customer/bills.
//!   5. Audit log accumulates rows for in-progress + done.
//!   6. Two requests against the same customer get unique request_ids.
//!   7. Unknown customer still produces a (empty) bundle without panic.

use rusqlite::{params, Connection};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

// -- migration loader ------------------------------------------------------

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

// -- seed data -------------------------------------------------------------

fn seed_minimal(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) \
           VALUES ('shop_local', 'Vaidyanath', '27AAAAA0000A1Z5', '27', 'MH-1', 'Kalyan');\
         INSERT INTO users (id, shop_id, name, role, pin_hash) \
           VALUES ('u1', 'shop_local', 'Owner', 'owner', 'h');\
         INSERT INTO suppliers (id, shop_id, name) \
           VALUES ('sup1', 'shop_local', 'Acme Distributors');\
         INSERT INTO customers (id, shop_id, name, phone, gender, consent_abdm, consent_marketing, created_at) \
           VALUES ('c_export', 'shop_local', 'Anita', '+919812345678', 'F', 0, 1, '2026-01-01');\
         INSERT INTO products (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise, image_sha256) \
           VALUES ('p1', 'Paracetamol 500mg', 'PharmaCo', '3004', 12, 'OTC', 'tablet', 10, 5000, 'img');\
         INSERT INTO batches (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, purchase_price_paise, mrp_paise, supplier_id) \
           VALUES ('b1', 'p1', 'B1', '2025-01-01', '2099-12-31', 100, 4000, 5000, 'sup1');\
         INSERT INTO bills (id, shop_id, bill_no, billed_at, customer_id, cashier_id, gst_treatment, \
                            subtotal_paise, grand_total_paise, payment_mode) \
           VALUES ('bill1', 'shop_local', 'INV-1', '2026-04-01T10:00:00Z', 'c_export', 'u1', \
                   'intra_state', 5000, 5600, 'cash');\
         INSERT INTO dpdp_consents (customer_id, purpose, granted, granted_at, evidence) \
           VALUES ('c_export', 'marketing', 1, '2026-01-01T10:00:00Z', 'click+sms-otp');"
    ).unwrap();
}

// -- mirror helpers (byte-equivalent to src/dsr_export.rs) -----------------

fn now_iso() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

fn today_yyyy_mm_dd() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

fn gen_request_id() -> String {
    let ts = chrono::Utc::now().format("%Y%m%d%H%M%S%3f");
    let suffix: String = (0..6)
        .map(|_| {
            let r: u8 = rand::random::<u8>() % 36;
            if r < 10 {
                (b'0' + r) as char
            } else {
                (b'a' + (r - 10)) as char
            }
        })
        .collect();
    format!("dsr_{ts}_{suffix}")
}

fn safe_segment(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn dsr_root_dir(backup_dir: &Path) -> PathBuf {
    backup_dir.join("dsr_exports")
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomerRow {
    id: String,
    shop_id: String,
    name: String,
    phone: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BillRow {
    id: String,
    bill_no: String,
    billed_at: String,
    grand_total_paise: i64,
    payment_mode: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsentRow {
    purpose: String,
    granted: i64,
    evidence: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Bundle {
    schema_version: u32,
    request_id: String,
    customer: Option<CustomerRow>,
    bills: Vec<BillRow>,
    dpdp_consents: Vec<ConsentRow>,
}

fn mirror_export(
    c: &Connection,
    backup_dir: &Path,
    customer_id: &str,
    requester_phone: &str,
    reason: &str,
) -> (String, Vec<String>) {
    let request_id = gen_request_id();

    // in-progress audit row
    c.execute(
        "INSERT INTO dsr_audit_log (request_id, customer_id, requester_phone, reason, kind, status) \
         VALUES (?1, ?2, ?3, ?4, 'access', 'in-progress')",
        params![request_id, customer_id, requester_phone, reason],
    )
    .unwrap();

    let cust: Option<CustomerRow> = c
        .query_row(
            "SELECT id, shop_id, name, phone FROM customers WHERE id = ?1",
            params![customer_id],
            |r| {
                Ok(CustomerRow {
                    id: r.get(0)?,
                    shop_id: r.get(1)?,
                    name: r.get(2)?,
                    phone: r.get(3)?,
                })
            },
        )
        .ok();
    let bills: Vec<BillRow> = {
        let mut stmt = c
            .prepare(
                "SELECT id, bill_no, billed_at, grand_total_paise, payment_mode \
                 FROM bills WHERE customer_id = ?1 ORDER BY billed_at DESC",
            )
            .unwrap();
        stmt.query_map(params![customer_id], |r| {
            Ok(BillRow {
                id: r.get(0)?,
                bill_no: r.get(1)?,
                billed_at: r.get(2)?,
                grand_total_paise: r.get(3)?,
                payment_mode: r.get(4)?,
            })
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
    };
    let consents: Vec<ConsentRow> = {
        let mut stmt = c
            .prepare(
                "SELECT purpose, granted, evidence \
                 FROM dpdp_consents WHERE customer_id = ?1 ORDER BY purpose",
            )
            .unwrap();
        stmt.query_map(params![customer_id], |r| {
            Ok(ConsentRow {
                purpose: r.get(0)?,
                granted: r.get(1)?,
                evidence: r.get(2)?,
            })
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
    };

    let bundle = Bundle {
        schema_version: 1,
        request_id: request_id.clone(),
        customer: cust,
        bills,
        dpdp_consents: consents,
    };

    let day = today_yyyy_mm_dd();
    let folder = format!("{}_{}", day, safe_segment(&request_id));
    let dir = dsr_root_dir(backup_dir).join(&folder);
    fs::create_dir_all(&dir).unwrap();

    let json_path = dir.join(format!("customer_{}.json", safe_segment(customer_id)));
    let mut jf = fs::File::create(&json_path).unwrap();
    jf.write_all(serde_json::to_string_pretty(&bundle).unwrap().as_bytes())
        .unwrap();

    let csv_path = dir.join(format!("customer_{}.csv", safe_segment(customer_id)));
    let mut cf = fs::File::create(&csv_path).unwrap();
    writeln!(cf, "section,key,value").unwrap();
    if let Some(ref cust) = bundle.customer {
        writeln!(cf, "customer,name,{}", cust.name).unwrap();
    }
    for b in &bundle.bills {
        writeln!(cf, "bill,{},{}", b.bill_no, b.grand_total_paise).unwrap();
    }
    for c in &bundle.dpdp_consents {
        writeln!(cf, "consent,{},{}", c.purpose, c.granted).unwrap();
    }

    let readme_path = dir.join("README.txt");
    fs::write(&readme_path, "DPDP §11 Personal Data Export\n").unwrap();

    let files = vec![
        json_path.to_string_lossy().to_string(),
        csv_path.to_string_lossy().to_string(),
        readme_path.to_string_lossy().to_string(),
    ];

    // done audit row
    let now = now_iso();
    c.execute(
        "INSERT INTO dsr_audit_log (request_id, customer_id, requester_phone, reason, kind, status, files_path, fulfilled_at) \
         VALUES (?1, ?2, ?3, ?4, 'access', 'done', ?5, ?6)",
        params![
            request_id,
            customer_id,
            requester_phone,
            reason,
            dir.to_string_lossy().to_string(),
            now
        ],
    )
    .unwrap();

    (request_id, files)
}

// -- tests -----------------------------------------------------------------

#[test]
fn migration_creates_dsr_audit_log_table() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='dsr_audit_log'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1);
}

#[test]
fn dsr_audit_kind_check_blocks_bogus() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    let r = c.execute(
        "INSERT INTO dsr_audit_log (request_id, customer_id, kind, status) \
         VALUES ('r1', 'c1', 'bogus', 'done')",
        [],
    );
    assert!(r.is_err(), "kind CHECK must reject unknown values");
}

#[test]
fn dsr_audit_status_check_blocks_bogus() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    let r = c.execute(
        "INSERT INTO dsr_audit_log (request_id, customer_id, kind, status) \
         VALUES ('r1', 'c1', 'access', 'mystery')",
        [],
    );
    assert!(r.is_err(), "status CHECK must reject unknown values");
}

#[test]
fn export_writes_three_files_and_audit_rows() {
    let tmp = tempfile::tempdir().unwrap();
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed_minimal(&c);

    let (request_id, files) = mirror_export(
        &c,
        tmp.path(),
        "c_export",
        "+919812345678",
        "Customer phoned shop on 2026-05-08 asking for her data.",
    );

    assert!(request_id.starts_with("dsr_"));
    assert_eq!(files.len(), 3);
    let names: Vec<String> = files
        .iter()
        .map(|p| {
            Path::new(p)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string()
        })
        .collect();
    assert!(names.iter().any(|n| n.ends_with(".json")));
    assert!(names.iter().any(|n| n.ends_with(".csv")));
    assert!(names.iter().any(|n| n == "README.txt"));

    for path in &files {
        let meta = std::fs::metadata(path).expect("bundle file must exist");
        assert!(meta.len() > 0, "{path} must not be empty");
    }

    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM dsr_audit_log WHERE request_id = ?1",
            [&request_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 2, "expected 2 audit rows (in-progress + done)");
}

#[test]
fn json_bundle_contains_customer_and_bills() {
    let tmp = tempfile::tempdir().unwrap();
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed_minimal(&c);

    let (_id, files) = mirror_export(&c, tmp.path(), "c_export", "+919812345678", "access");
    let json_path = files.iter().find(|p| p.ends_with(".json")).unwrap();
    let body = std::fs::read_to_string(json_path).unwrap();
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();

    assert_eq!(v["schemaVersion"], 1);
    assert_eq!(v["customer"]["id"], "c_export");
    assert_eq!(v["customer"]["name"], "Anita");
    assert_eq!(v["bills"][0]["billNo"], "INV-1");
    assert_eq!(v["dpdpConsents"][0]["purpose"], "marketing");
}

#[test]
fn export_request_ids_are_unique_across_calls() {
    let tmp = tempfile::tempdir().unwrap();
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed_minimal(&c);

    let (r1, _) = mirror_export(&c, tmp.path(), "c_export", "+919812345678", "first");
    // sleep a tick to make sure the timestamp portion differs
    std::thread::sleep(std::time::Duration::from_millis(2));
    let (r2, _) = mirror_export(&c, tmp.path(), "c_export", "+919812345678", "second");
    assert_ne!(r1, r2);
}

#[test]
fn export_unknown_customer_yields_empty_bundle() {
    let tmp = tempfile::tempdir().unwrap();
    let c = Connection::open_in_memory().unwrap();
    apply_migrations(&c);
    seed_minimal(&c);

    let (_id, files) = mirror_export(&c, tmp.path(), "c_unknown", "+910000000000", "ghost");
    let json_path = files.iter().find(|p| p.ends_with(".json")).unwrap();
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(json_path).unwrap()).unwrap();
    assert!(v["customer"].is_null());
    assert_eq!(v["bills"].as_array().unwrap().len(), 0);
}
