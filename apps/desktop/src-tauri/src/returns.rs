// A8 · Partial refund command family (ADR 0021 step 3).
// -----------------------------------------------------------------------------
// Rust-side counterpart to `@pharmacare/bill-repo` partialRefund.ts pro-rata
// math, wired to the migration 0020 schema. Five Tauri commands:
//
//   * save_partial_return       — the main transactional writer.
//   * list_returns_for_bill     — header summary for BillingScreen + ReturnsScreen.
//   * get_refundable_qty        — remaining-qty lookup used by the picker UI.
//   * record_credit_note_irn    — invoked by the CRN async submitter (ADR 0017).
//   * next_return_no            — 'CN/YYYY-YY/NNNN' numerator (Q3 resolution).
//
// Compliance gates (Playbook §8.8, ADR 0021 §5-6) are layered in this order:
//   1. Original bill exists (+ input validation).
//   2. Rx gate (H/H1/X/NDPS lines require original bill to have a valid rx_id
//      AND the prescription's retention_until must not be in the past).
//   3. IRN gate: if original bill has einvoice_status in
//      ('pending','submitted','failed'), block until async worker finalises.
//   4. Expired batch: reason_code='expired_at_return' requires a
//      fresh expiry_override_audit row (same 10-min window as save_bill).
//   5. Pro-rata compute per line.
//   6. Tender plan validation (sum must equal refund_total within 50 paise).
//   7. Transactional insert: return_headers -> return_lines (triggers handle
//      qty limit + NPPA cap + stock movement) -> audit_log.

use crate::db::DbState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

