// counseling.rs — Schedule-H mandatory counsel-log (S28-A1, ADR-0073).
//
// Drugs & Cosmetics Act 1940 s.22/s.27 + Rules 1945 r.65 oblige the
// pharmacist (RPh) to counsel the patient at the point of dispense for
// every Schedule H, H1, and X line. This module owns three Tauri
// commands:
//
//   * `log_counseling`              — append a per-line counsel row.
//   * `list_counseling_for_bill`    — read-back for the cashier UI.
//   * `check_counseling_complete`   — read-gate consulted by save_bill.
//
// `check_counseling_complete_inner` is also called by save_bill while it
// already holds the connection lock (see commands.rs save_bill section
// "S28-A1 Schedule-H counseling gate"). When the inner helper returns a
// non-empty Vec, save_bill must abort with `COUNSELING_INCOMPLETE` and
// the JSON-serialised list of missing drugs in the error string. The
// pre-existing DPDP §6 consent gate (S26.I) runs FIRST and is unchanged
// — its early return means the counseling gate never fires for a bill
// that would have failed DPDP anyway.
//
// Sister table `counseling_records` (migration 0035) stores the
// long-form AI-drafted counseling SCRIPT (multi-product roll-up).
// `counsel_log` (migration 0050) is per-line evidence and is the table
// save_bill consults.

use crate::db::DbState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

/// Per-line counseling record returned by `list_counseling_for_bill`.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CounselLogRow {
    pub id: i64,
    pub bill_id: String,
    pub drug_id: String,
    pub drug_name: String,
    pub schedule_class: String,
    pub counseled_at: String,
    pub counselor_user_id: Option<String>,
    pub notes: Option<String>,
    pub patient_consented: bool,
    pub created_at: String,
}

/// One drug in the bill that still has no `counsel_log` row.
/// `check_counseling_complete` returns a Vec of these; an empty Vec
/// means the bill is clear to save.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissingCounsel {
    pub drug_id: String,
    pub drug_name: String,
    pub schedule_class: String,
}

fn is_valid_schedule_class(s: &str) -> bool {
    matches!(s, "H" | "H1" | "X")
}

/// Append one counsel_log row. Returns the rowid of the inserted row.
/// `patient_consented` MUST be true — the cashier UI cannot save a row
/// where the patient refused; per ADR-0073 a refusal aborts the bill at
/// the cash counter (RPh must escalate to owner). We still validate
/// server-side so a script bypass cannot persist a forged "no" row.
#[tauri::command]
pub fn log_counseling(
    state: State<'_, DbState>,
    bill_id: String,
    drug_id: String,
    drug_name: String,
    schedule_class: String,
    notes: Option<String>,
    patient_consented: bool,
    counselor_user_id: Option<String>,
) -> Result<i64, String> {
    if !is_valid_schedule_class(&schedule_class) {
        return Err(format!("INVALID_SCHEDULE_CLASS:{schedule_class}"));
    }
    if !patient_consented {
        return Err("PATIENT_CONSENT_REQUIRED".to_string());
    }
    if drug_name.trim().is_empty() {
        return Err("DRUG_NAME_REQUIRED".to_string());
    }

    let c = state.0.lock().map_err(|e| e.to_string())?;
    log_counseling_inner(
        &c,
        &bill_id,
        &drug_id,
        &drug_name,
        &schedule_class,
        notes.as_deref(),
        patient_consented,
        counselor_user_id.as_deref(),
    )
}

/// Inner helper — used by both the Tauri command and by tests that
/// already hold a Connection. Must NOT take the DbState lock.
pub(crate) fn log_counseling_inner(
    conn: &Connection,
    bill_id: &str,
    drug_id: &str,
    drug_name: &str,
    schedule_class: &str,
    notes: Option<&str>,
    patient_consented: bool,
    counselor_user_id: Option<&str>,
) -> Result<i64, String> {
    conn.execute(
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
    Ok(conn.last_insert_rowid())
}

/// Return all counsel_log rows for a bill, oldest first.
#[tauri::command]
pub fn list_counseling_for_bill(
    state: State<'_, DbState>,
    bill_id: String,
) -> Result<Vec<CounselLogRow>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    list_counseling_for_bill_inner(&c, &bill_id)
}

