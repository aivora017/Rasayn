// schedule_register.rs — Real Schedule H/H1/X register query (S26.B fix).
//
// Replaces the demo data in ComplianceScheduleHTab.tsx + InspectorModeScreen.tsx
// (which fabricated `Asha Iyer / Dr. Sharma` rows). Source-of-truth for the
// FDA inspector view: every dispensation of Schedule-H/H1/X drugs in a given
// period, joined to customer + doctor + prescription.
//
// Schema invariants (see migrations 0001 + 0014):
//   - bills.is_voided is excluded (voided bills did not actually dispense)
//   - bills.customer_id NULLABLE — walk-in cash sales for OTC are common, but
//     for Schedule-H lines a missing customer is still a row (FDA wants to see
//     it, and the inspector can flag it).
//   - bills.rx_id NULLABLE — Schedule-H may legitimately have rx, Schedule-X
//     mandates rx. We surface what is recorded; we do not fabricate.
//   - prescriptions has no `rx_no` column; we expose prescription.id as rx_no.
//
// PDF/CSV decision: ship CSV only this round (printpdf would add a 1.5MB
// dependency). schedule_register_pdf_path() writes a CSV next to the user's
// data dir and returns the path. The TS side can render to PDF via the OS
// print-to-PDF on the inspector screen if needed.

use crate::db::DbState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::io::Write;
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRegisterRow {
    pub bill_no: String,
    pub billed_at_iso: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub customer_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub customer_phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doctor_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rx_no: Option<String>,
    pub product_name: String,
    pub batch_no: String,
    pub qty: f64,
    pub schedule: String,
    pub sale_amount_paise: i64,
}

fn validate_schedule_filter(s: &str) -> Result<(), String> {
    match s {
        "H" | "H1" | "X" | "all" => Ok(()),
        _ => Err(format!("INVALID_SCHEDULE_FILTER:{}", s)),
    }
}

fn validate_iso_date(s: &str, label: &str) -> Result<(), String> {
    // Cheap shape check: YYYY-MM-DD = 10 chars, [4]='-', [7]='-'
    if s.len() != 10 || s.as_bytes()[4] != b'-' || s.as_bytes()[7] != b'-' {
        return Err(format!("INVALID_DATE:{}={}", label, s));
    }
    Ok(())
}

fn query_rows(
    c: &Connection,
    period_start_iso: &str,
    period_end_iso: &str,
    schedule: &str,
    shop_id: &str,
) -> Result<Vec<ScheduleRegisterRow>, String> {
    // billed_at is ISO8601 UTC (e.g. 2026-04-30T14:23:00.000Z). substr(.,1,10)
    // gives YYYY-MM-DD which we compare lexically against the period bounds.
    let schedule_clause = match schedule {
        "all" => "p.schedule IN ('H','H1','X')".to_string(),
        s => format!("p.schedule = '{}'", s),
    };
    let sql = format!(
        "SELECT b.bill_no, b.billed_at, c.name, c.phone, d.name, b.rx_id,
                p.name, ba.batch_no, bl.qty, p.schedule, bl.line_total_paise
         FROM bill_lines bl
         JOIN bills b      ON b.id = bl.bill_id
         JOIN products p   ON p.id = bl.product_id
         JOIN batches ba   ON ba.id = bl.batch_id
         LEFT JOIN customers c ON c.id = b.customer_id
         LEFT JOIN doctors   d ON d.id = b.doctor_id
         WHERE b.shop_id = ?1
           AND b.is_voided = 0
           AND substr(b.billed_at, 1, 10) >= ?2
           AND substr(b.billed_at, 1, 10) <= ?3
           AND {schedule_clause}
         ORDER BY b.billed_at ASC, b.bill_no ASC",
        schedule_clause = schedule_clause
    );
    let mut stmt = c.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![shop_id, period_start_iso, period_end_iso], |r| {
            Ok(ScheduleRegisterRow {
                bill_no: r.get(0)?,
                billed_at_iso: r.get(1)?,
                customer_name: r.get(2)?,
                customer_phone: r.get(3)?,
                doctor_name: r.get(4)?,
                rx_no: r.get(5)?,
                product_name: r.get(6)?,
                batch_no: r.get(7)?,
                qty: r.get(8)?,
                schedule: r.get(9)?,
                sale_amount_paise: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn list_schedule_register(
    db: State<'_, DbState>,
    period_start_iso: String,
    period_end_iso: String,
    schedule: String,
    shop_id: String,
) -> Result<Vec<ScheduleRegisterRow>, String> {
    validate_iso_date(&period_start_iso, "period_start_iso")?;
    validate_iso_date(&period_end_iso, "period_end_iso")?;
    validate_schedule_filter(&schedule)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    query_rows(
        &conn,
        &period_start_iso,
        &period_end_iso,
        &schedule,
        &shop_id,
    )
}

/// Write a CSV register file next to the user data dir and return the path.
/// Decision: CSV (not PDF) this round — printpdf adds ~1.5MB to the binary
/// and we already ship a PDF print path via the OS dialog from the TS side.
/// Marked TODO: when an FDA inspector specifically asks for the offline PDF,
/// promote this to printpdf or use an ADR to pick a smaller crate.
#[tauri::command]
pub fn schedule_register_pdf_path(
    db: State<'_, DbState>,
    period_start_iso: String,
    period_end_iso: String,
    schedule: String,
    shop_id: String,
) -> Result<String, String> {
    validate_iso_date(&period_start_iso, "period_start_iso")?;
    validate_iso_date(&period_end_iso, "period_end_iso")?;
    validate_schedule_filter(&schedule)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let rows = query_rows(
        &conn,
        &period_start_iso,
        &period_end_iso,
        &schedule,
        &shop_id,
    )?;

    let base = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let dir = base.join("PharmaCarePro").join("schedule_registers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let fname = format!(
        "schedule_register_{}_{}_{}.csv",
        shop_id, schedule, period_start_iso
    );
    let path = dir.join(&fname);
    let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    writeln!(
        f,
        "bill_no,billed_at_iso,customer_name,customer_phone,doctor_name,rx_no,product_name,batch_no,qty,schedule,sale_amount_paise"
    )
    .map_err(|e| e.to_string())?;
    for r in rows {
        writeln!(
            f,
            "{},{},{},{},{},{},{},{},{},{},{}",
            csv_escape(&r.bill_no),
            csv_escape(&r.billed_at_iso),
            csv_escape(r.customer_name.as_deref().unwrap_or("")),
            csv_escape(r.customer_phone.as_deref().unwrap_or("")),
            csv_escape(r.doctor_name.as_deref().unwrap_or("")),
            csv_escape(r.rx_no.as_deref().unwrap_or("")),
            csv_escape(&r.product_name),
            csv_escape(&r.batch_no),
            r.qty,
            csv_escape(&r.schedule),
            r.sale_amount_paise
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().to_string())
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        let esc = s.replace('"', "\"\"");
        format!("\"{}\"", esc)
    } else {
        s.to_string()
    }
}
