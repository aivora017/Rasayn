//! dsr_export.rs — DPDP §11 + §13(2) data principal export auto-respond.
//!
//! S28-C1 (ADR-0077). Pairs with migration `0053_dsr_audit.sql` and the
//! existing `dpdp_dsr_requests` queue (migration 0033, dpdp.rs).
//!
//! DPDP Act 2023 §11 grants the Data Principal (the customer) the right
//! to access a summary of their personal data being processed by the
//! Data Fiduciary (the pharmacy owner). §13(2) sets a 30-day SLA. This
//! module fulfils an "access" DSR by producing a deterministic snapshot
//! folder containing:
//!
//!   * `customer_<id>.json` — typed JSON of every row keyed to the
//!     customer (bills, bill_lines, returns, prescriptions, dpdp
//!     consents).
//!   * `customer_<id>.csv` — flat CSV the principal can open in Excel.
//!   * `README.txt` — human-readable explanation of the bundle's
//!     contents, the principal's rights under §11, the retention period,
//!     and the grievance officer contact.
//!
//! The bundle lives under `<backup_dir>/dsr_exports/<YYYY-MM-DD>_<request_id>/`.
//! The Tauri command returns the absolute paths so the front-end can
//! display them and open the folder in Explorer/Finder.
//!
//! Three Tauri commands:
//!
//!   * `request_personal_data_export(customer_id, requester_phone, reason)`
//!     - generates the bundle, writes to disk, appends a row to
//!       `dsr_audit_log`, and returns `{ request_id, files }`.
//!   * `dsr_get_export_status(request_id)`
//!     - looks up the latest row for `request_id` and returns the
//!       status (`done` / `in-progress` / `failed`).
//!   * `dsr_list_exports(limit)`
//!     - returns the most recent N audit rows for the owner UI.
//!
//! NOTE: handler registration is owned by main.rs. The three #[tauri::command]
//! functions exported here are added to the handler block by the lead at
//! integration time (see main.rs handler list).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::backup_scheduler;
use crate::db::DbState;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/// Result of a successful `request_personal_data_export` call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DsrExportResult {
    pub request_id: String,
    pub files: Vec<String>,
}

/// Status returned by `dsr_get_export_status`. Mirrors the audit row.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DsrStatus {
    pub request_id: String,
    pub status: String,
    pub files_path: Option<String>,
    pub fulfilled_at: Option<String>,
    pub created_at: String,
}

/// Audit row returned by `dsr_list_exports`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DsrExport {
    pub id: i64,
    pub request_id: String,
    pub customer_id: String,
    pub requester_phone: Option<String>,
    pub reason: Option<String>,
    pub kind: String,
    pub status: String,
    pub created_at: String,
    pub fulfilled_at: Option<String>,
    pub files_path: Option<String>,
}