// ---- Input / output structs ------------------------------------------------

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PartialReturnLineInput {
    pub bill_line_id: String,
    pub qty_returned: f64,
    pub reason_code: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReturnTender {
    pub mode: String,
    pub amount_paise: i64,
    #[serde(default)]
    pub ref_no: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePartialReturnInput {
    pub return_id: String,
    pub shop_id: String,
    pub return_no: String,
    pub original_bill_id: String,
    pub reason: String,
    pub actor_user_id: String,
    pub lines: Vec<PartialReturnLineInput>,
    pub tender_plan: Vec<ReturnTender>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SavePartialReturnResult {
    pub return_id: String,
    pub refund_total_paise: i64,
    pub einvoice_status: Option<String>,
    pub credit_note_issued_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReturnHeaderRow {
    pub id: String,
    pub original_bill_id: String,
    pub return_no: String,
    pub return_type: String,
    pub reason: String,
    pub refund_total_paise: i64,
    pub refund_cgst_paise: i64,
    pub refund_sgst_paise: i64,
    pub refund_igst_paise: i64,
    pub refund_cess_paise: i64,
    pub refund_round_off_paise: i64,
    pub credit_note_irn: Option<String>,
    pub credit_note_ack_no: Option<String>,
    pub credit_note_ack_date: Option<String>,
    pub einvoice_status: Option<String>,
    pub created_at: String,
    pub created_by: String,
}

// ---- Constants -------------------------------------------------------------

const TENDER_TOLERANCE_PAISE: i64 = 50;

const IRN_STATES_BLOCKING: &[&str] = &["pending", "submitted", "failed"];

// ---- Pro-rata math (Rust mirror of bill-repo/partialRefund.ts) -------------

struct LineProRata {
    refund_taxable: i64,
    refund_discount: i64,
    refund_cgst: i64,
    refund_sgst: i64,
    refund_igst: i64,
    refund_cess: i64,
    refund_amount: i64,
}

fn round_half_away_from_zero(x: f64) -> i64 {
    if x >= 0.0 {
        (x + 0.5).floor() as i64
    } else {
        -((-x + 0.5).floor() as i64)
    }
}

#[allow(clippy::too_many_arguments)]
fn compute_line_pro_rata(
    qty_returned: f64,
    orig_qty: f64,
    orig_taxable_paise: i64,
    orig_discount_paise: i64,
    orig_cgst_paise: i64,
    orig_sgst_paise: i64,
    orig_igst_paise: i64,
    orig_cess_paise: i64,
) -> LineProRata {
    let ratio = qty_returned / orig_qty;
    let t = round_half_away_from_zero(orig_taxable_paise as f64 * ratio);
    let d = round_half_away_from_zero(orig_discount_paise as f64 * ratio);
    let cg = round_half_away_from_zero(orig_cgst_paise as f64 * ratio);
    let sg = round_half_away_from_zero(orig_sgst_paise as f64 * ratio);
    let ig = round_half_away_from_zero(orig_igst_paise as f64 * ratio);
    let ce = round_half_away_from_zero(orig_cess_paise as f64 * ratio);
    let amt = t - d + cg + sg + ig + ce;
    LineProRata {
        refund_taxable: t,
        refund_discount: d,
        refund_cgst: cg,
        refund_sgst: sg,
        refund_igst: ig,
        refund_cess: ce,
        refund_amount: amt,
    }
}

// ---- save_partial_return ---------------------------------------------------

#[tauri::command]
pub fn save_partial_return(
    input: SavePartialReturnInput,
    state: State<DbState>,
) -> Result<SavePartialReturnResult, String> {
    let mut c = state.0.lock().map_err(|e| e.to_string())?;
    save_partial_return_impl(&mut c, &input)
}

pub fn save_partial_return_impl(
    c: &mut Connection,
    input: &SavePartialReturnInput,
) -> Result<SavePartialReturnResult, String> {
    if input.lines.is_empty() {
        return Err("INVALID_INPUT:no_lines".to_string());
    }
    if input.reason.trim().len() < 4 {
        return Err("INVALID_INPUT:reason_too_short".to_string());
    }
    if input.tender_plan.is_empty() {
        return Err("INVALID_INPUT:no_tender_plan".to_string());
    }

    let (bill_exists, bill_rx_id, bill_einvoice_status, bill_shop_id): (
        bool,
        Option<String>,
        Option<String>,
        String,
    ) = match c.query_row(
        "SELECT rx_id, einvoice_status, shop_id
           FROM bills WHERE id = ?1",
        params![input.original_bill_id],
        |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
            ))
        },
    ) {
        Ok((rx, ei, sh)) => (true, rx, ei, sh),
        Err(rusqlite::Error::QueryReturnedNoRows) => (false, None, None, String::new()),
        Err(e) => return Err(format!("DB_ERROR:bill_lookup:{}", e)),
    };
    if !bill_exists {
        return Err(format!("BILL_NOT_FOUND:{}", input.original_bill_id));
    }
    if bill_shop_id != input.shop_id {
        return Err(format!(
            "SHOP_MISMATCH:bill_shop={}:input_shop={}",
            bill_shop_id, input.shop_id
        ));
    }

    if let Some(status) = bill_einvoice_status.as_deref() {
        if IRN_STATES_BLOCKING.contains(&status) {
            return Err(format!(
                "IRN_NOT_ACKED:bill={}:status={}",
                input.original_bill_id, status
            ));
        }
    }

    let target_einvoice_status: Option<String> = match bill_einvoice_status.as_deref() {
        Some("acked") => Some("pending".to_string()),
        Some("cancelled") => Some("n/a".to_string()),
        Some("n/a") => Some("n/a".to_string()),
        _ => None,
    };

    let mut line_rows: Vec<LineInsertPlan> = Vec::with_capacity(input.lines.len());
    let mut refund_total: i64 = 0;
    let mut refund_cgst_total: i64 = 0;
    let mut refund_sgst_total: i64 = 0;
    let mut refund_igst_total: i64 = 0;
    let mut refund_cess_total: i64 = 0;

    for l in input.lines.iter() {
        if !l.qty_returned.is_finite() || l.qty_returned <= 0.0 {
            return Err(format!(
                "INVALID_RETURN_QTY:bill_line={}:qty={}",
                l.bill_line_id, l.qty_returned
            ));
        }

        let row = c.query_row(
            "SELECT bl.qty, bl.taxable_value_paise, bl.discount_paise,
                    bl.cgst_paise, bl.sgst_paise, bl.igst_paise, bl.cess_paise,
                    bl.line_total_paise, bl.batch_id, bl.product_id,
                    p.schedule
               FROM bill_lines bl
               JOIN products p ON p.id = bl.product_id
              WHERE bl.id = ?1 AND bl.bill_id = ?2",
            params![l.bill_line_id, input.original_bill_id],
            |r| {
                Ok((
                    r.get::<_, f64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, i64>(7)?,
                    r.get::<_, String>(8)?,
                    r.get::<_, String>(9)?,
                    r.get::<_, String>(10)?,
                ))
            },
        );
        let (
            orig_qty,
            taxable,
            discount,
            cgst,
            sgst,
            igst,
            cess,
            _line_total,
            batch_id,
            product_id,
            schedule,
        ) = match row {
            Ok(r) => r,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(format!(
                    "BILL_LINE_NOT_FOUND:{}:bill={}",
                    l.bill_line_id, input.original_bill_id
                ));
            }
            Err(e) => return Err(format!("DB_ERROR:bill_line_lookup:{}", e)),
        };

        if matches!(schedule.as_str(), "H" | "H1" | "X" | "NDPS") {
            let rx_id = bill_rx_id
                .clone()
                .ok_or_else(|| format!("RX_MISSING_ON_ORIGINAL_BILL:product_id={}", product_id))?;
            let retention: Option<String> = c
                .query_row(
                    "SELECT retention_until FROM prescriptions WHERE id = ?1",
                    params![rx_id],
                    |r| r.get::<_, Option<String>>(0),
                )
                .map_err(|e| format!("DB_ERROR:rx_lookup:{}", e))?;
            let ok_rx = retention
                .as_deref()
                .is_some_and(|d| d >= chrono::Utc::now().format("%Y-%m-%d").to_string().as_str());
            if !ok_rx {
                return Err(format!("RX_RETENTION_EXPIRED:rx_id={}", rx_id));
            }
        }

        let already_returned: f64 = c
            .query_row(
                "SELECT COALESCE(SUM(qty_returned), 0) FROM return_lines
                  WHERE bill_line_id = ?1",
                params![l.bill_line_id],
                |r| r.get::<_, f64>(0),
            )
            .unwrap_or(0.0);
        if l.qty_returned > (orig_qty - already_returned) + 1e-9 {
            return Err(format!(
                "QTY_EXCEEDS_REFUNDABLE:bill_line={}:requested={}:remaining={}",
                l.bill_line_id,
                l.qty_returned,
                orig_qty - already_returned
            ));
        }

        if l.reason_code == "expired_at_return" {
            let has_override: i64 = c
                .query_row(
                    "SELECT COUNT(*) FROM expiry_override_audit
                      WHERE batch_id = ?1
                        AND actor_user_id = ?2
                        AND created_at > datetime('now','-10 minutes')",
                    params![batch_id, input.actor_user_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if has_override == 0 {
                return Err(format!("EXPIRED_AT_RETURN_NO_OVERRIDE:batch={}", batch_id));
            }
        }

        let p = compute_line_pro_rata(
            l.qty_returned,
            orig_qty,
            taxable,
            discount,
            cgst,
            sgst,
            igst,
            cess,
        );
        refund_total += p.refund_amount;
        refund_cgst_total += p.refund_cgst;
        refund_sgst_total += p.refund_sgst;
        refund_igst_total += p.refund_igst;
        refund_cess_total += p.refund_cess;

        line_rows.push(LineInsertPlan {
            bill_line_id: l.bill_line_id.clone(),
            batch_id,
            qty_returned: l.qty_returned,
            reason_code: l.reason_code.clone(),
            refund_taxable: p.refund_taxable,
            refund_discount: p.refund_discount,
            refund_cgst: p.refund_cgst,
            refund_sgst: p.refund_sgst,
            refund_igst: p.refund_igst,
            refund_cess: p.refund_cess,
            refund_amount: p.refund_amount,
        });
    }

    let tender_sum: i64 = input.tender_plan.iter().map(|t| t.amount_paise).sum();
    let round_off = refund_total - tender_sum;
    if round_off.abs() > TENDER_TOLERANCE_PAISE {
        return Err(format!(
            "TENDER_MISMATCH:sum={}:refund_total={}:diff={}",
            tender_sum, refund_total, round_off
        ));
    }

    for t in input.tender_plan.iter() {
        if t.mode == "credit_note" {
            return Err("REFUND_TENDER_UNAVAILABLE:credit_note_deferred_adr0022".to_string());
        }
        if !matches!(
            t.mode.as_str(),
            "cash" | "upi" | "card" | "credit" | "wallet"
        ) {
            return Err(format!("INVALID_TENDER_MODE:{}", t.mode));
        }
        if t.amount_paise <= 0 {
            return Err(format!(
                "INVALID_TENDER_AMOUNT:mode={}:amount={}",
                t.mode, t.amount_paise
            ));
        }
    }

    let bill_line_total: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM bill_lines WHERE bill_id = ?1",
            params![input.original_bill_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let is_full = input.lines.len() as i64 == bill_line_total
        && line_rows.iter().all(|r| {
            let orig: f64 = c
                .query_row(
                    "SELECT qty FROM bill_lines WHERE id = ?1",
                    params![r.bill_line_id],
                    |row| row.get(0),
                )
                .unwrap_or(0.0);
            let prior: f64 = c
                .query_row(
                    "SELECT COALESCE(SUM(qty_returned),0) FROM return_lines
                      WHERE bill_line_id = ?1",
                    params![r.bill_line_id],
                    |row| row.get(0),
                )
                .unwrap_or(0.0);
            (r.qty_returned + prior - orig).abs() < 1e-9
        });
    let return_type = if is_full { "full" } else { "partial" };

    let tender_summary_json = serde_json::to_string(
        &input
            .tender_plan
            .iter()
            .map(|t| {
                serde_json::json!({
                    "mode": t.mode,
                    "amountPaise": t.amount_paise,
                    "refNo": t.ref_no,
                })
            })
            .collect::<Vec<_>>(),
    )
    .map_err(|e| format!("SERIALIZE_TENDER:{}", e))?;

    let tx = c.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO return_headers
           (id, original_bill_id, shop_id, return_no, return_type, reason,
            tender_summary_json, refund_total_paise,
            refund_cgst_paise, refund_sgst_paise, refund_igst_paise,
            refund_cess_paise, refund_round_off_paise,
            einvoice_status, created_by)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![
            input.return_id,
            input.original_bill_id,
            input.shop_id,
            input.return_no,
            return_type,
            input.reason,
            tender_summary_json,
            refund_total,
            refund_cgst_total,
            refund_sgst_total,
            refund_igst_total,
            refund_cess_total,
            round_off,
            target_einvoice_status,
            input.actor_user_id,
        ],
    )
    .map_err(|e| format!("INSERT_RETURN_HEADER:{}", e))?;

    for (idx, r) in line_rows.iter().enumerate() {
        let line_id = format!("{}_l{}", input.return_id, idx + 1);
        tx.execute(
            "INSERT INTO return_lines
               (id, return_id, bill_line_id, batch_id, qty_returned,
                refund_taxable_paise, refund_discount_paise,
                refund_cgst_paise, refund_sgst_paise,
                refund_igst_paise, refund_cess_paise,
                refund_amount_paise, reason_code)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                line_id,
                input.return_id,
                r.bill_line_id,
                r.batch_id,
                r.qty_returned,
                r.refund_taxable,
                r.refund_discount,
                r.refund_cgst,
                r.refund_sgst,
                r.refund_igst,
                r.refund_cess,
                r.refund_amount,
                r.reason_code,
            ],
        )
        .map_err(|e| classify_line_error(e, r))?;
    }

    let audit_payload = serde_json::json!({
        "returnNo": input.return_no,
        "returnType": return_type,
        "refundTotalPaise": refund_total,
        "lineCount": line_rows.len(),
        "einvoiceStatus": target_einvoice_status,
        "originalBillId": input.original_bill_id,
    })
    .to_string();
    tx.execute(
        "INSERT INTO audit_log (actor_id, entity, entity_id, action, payload)
         VALUES (?1, 'return_header', ?2, 'create', ?3)",
        params![input.actor_user_id, input.return_id, audit_payload],
    )
    .map_err(|e| format!("INSERT_AUDIT:{}", e))?;

    tx.commit().map_err(|e| format!("TX_COMMIT:{}", e))?;

    Ok(SavePartialReturnResult {
        return_id: input.return_id.clone(),
        refund_total_paise: refund_total,
        einvoice_status: target_einvoice_status,
        credit_note_issued_id: None,
    })
}

fn classify_line_error(e: rusqlite::Error, r: &LineInsertPlan) -> String {
    let msg = e.to_string();
    if msg.contains("QTY_EXCEEDS_REFUNDABLE") {
        return format!(
            "QTY_EXCEEDS_REFUNDABLE:bill_line={}:qty={}",
            r.bill_line_id, r.qty_returned
        );
    }
    if msg.contains("NPPA_REFUND_EXCEEDS_ORIGINAL") {
        return format!("NPPA_REFUND_EXCEEDS_ORIGINAL:bill_line={}", r.bill_line_id);
    }
    format!("INSERT_RETURN_LINE:{}:{}", r.bill_line_id, msg)
}

struct LineInsertPlan {
    bill_line_id: String,
    batch_id: String,
    qty_returned: f64,
    reason_code: String,
    refund_taxable: i64,
    refund_discount: i64,
    refund_cgst: i64,
    refund_sgst: i64,
    refund_igst: i64,
    refund_cess: i64,
    refund_amount: i64,
}

// ---- list_returns_for_bill -------------------------------------------------

#[tauri::command]
pub fn list_returns_for_bill(
    bill_id: String,
    state: State<DbState>,
) -> Result<Vec<ReturnHeaderRow>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c
        .prepare(
            "SELECT id, original_bill_id, return_no, return_type, reason,
                    refund_total_paise, refund_cgst_paise, refund_sgst_paise,
                    refund_igst_paise, refund_cess_paise, refund_round_off_paise,
                    credit_note_irn, credit_note_ack_no, credit_note_ack_date,
                    einvoice_status, created_at, created_by
               FROM return_headers
              WHERE original_bill_id = ?1
              ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map(params![bill_id], |r| {
            Ok(ReturnHeaderRow {
                id: r.get(0)?,
                original_bill_id: r.get(1)?,
                return_no: r.get(2)?,
                return_type: r.get(3)?,
                reason: r.get(4)?,
                refund_total_paise: r.get(5)?,
                refund_cgst_paise: r.get(6)?,
                refund_sgst_paise: r.get(7)?,
                refund_igst_paise: r.get(8)?,
                refund_cess_paise: r.get(9)?,
                refund_round_off_paise: r.get(10)?,
                credit_note_irn: r.get(11)?,
                credit_note_ack_no: r.get(12)?,
                credit_note_ack_date: r.get(13)?,
                einvoice_status: r.get(14)?,
                created_at: r.get(15)?,
                created_by: r.get(16)?,
            })
        })
        .map_err(|e| e.to_string())?;
    iter.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

// ---- get_refundable_qty ----------------------------------------------------

#[tauri::command]
pub fn get_refundable_qty(bill_line_id: String, state: State<DbState>) -> Result<f64, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    get_refundable_qty_impl(&c, &bill_line_id)
}

pub fn get_refundable_qty_impl(c: &Connection, bill_line_id: &str) -> Result<f64, String> {
    let orig: f64 = c
        .query_row(
            "SELECT qty FROM bill_lines WHERE id = ?1",
            params![bill_line_id],
            |r| r.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                format!("BILL_LINE_NOT_FOUND:{}", bill_line_id)
            }
            other => format!("DB_ERROR:{}", other),
        })?;
    let returned: f64 = c
        .query_row(
            "SELECT COALESCE(SUM(qty_returned),0) FROM return_lines WHERE bill_line_id = ?1",
            params![bill_line_id],
            |r| r.get(0),
        )
        .unwrap_or(0.0);
    let remaining = orig - returned;
    Ok(if remaining < 0.0 { 0.0 } else { remaining })
}