pub(crate) fn list_counseling_for_bill_inner(
    conn: &Connection,
    bill_id: &str,
) -> Result<Vec<CounselLogRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, bill_id, drug_id, drug_name, schedule_class,
                    counseled_at, counselor_user_id, notes,
                    patient_consented, created_at
               FROM counsel_log
              WHERE bill_id = ?1
              ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![bill_id], |r| {
            Ok(CounselLogRow {
                id: r.get(0)?,
                bill_id: r.get(1)?,
                drug_id: r.get(2)?,
                drug_name: r.get(3)?,
                schedule_class: r.get(4)?,
                counseled_at: r.get(5)?,
                counselor_user_id: r.get(6)?,
                notes: r.get(7)?,
                patient_consented: r.get::<_, i64>(8)? != 0,
                created_at: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Returns the list of H/H1/X drugs in this bill that still have NO
/// `counsel_log` row. Empty Vec means the bill may save. save_bill calls
/// the inner helper while holding the DbState lock.
///
/// Implementation note: we DEDUPE by drug_id even when the same drug
/// appears on multiple lines of the bill (e.g. tablet + suspension
/// strength variants of the same INN). One counsel_log row per
/// (bill, drug) clears the gate for every line of that drug — RPh
/// counsels the patient about the molecule, not each SKU.
#[tauri::command]
pub fn check_counseling_complete(
    state: State<'_, DbState>,
    bill_id: String,
) -> Result<Vec<MissingCounsel>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    check_counseling_complete_inner(&c, &bill_id)
}

pub(crate) fn check_counseling_complete_inner(
    conn: &Connection,
    bill_id: &str,
) -> Result<Vec<MissingCounsel>, String> {
    // Bill lines + product schedule, restricted to H/H1/X. LEFT JOIN on
    // counsel_log to spot drugs that have no counsel row yet for this
    // bill. GROUP BY product to dedupe across multiple bill_lines of the
    // same product.
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, p.schedule
               FROM bill_lines bl
               JOIN products p ON p.id = bl.product_id
              WHERE bl.bill_id = ?1
                AND p.schedule IN ('H','H1','X')
                AND NOT EXISTS (
                      SELECT 1 FROM counsel_log cl
                       WHERE cl.bill_id = bl.bill_id
                         AND cl.drug_id = p.id
                  )
              GROUP BY p.id
              ORDER BY p.name ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![bill_id], |r| {
            Ok(MissingCounsel {
                drug_id: r.get(0)?,
                drug_name: r.get(1)?,
                schedule_class: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// save_bill-time variant that works against the basket payload before
/// the bill's bill_lines have been written. The cashier UI calls
/// `log_counseling` BEFORE save_bill, but counsel_log keys on bill_id
/// — and the bill_id in save_bill is the to-be-inserted id, so the
/// counsel_log rows already exist and the existing-row check still
/// works on bill_lines because save_bill writes bill_lines first then
/// runs this gate before commit.
///
/// Wait — that ordering is wrong (commit happens after the gate would
/// run if placed at the bottom). We instead expose a helper that
/// inspects the (product_id, schedule) tuples directly from the
/// products table, given the basket. save_bill calls THIS helper
/// before opening the transaction.
pub(crate) fn check_counseling_complete_for_basket(
    conn: &Connection,
    bill_id: &str,
    product_ids: &[String],
) -> Result<Vec<MissingCounsel>, String> {
    if product_ids.is_empty() {
        return Ok(vec![]);
    }
    // Build a parameter placeholder list (?2,?3,...). bill_id is ?1.
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
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    // Build params: bill_id then each product id.
    let mut bound: Vec<&dyn rusqlite::ToSql> = vec![&bill_id];
    for pid in product_ids {
        bound.push(pid);
    }
    let rows = stmt
        .query_map(rusqlite::params_from_iter(bound.iter()), |r| {
            Ok(MissingCounsel {
                drug_id: r.get(0)?,
                drug_name: r.get(1)?,
                schedule_class: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Format a CounselingIncomplete error for save_bill. We use a
/// stringly-typed prefix `COUNSELING_INCOMPLETE:` followed by the JSON
/// list of missing drugs so the TS side can `e.startsWith(...)` and
/// JSON.parse the suffix. (Tauri commands return `Result<T, String>`,
/// so a typed error variant would require a wider refactor; the
/// existing save_bill error contract uses the same colon-delimited
/// pattern — see RX_REQUIRED, NEAR_EXPIRY_NO_OVERRIDE, NPPA_CAP_EXCEEDED.)
pub(crate) fn format_counseling_incomplete_err(missing: &[MissingCounsel]) -> String {
    let body = serde_json::to_string(missing).unwrap_or_else(|_| "[]".to_string());
    format!("COUNSELING_INCOMPLETE:{body}")
}