// ---------------------------------------------------------------------------
// Internal record shapes — used to build the JSON bundle.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomerRow {
    id: String,
    shop_id: String,
    name: String,
    phone: Option<String>,
    dob: Option<String>,
    gender: Option<String>,
    gstin: Option<String>,
    address: Option<String>,
    consent_marketing: i64,
    consent_abdm: i64,
    consent_captured_at: Option<String>,
    consent_method: Option<String>,
    created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BillRow {
    id: String,
    bill_no: String,
    billed_at: String,
    grand_total_paise: i64,
    payment_mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrescriptionRow {
    id: String,
    kind: String,
    issued_date: String,
    notes: Option<String>,
    created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReturnRow {
    id: String,
    original_bill_id: String,
    return_no: String,
    reason: String,
    refund_total_paise: i64,
    created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsentRow {
    purpose: String,
    granted: i64,
    granted_at: Option<String>,
    withdrawn_at: Option<String>,
    evidence: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Bundle {
    schema_version: u32,
    generated_at: String,
    request_id: String,
    customer: Option<CustomerRow>,
    bills: Vec<BillRow>,
    prescriptions: Vec<PrescriptionRow>,
    returns: Vec<ReturnRow>,
    dpdp_consents: Vec<ConsentRow>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_iso() -> String {
    use chrono::Utc;
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn today_yyyy_mm_dd() -> String {
    use chrono::Utc;
    Utc::now().format("%Y-%m-%d").to_string()
}

fn gen_request_id() -> String {
    use chrono::Utc;
    let ts = Utc::now().format("%Y%m%d%H%M%S%3f");
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

/// Where DSR export bundles land. Resolves to:
///     `<PHARMACARE_BACKUP_DIR or platform default>/dsr_exports/`
fn dsr_root_dir() -> PathBuf {
    backup_scheduler::default_backup_dir().join("dsr_exports")
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

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        let escaped = s.replace('"', "\"\"");
        format!("\"{escaped}\"")
    } else {
        s.to_string()
    }
}

// ---------------------------------------------------------------------------
// Data collection — per-table reads keyed on customer_id.
// ---------------------------------------------------------------------------

fn read_customer(c: &Connection, customer_id: &str) -> Result<Option<CustomerRow>, String> {
    c.query_row(
        "SELECT id, shop_id, name, phone, dob, gender, gstin, address, \
                consent_marketing, consent_abdm, consent_captured_at, \
                consent_method, created_at \
         FROM customers WHERE id = ?1",
        params![customer_id],
        |r| {
            Ok(CustomerRow {
                id: r.get(0)?,
                shop_id: r.get(1)?,
                name: r.get(2)?,
                phone: r.get(3)?,
                dob: r.get(4)?,
                gender: r.get(5)?,
                gstin: r.get(6)?,
                address: r.get(7)?,
                consent_marketing: r.get(8)?,
                consent_abdm: r.get(9)?,
                consent_captured_at: r.get(10)?,
                consent_method: r.get(11)?,
                created_at: r.get(12)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("read customer: {e}"))
}

fn read_bills(c: &Connection, customer_id: &str) -> Result<Vec<BillRow>, String> {
    let mut stmt = c
        .prepare(
            "SELECT id, bill_no, billed_at, grand_total_paise, payment_mode \
             FROM bills WHERE customer_id = ?1 ORDER BY billed_at DESC",
        )
        .map_err(|e| format!("prepare bills: {e}"))?;
    let rows = stmt
        .query_map(params![customer_id], |r| {
            Ok(BillRow {
                id: r.get(0)?,
                bill_no: r.get(1)?,
                billed_at: r.get(2)?,
                grand_total_paise: r.get(3)?,
                payment_mode: r.get(4)?,
            })
        })
        .map_err(|e| format!("query bills: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect bills: {e}"))?;
    Ok(rows)
}

fn read_prescriptions(c: &Connection, customer_id: &str) -> Result<Vec<PrescriptionRow>, String> {
    let mut stmt = c
        .prepare(
            "SELECT id, kind, issued_date, notes, created_at \
             FROM prescriptions WHERE customer_id = ?1 ORDER BY issued_date DESC",
        )
        .map_err(|e| format!("prepare rx: {e}"))?;
    let rows = stmt
        .query_map(params![customer_id], |r| {
            Ok(PrescriptionRow {
                id: r.get(0)?,
                kind: r.get(1)?,
                issued_date: r.get(2)?,
                notes: r.get(3)?,
                created_at: r.get(4)?,
            })
        })
        .map_err(|e| format!("query rx: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect rx: {e}"))?;
    Ok(rows)
}

fn read_returns(c: &Connection, customer_id: &str) -> Result<Vec<ReturnRow>, String> {
    // returns join via the bill -> customer link.
    let mut stmt = c
        .prepare(
            "SELECT rh.id, rh.original_bill_id, rh.return_no, rh.reason, \
                    rh.refund_total_paise, rh.created_at \
             FROM return_headers rh \
             INNER JOIN bills b ON b.id = rh.original_bill_id \
             WHERE b.customer_id = ?1 \
             ORDER BY rh.created_at DESC",
        )
        .map_err(|e| format!("prepare returns: {e}"))?;
    let rows = stmt
        .query_map(params![customer_id], |r| {
            Ok(ReturnRow {
                id: r.get(0)?,
                original_bill_id: r.get(1)?,
                return_no: r.get(2)?,
                reason: r.get(3)?,
                refund_total_paise: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| format!("query returns: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect returns: {e}"))?;
    Ok(rows)
}

fn read_consents(c: &Connection, customer_id: &str) -> Result<Vec<ConsentRow>, String> {
    let mut stmt = c
        .prepare(
            "SELECT purpose, granted, granted_at, withdrawn_at, evidence \
             FROM dpdp_consents WHERE customer_id = ?1 ORDER BY purpose",
        )
        .map_err(|e| format!("prepare consents: {e}"))?;
    let rows = stmt
        .query_map(params![customer_id], |r| {
            Ok(ConsentRow {
                purpose: r.get(0)?,
                granted: r.get(1)?,
                granted_at: r.get(2)?,
                withdrawn_at: r.get(3)?,
                evidence: r.get(4)?,
            })
        })
        .map_err(|e| format!("query consents: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect consents: {e}"))?;
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Bundle builder — JSON + CSV + README, atomic-ish (each file write checked).
// ---------------------------------------------------------------------------

fn write_json(dir: &Path, customer_id: &str, bundle: &Bundle) -> Result<PathBuf, String> {
    let path = dir.join(format!("customer_{}.json", safe_segment(customer_id)));
    let json = serde_json::to_string_pretty(bundle).map_err(|e| format!("json: {e}"))?;
    let mut f = fs::File::create(&path).map_err(|e| format!("create json: {e}"))?;
    f.write_all(json.as_bytes())
        .map_err(|e| format!("write json: {e}"))?;
    f.flush().map_err(|e| format!("flush json: {e}"))?;
    Ok(path)
}

fn write_csv(dir: &Path, customer_id: &str, bundle: &Bundle) -> Result<PathBuf, String> {
    let path = dir.join(format!("customer_{}.csv", safe_segment(customer_id)));
    let mut f = fs::File::create(&path).map_err(|e| format!("create csv: {e}"))?;

    // Single flat CSV: section column distinguishes sources.
    writeln!(f, "section,key,value").map_err(|e| format!("csv hdr: {e}"))?;
    if let Some(ref cust) = bundle.customer {
        let pairs: [(&str, String); 12] = [
            ("id", cust.id.clone()),
            ("shop_id", cust.shop_id.clone()),
            ("name", cust.name.clone()),
            ("phone", cust.phone.clone().unwrap_or_default()),
            ("dob", cust.dob.clone().unwrap_or_default()),
            ("gender", cust.gender.clone().unwrap_or_default()),
            ("gstin", cust.gstin.clone().unwrap_or_default()),
            ("address", cust.address.clone().unwrap_or_default()),
            ("consent_marketing", cust.consent_marketing.to_string()),
            ("consent_abdm", cust.consent_abdm.to_string()),
            (
                "consent_captured_at",
                cust.consent_captured_at.clone().unwrap_or_default(),
            ),
            ("created_at", cust.created_at.clone()),
        ];
        for (k, v) in pairs.iter() {
            writeln!(f, "customer,{},{}", csv_escape(k), csv_escape(v))
                .map_err(|e| format!("csv cust: {e}"))?;
        }
    }
    for b in &bundle.bills {
        writeln!(
            f,
            "bill,{},{}",
            csv_escape(&b.bill_no),
            csv_escape(&format!(
                "billed_at={};total_paise={};mode={}",
                b.billed_at, b.grand_total_paise, b.payment_mode
            ))
        )
        .map_err(|e| format!("csv bill: {e}"))?;
    }
    for p in &bundle.prescriptions {
        writeln!(
            f,
            "prescription,{},{}",
            csv_escape(&p.id),
            csv_escape(&format!("kind={};issued={}", p.kind, p.issued_date))
        )
        .map_err(|e| format!("csv rx: {e}"))?;
    }
    for r in &bundle.returns {
        writeln!(
            f,
            "return,{},{}",
            csv_escape(&r.return_no),
            csv_escape(&format!(
                "bill={};refund_paise={}",
                r.original_bill_id, r.refund_total_paise
            ))
        )
        .map_err(|e| format!("csv ret: {e}"))?;
    }
    for c in &bundle.dpdp_consents {
        writeln!(
            f,
            "consent,{},{}",
            csv_escape(&c.purpose),
            csv_escape(&format!("granted={};evidence={}", c.granted, c.evidence))
        )
        .map_err(|e| format!("csv cons: {e}"))?;
    }
    f.flush().map_err(|e| format!("flush csv: {e}"))?;
    Ok(path)
}

fn write_readme(dir: &Path, request_id: &str, customer_id: &str) -> Result<PathBuf, String> {
    let path = dir.join("README.txt");
    let body = format!(
        "DPDP Act 2023 — Personal Data Export\n\
         =====================================\n\
         \n\
         Request ID: {request_id}\n\
         Customer ID: {customer_id}\n\
         Generated:  {now}\n\
         \n\
         WHAT THIS BUNDLE CONTAINS\n\
         -------------------------\n\
         This folder contains every row of personal data this pharmacy holds\n\
         about you, exported under §11 of the Digital Personal Data Protection\n\
         Act, 2023. The two data files are equivalent; pick whichever you can\n\
         open:\n\
         \n\
           * customer_<id>.json  — machine-readable, full schema.\n\
           * customer_<id>.csv   — opens in Excel, Google Sheets, or Notepad.\n\
         \n\
         The data covers:\n\
         \n\
           * your customer record (name, phone, address, GSTIN if shared);\n\
           * every bill billed to you, with totals and payment mode;\n\
           * every prescription captured for you (paper, digital, or ABDM);\n\
           * every refund or return processed against your bills;\n\
           * every DPDP consent you granted or withdrew, with evidence.\n\
         \n\
         YOUR RIGHTS UNDER §11–§14\n\
         -------------------------\n\
         You may at any time:\n\
         \n\
           * ask for corrections to incorrect data (§12);\n\
           * ask for erasure of data no longer required (§12);\n\
           * nominate a representative to exercise these rights (§14);\n\
           * file a grievance with the Data Protection Officer below (§13).\n\
         \n\
         The pharmacy must respond within thirty (30) days. Some data must\n\
         be retained for tax (Income-tax Act, 6 years) and pharmacy\n\
         (Drugs & Cosmetics Rules r.65, 2 years for Schedule H/H1/X register)\n\
         compliance and cannot be erased before that retention window.\n\
         \n\
         GRIEVANCE OFFICER\n\
         -----------------\n\
         The pharmacy's Data Protection Officer (DPO) and grievance officer\n\
         contact details are printed on every receipt and on the shop notice\n\
         board, as required by §10. If you cannot find them, ask the cashier\n\
         to show you the DPO contact card.\n\
         \n\
         If the pharmacy fails to respond within 30 days, you may escalate\n\
         to the Data Protection Board of India.\n\
         \n\
         ----------------------------------------------------------\n\
         Generated by PharmaCare Pro (S28-C1, ADR-0077, DPDP §11+§13).\n",
        request_id = request_id,
        customer_id = customer_id,
        now = now_iso()
    );
    let mut f = fs::File::create(&path).map_err(|e| format!("create readme: {e}"))?;
    f.write_all(body.as_bytes())
        .map_err(|e| format!("write readme: {e}"))?;
    f.flush().map_err(|e| format!("flush readme: {e}"))?;
    Ok(path)
}

/// Build the bundle files on disk for a customer + request.
/// Returns the list of absolute paths written.
fn build_bundle(
    c: &Connection,
    customer_id: &str,
    request_id: &str,
) -> Result<(PathBuf, Vec<String>), String> {
    let day = today_yyyy_mm_dd();
    let folder_name = format!("{}_{}", day, safe_segment(request_id));
    let dir = dsr_root_dir().join(&folder_name);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir bundle: {e}"))?;

    let bundle = Bundle {
        schema_version: 1,
        generated_at: now_iso(),
        request_id: request_id.to_string(),
        customer: read_customer(c, customer_id)?,
        bills: read_bills(c, customer_id)?,
        prescriptions: read_prescriptions(c, customer_id)?,
        returns: read_returns(c, customer_id)?,
        dpdp_consents: read_consents(c, customer_id)?,
    };

    let json_p = write_json(&dir, customer_id, &bundle)?;
    let csv_p = write_csv(&dir, customer_id, &bundle)?;
    let readme_p = write_readme(&dir, request_id, customer_id)?;

    let files = vec![
        json_p.to_string_lossy().to_string(),
        csv_p.to_string_lossy().to_string(),
        readme_p.to_string_lossy().to_string(),
    ];
    Ok((dir, files))
}

// ---------------------------------------------------------------------------
// Audit-log persistence.
// ---------------------------------------------------------------------------

fn audit_insert(
    c: &Connection,
    request_id: &str,
    customer_id: &str,
    requester_phone: Option<&str>,
    reason: Option<&str>,
    kind: &str,
    status: &str,
    files_path: Option<&str>,
    fulfilled_at: Option<&str>,
) -> Result<i64, String> {
    c.execute(
        "INSERT INTO dsr_audit_log \
            (request_id, customer_id, requester_phone, reason, kind, status, files_path, fulfilled_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            request_id,
            customer_id,
            requester_phone,
            reason,
            kind,
            status,
            files_path,
            fulfilled_at
        ],
    )
    .map_err(|e| format!("audit insert: {e}"))?;
    Ok(c.last_insert_rowid())
}

// ---------------------------------------------------------------------------
// Pure helpers exposed for integration tests (no Tauri State coupling).
// ---------------------------------------------------------------------------

/// Test-friendly entrypoint: takes a Connection directly. Returns
/// `(request_id, files)`. Also writes one row to `dsr_audit_log` with
/// status='done' on success.
pub fn run_personal_data_export(
    c: &Connection,
    customer_id: &str,
    requester_phone: &str,
    reason: &str,
) -> Result<DsrExportResult, String> {
    let request_id = gen_request_id();
    let _ = audit_insert(
        c,
        &request_id,
        customer_id,
        Some(requester_phone),
        Some(reason),
        "access",
        "in-progress",
        None,
        None,
    )?;
    match build_bundle(c, customer_id, &request_id) {
        Ok((dir, files)) => {
            let now = now_iso();
            let _ = audit_insert(
                c,
                &request_id,
                customer_id,
                Some(requester_phone),
                Some(reason),
                "access",
                "done",
                Some(&dir.to_string_lossy()),
                Some(&now),
            )?;
            Ok(DsrExportResult { request_id, files })
        }
        Err(e) => {
            let _ = audit_insert(
                c,
                &request_id,
                customer_id,
                Some(requester_phone),
                Some(reason),
                "access",
                "failed",
                None,
                None,
            );
            Err(e)
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn request_personal_data_export(
    state: State<'_, DbState>,
    customer_id: String,
    requester_phone: String,
    reason: String,
) -> Result<DsrExportResult, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    run_personal_data_export(&c, &customer_id, &requester_phone, &reason)
}

#[tauri::command]
pub fn dsr_get_export_status(
    state: State<'_, DbState>,
    request_id: String,
) -> Result<Option<DsrStatus>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.query_row(
        "SELECT request_id, status, files_path, fulfilled_at, created_at \
         FROM dsr_audit_log \
         WHERE request_id = ?1 \
         ORDER BY created_at DESC, id DESC LIMIT 1",
        params![request_id],
        |r| {
            Ok(DsrStatus {
                request_id: r.get(0)?,
                status: r.get(1)?,
                files_path: r.get(2)?,
                fulfilled_at: r.get(3)?,
                created_at: r.get(4)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("status lookup: {e}"))
}

#[tauri::command]
pub fn dsr_list_exports(state: State<'_, DbState>, limit: i64) -> Result<Vec<DsrExport>, String> {
    let lim = limit.clamp(1, 500);
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c
        .prepare(
            "SELECT id, request_id, customer_id, requester_phone, reason, kind, \
                    status, created_at, fulfilled_at, files_path \
             FROM dsr_audit_log \
             ORDER BY created_at DESC, id DESC LIMIT ?1",
        )
        .map_err(|e| format!("prepare list: {e}"))?;
    let rows = stmt
        .query_map(params![lim], |r| {
            Ok(DsrExport {
                id: r.get(0)?,
                request_id: r.get(1)?,
                customer_id: r.get(2)?,
                requester_phone: r.get(3)?,
                reason: r.get(4)?,
                kind: r.get(5)?,
                status: r.get(6)?,
                created_at: r.get(7)?,
                fulfilled_at: r.get(8)?,
                files_path: r.get(9)?,
            })
        })
        .map_err(|e| format!("query list: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect list: {e}"))?;
    Ok(rows)
}