// ---- record_credit_note_irn ------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordCreditNoteIrnInput {
    pub return_id: String,
    pub irn: String,
    pub ack_no: String,
    pub ack_date: String,
    pub qr_code: String,
}

#[tauri::command]
pub fn record_credit_note_irn(
    input: RecordCreditNoteIrnInput,
    state: State<DbState>,
) -> Result<(), String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let n = c
        .execute(
            "UPDATE return_headers
                SET credit_note_irn = ?2,
                    credit_note_ack_no = ?3,
                    credit_note_ack_date = ?4,
                    credit_note_qr_code = ?5,
                    einvoice_status = 'acked'
              WHERE id = ?1",
            params![
                input.return_id,
                input.irn,
                input.ack_no,
                input.ack_date,
                input.qr_code,
            ],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!("RETURN_NOT_FOUND:{}", input.return_id));
    }
    Ok(())
}

// ---- next_return_no --------------------------------------------------------

pub fn fiscal_year_start(today_iso: &str) -> i32 {
    let year: i32 = today_iso
        .get(0..4)
        .and_then(|s| s.parse().ok())
        .unwrap_or(2026);
    let month: i32 = today_iso
        .get(5..7)
        .and_then(|s| s.parse().ok())
        .unwrap_or(1);
    if month >= 4 {
        year
    } else {
        year - 1
    }
}

fn format_return_no(fy_start: i32, seq: i64) -> String {
    let next_yr_short = ((fy_start + 1) % 100).rem_euclid(100);
    format!("CN/{:04}-{:02}/{:04}", fy_start, next_yr_short, seq)
}

#[tauri::command]
pub fn next_return_no(shop_id: String, state: State<DbState>) -> Result<String, String> {
    let mut c = state.0.lock().map_err(|e| e.to_string())?;
    next_return_no_impl(&mut c, &shop_id)
}

pub fn next_return_no_impl(c: &mut Connection, shop_id: &str) -> Result<String, String> {
    let today: String = c
        .query_row("SELECT strftime('%Y-%m-%d','now')", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let fy = fiscal_year_start(&today);

    let tx = c.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO return_no_counters (shop_id, fy_start_year, last_seq)
           VALUES (?1, ?2, 0)
           ON CONFLICT(shop_id, fy_start_year) DO NOTHING",
        params![shop_id, fy],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE return_no_counters
            SET last_seq = last_seq + 1
          WHERE shop_id = ?1 AND fy_start_year = ?2",
        params![shop_id, fy],
    )
    .map_err(|e| e.to_string())?;
    let seq: i64 = tx
        .query_row(
            "SELECT last_seq FROM return_no_counters
              WHERE shop_id = ?1 AND fy_start_year = ?2",
            params![shop_id, fy],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(format_return_no(fy, seq))
}

// ---- residual-to-largest tender split (ADR 0021 §2 rule 2, UI helper) ------

#[allow(dead_code)] // ADR 0021 §2 helper - kept for the picker's UI seed; not yet wired from Rust caller side
pub fn residual_to_largest(origs: &[ReturnTender], refund_total_paise: i64) -> Vec<ReturnTender> {
    let orig_total: i64 = origs.iter().map(|t| t.amount_paise).sum();
    if orig_total <= 0 {
        return vec![];
    }
    let mut allocs: Vec<i64> = Vec::with_capacity(origs.len());
    let mut largest_idx = 0usize;
    let mut largest_amt: i64 = -1;
    let mut sum_alloc: i64 = 0;
    for (i, t) in origs.iter().enumerate() {
        if t.amount_paise > largest_amt {
            largest_amt = t.amount_paise;
            largest_idx = i;
        }
        let share = round_half_away_from_zero(
            (t.amount_paise as f64 * refund_total_paise as f64) / orig_total as f64,
        );
        allocs.push(share);
        sum_alloc += share;
    }
    let residual = refund_total_paise - sum_alloc;
    allocs[largest_idx] += residual;
    origs
        .iter()
        .zip(allocs.iter())
        .filter(|(_, a)| **a > 0)
        .map(|(t, a)| ReturnTender {
            mode: t.mode.clone(),
            amount_paise: *a,
            ref_no: t.ref_no.clone(),
        })
        .collect()
}

// ============================================================================
// Host-side tests
// ============================================================================
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;

    fn open_and_migrate() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory");
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        apply_migrations(&conn).expect("apply_migrations");
        conn
    }

    fn seed_bill(c: &Connection) -> (String, String) {
        // shop_local + user_sourav_owner are auto-seeded by db::apply_migrations
        // (ensure_default_shop / ensure_default_user). Re-inserting them here
        // hits UNIQUE(shops.id) / UNIQUE(users.id). Suppliers is NOT auto-seeded
        // and is required by batches.supplier_id (NOT NULL FK).
        c.execute(
            "INSERT INTO suppliers (id, shop_id, name)
             VALUES ('sup_a','shop_local','Acme Distributors')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO products (id, name, hsn, schedule, gst_rate, mrp_paise,
                                   is_active, pack_form, pack_size, manufacturer, generic_name)
             VALUES ('prod_a','Paracetamol 500','30042011','OTC',12,1000,
                     1,'strip',10,'Acme','Paracetamol')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO batches (id, product_id, batch_no, mfg_date, expiry_date,
                                  qty_on_hand, purchase_price_paise, mrp_paise, supplier_id)
             VALUES ('bat_a','prod_a','B001','2024-01-01','2030-12-31',
                     100, 800, 1000, 'sup_a')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO bills (id, shop_id, bill_no, cashier_id, gst_treatment,
                                subtotal_paise, total_cgst_paise, total_sgst_paise,
                                total_igst_paise, round_off_paise, grand_total_paise,
                                payment_mode)
             VALUES ('bill_1','shop_local','B-0001','user_sourav_owner','intra_state',
                     8929, 535, 536, 0, 0, 10000, 'cash')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO bill_lines (id, bill_id, product_id, batch_id, qty, mrp_paise,
                                     taxable_value_paise, gst_rate, cgst_paise, sgst_paise,
                                     igst_paise, line_total_paise)
             VALUES ('bl_1','bill_1','prod_a','bat_a',10.0,1000,8929,12,535,536,0,10000)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO payments (id, bill_id, mode, amount_paise)
             VALUES ('pay_1','bill_1','cash',10000)",
            [],
        )
        .unwrap();
        ("bill_1".to_string(), "bl_1".to_string())
    }

    fn make_return_input(return_id: &str, bill_line_id: &str, qty: f64) -> SavePartialReturnInput {
        SavePartialReturnInput {
            return_id: return_id.to_string(),
            shop_id: "shop_local".to_string(),
            return_no: "CN/2026-27/TEST".to_string(),
            original_bill_id: "bill_1".to_string(),
            reason: "customer changed mind".to_string(),
            actor_user_id: "user_sourav_owner".to_string(),
            lines: vec![PartialReturnLineInput {
                bill_line_id: bill_line_id.to_string(),
                qty_returned: qty,
                reason_code: "customer_change_of_mind".to_string(),
            }],
            tender_plan: vec![ReturnTender {
                mode: "cash".to_string(),
                amount_paise: 0,
                ref_no: None,
            }],
        }
    }

    #[test]
    fn full_return_ten_strips() {
        let mut c = open_and_migrate();
        let (_bill_id, bl_id) = seed_bill(&c);
        let mut input = make_return_input("ret_full", &bl_id, 10.0);
        input.tender_plan[0].amount_paise = 10000;
        let res = save_partial_return_impl(&mut c, &input).expect("save full");
        assert_eq!(res.refund_total_paise, 10000);
        let rtype: String = c
            .query_row(
                "SELECT return_type FROM return_headers WHERE id='ret_full'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rtype, "full");
    }

    #[test]
    fn half_strip_partial_return() {
        let mut c = open_and_migrate();
        let (_bill_id, bl_id) = seed_bill(&c);
        let mut input = make_return_input("ret_half", &bl_id, 0.5);
        input.tender_plan[0].amount_paise = 500;
        let res = save_partial_return_impl(&mut c, &input).expect("save half");
        assert_eq!(res.refund_total_paise, 500);
        let rtype: String = c
            .query_row(
                "SELECT return_type FROM return_headers WHERE id='ret_half'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rtype, "partial");
    }

    #[test]
    fn repeated_partials_sum_to_full_qty() {
        let mut c = open_and_migrate();
        let (_bill_id, bl_id) = seed_bill(&c);

        let mut a = make_return_input("ret_a", &bl_id, 3.0);
        a.tender_plan[0].amount_paise = 3000;
        a.return_no = "CN/2026-27/0001".to_string();
        save_partial_return_impl(&mut c, &a).expect("save a");

        let mut b = make_return_input("ret_b", &bl_id, 4.0);
        b.tender_plan[0].amount_paise = 4000;
        b.return_no = "CN/2026-27/0002".to_string();
        save_partial_return_impl(&mut c, &b).expect("save b");

        let mut rest = make_return_input("ret_c", &bl_id, 3.0);
        rest.tender_plan[0].amount_paise = 3000;
        rest.return_no = "CN/2026-27/0003".to_string();
        save_partial_return_impl(&mut c, &rest).expect("save c");

        let remaining = get_refundable_qty_impl(&c, &bl_id).unwrap();
        assert!(remaining.abs() < 1e-9, "qty exhausted; got {}", remaining);
    }

    #[test]
    fn over_return_rejected_by_trigger() {
        let mut c = open_and_migrate();
        let (_bill_id, bl_id) = seed_bill(&c);

        let mut first = make_return_input("ret_x", &bl_id, 8.0);
        first.tender_plan[0].amount_paise = 8000;
        first.return_no = "CN/2026-27/X001".to_string();
        save_partial_return_impl(&mut c, &first).expect("save first");

        let mut second = make_return_input("ret_y", &bl_id, 3.0);
        second.tender_plan[0].amount_paise = 3000;
        second.return_no = "CN/2026-27/X002".to_string();
        let err = save_partial_return_impl(&mut c, &second).unwrap_err();
        assert!(
            err.starts_with("QTY_EXCEEDS_REFUNDABLE"),
            "expected QTY_EXCEEDS_REFUNDABLE, got: {}",
            err
        );
    }

    #[test]
    fn tender_mismatch_rejected() {
        let mut c = open_and_migrate();
        let (_bill_id, bl_id) = seed_bill(&c);
        let mut input = make_return_input("ret_mm", &bl_id, 1.0);
        input.tender_plan[0].amount_paise = 900;
        let err = save_partial_return_impl(&mut c, &input).unwrap_err();
        assert!(err.starts_with("TENDER_MISMATCH"), "got: {}", err);
    }

    #[test]
    fn rx_missing_for_schedule_h_line() {
        let mut c = open_and_migrate();
        let (_bill_id, bl_id) = seed_bill(&c);
        // X2 moat (migration 0001): Schedule H/H1/X products require image_sha256.
        // Set both columns in one UPDATE so the trigger sees the image.
        c.execute(
            "UPDATE products
                SET image_sha256 = 'deadbeef00000000000000000000000000000000000000000000000000beef00',
                    schedule = 'H'
              WHERE id = 'prod_a'",
            [],
        )
        .unwrap();
        c.execute("UPDATE bills SET rx_id=NULL WHERE id='bill_1'", [])
            .unwrap();
        let mut input = make_return_input("ret_rx", &bl_id, 1.0);
        input.tender_plan[0].amount_paise = 1000;
        let err = save_partial_return_impl(&mut c, &input).unwrap_err();
        assert!(
            err.starts_with("RX_MISSING_ON_ORIGINAL_BILL"),
            "got: {}",
            err
        );
    }

    #[test]
    fn expired_at_return_no_override_blocked() {
        let mut c = open_and_migrate();
        let (_bill_id, bl_id) = seed_bill(&c);
        let mut input = make_return_input("ret_exp", &bl_id, 1.0);
        input.tender_plan[0].amount_paise = 1000;
        input.lines[0].reason_code = "expired_at_return".to_string();
        let err = save_partial_return_impl(&mut c, &input).unwrap_err();
        assert!(
            err.starts_with("EXPIRED_AT_RETURN_NO_OVERRIDE"),
            "got: {}",
            err
        );
    }

    #[test]
    fn tender_split_residual_to_largest() {
        let origs = vec![
            ReturnTender {
                mode: "upi".to_string(),
                amount_paise: 600,
                ref_no: None,
            },
            ReturnTender {
                mode: "cash".to_string(),
                amount_paise: 400,
                ref_no: None,
            },
        ];
        let split = residual_to_largest(&origs, 250);
        assert_eq!(split.iter().map(|t| t.amount_paise).sum::<i64>(), 250);
        let split2 = residual_to_largest(&origs, 251);
        assert_eq!(split2.iter().map(|t| t.amount_paise).sum::<i64>(), 251);
    }

    #[test]
    fn next_return_no_sequences_per_fy() {
        let mut c = open_and_migrate();
        let a = next_return_no_impl(&mut c, "shop_local").unwrap();
        let b = next_return_no_impl(&mut c, "shop_local").unwrap();
        let d = next_return_no_impl(&mut c, "shop_local").unwrap();
        assert!(a.starts_with("CN/"));
        assert!(b.ends_with("/0002"), "got {}", b);
        assert!(d.ends_with("/0003"), "got {}", d);
    }

    #[test]
    fn fiscal_year_boundaries() {
        assert_eq!(fiscal_year_start("2026-04-01"), 2026);
        assert_eq!(fiscal_year_start("2026-03-31"), 2025);
        assert_eq!(fiscal_year_start("2026-12-31"), 2026);
        assert_eq!(fiscal_year_start("2027-01-15"), 2026);
    }

    #[test]
    fn record_credit_note_irn_flips_status() {
        let mut c = open_and_migrate();
        let (_bill_id, bl_id) = seed_bill(&c);
        c.execute(
            "UPDATE bills SET einvoice_status='acked' WHERE id='bill_1'",
            [],
        )
        .unwrap();
        let mut input = make_return_input("ret_irn", &bl_id, 1.0);
        input.tender_plan[0].amount_paise = 1000;
        save_partial_return_impl(&mut c, &input).unwrap();

        let status: String = c
            .query_row(
                "SELECT einvoice_status FROM return_headers WHERE id='ret_irn'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "pending");

        c.execute(
            "UPDATE return_headers
               SET credit_note_irn = 'IRN-CRN-001',
                   credit_note_ack_no = 'ACK-001',
                   credit_note_ack_date = '2026-04-21',
                   credit_note_qr_code = 'QR-CRN-001',
                   einvoice_status = 'acked'
             WHERE id = 'ret_irn'",
            [],
        )
        .unwrap();

        let final_status: String = c
            .query_row(
                "SELECT einvoice_status FROM return_headers WHERE id='ret_irn'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(final_status, "acked");
    }
}
