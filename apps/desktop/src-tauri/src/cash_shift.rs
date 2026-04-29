// cash_shift.rs — Tauri commands for @pharmacare/cash-shift package.
//
// Wraps the SQLite-backed cash_shifts table (migration 0023) with idiomatic
// open/close/z-report operations matching the IPC contract in
// apps/desktop/src/lib/ipc.ts (cashShift{FindOpen,Open,Close,ZReport}Rpc).
//
// Design rules (ADR-0039):
//   - Variance threshold ₹500 = 50_000 paise; over that, manager approval required.
//   - Variance noise floor ₹0.50 = 50 paise; below that, treat as exact.
//   - Cannot open two shifts on the same shop while one is open.
//   - Z-report is computed at close time from bills + payments + return_headers
//     intersected with the shift's [opened_at, now] window.

use crate::db::DbState;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::State;


// ─── DTOs ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DenominationCountDto {
    pub d2000: i64,
    pub d500: i64,
    pub d200: i64,
    pub d100: i64,
    pub d50: i64,
    pub d20: i64,
    pub d10: i64,
    pub c5: i64,
    pub c2: i64,
    pub c1: i64,
}

impl DenominationCountDto {
    fn total_paise(&self) -> Result<i64, String> {
        let parts: [(i64, i64); 10] = [
            (self.d2000, 200_000),
            (self.d500, 50_000),
            (self.d200, 20_000),
            (self.d100, 10_000),
            (self.d50, 5_000),
            (self.d20, 2_000),
            (self.d10, 1_000),
            (self.c5, 500),
            (self.c2, 200),
            (self.c1, 100),
        ];
        let mut total: i64 = 0;
        for (count, face) in parts {
            if count < 0 {
                return Err(format!("INVALID_DENOMINATION_COUNT: {}", count));
            }
            total = total
                .checked_add(count.checked_mul(face).ok_or("DENOM_OVERFLOW")?)
                .ok_or("DENOM_TOTAL_OVERFLOW")?;
        }
        Ok(total)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CashShiftDto {
    pub id: String,
    pub shop_id: String,
    pub opened_by_user_id: String,
    pub opened_at: String,
    pub opening_balance_paise: i64,
    pub opening_denominations: DenominationCountDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_by_user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closing_balance_paise: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closing_denominations: Option<DenominationCountDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_closing_paise: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variance_paise: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variance_approved_by_user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub z_report_json: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TenderBreakdownDto {
    pub cash: i64,
    pub upi: i64,
    pub card: i64,
    pub cheque: i64,
    pub credit: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ZReportDto {
    pub shift_id: String,
    pub shop_id: String,
    pub period_start: String,
    pub period_end: String,
    pub bill_count: i64,
    pub return_count: i64,
    pub total_sales_paise: i64,
    pub total_returns_paise: i64,
    pub total_discounts_paise: i64,
    pub gst_by_hsn: BTreeMap<String, i64>,
    pub tender_breakdown: TenderBreakdownDto,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashShiftOpenInput {
    pub shop_id: String,
    pub opening_denominations: DenominationCountDto,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashShiftCloseInput {
    pub shift_id: String,
    pub closing_denominations: DenominationCountDto,
    pub variance_approved_by_user_id: Option<String>,
}

// ─── Row mappers ─────────────────────────────────────────────────────────

fn row_to_shift(r: &Row<'_>) -> rusqlite::Result<CashShiftDto> {
    let opening_denoms_json: String = r.get("opening_denominations_json")?;
    let opening_denominations: DenominationCountDto = serde_json::from_str(&opening_denoms_json)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?;
    let closing_denominations: Option<DenominationCountDto> =
        match r.get::<_, Option<String>>("closing_denominations_json")? {
            Some(s) => Some(serde_json::from_str(&s).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
            })?),
            None => None,
        };
    Ok(CashShiftDto {
        id: r.get("id")?,
        shop_id: r.get("shop_id")?,
        opened_by_user_id: r.get("opened_by_user_id")?,
        opened_at: r.get("opened_at")?,
        opening_balance_paise: r.get("opening_balance_paise")?,
        opening_denominations,
        closed_at: r.get("closed_at")?,
        closed_by_user_id: r.get("closed_by_user_id")?,
        closing_balance_paise: r.get("closing_balance_paise")?,
        closing_denominations,
        expected_closing_paise: r.get("expected_closing_paise")?,
        variance_paise: r.get("variance_paise")?,
        variance_approved_by_user_id: r.get("variance_approved_by_user_id")?,
        z_report_json: r.get("z_report_json")?,
    })
}

const SHIFT_COLS: &str = "id, shop_id, opened_by_user_id, opened_at,
    opening_balance_paise, opening_denominations_json,
    closed_at, closed_by_user_id, closing_balance_paise, closing_denominations_json,
    expected_closing_paise, variance_paise, variance_approved_by_user_id, z_report_json";

// ─── Tauri commands ─────────────────────────────────────────────────────

/// Returns the open shift (closed_at IS NULL) for a shop, or None.
#[tauri::command]
pub fn cash_shift_find_open(
    shop_id: String,
    state: State<'_, DbState>,
) -> Result<Option<CashShiftDto>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    find_open_shift(&c, &shop_id).map_err(|e| e.to_string())
}

fn find_open_shift(c: &Connection, shop_id: &str) -> rusqlite::Result<Option<CashShiftDto>> {
    let sql = format!(
        "SELECT {SHIFT_COLS} FROM cash_shifts \
         WHERE shop_id = ?1 AND closed_at IS NULL \
         ORDER BY opened_at DESC LIMIT 1"
    );
    let mut stmt = c.prepare(&sql)?;
    stmt.query_row(params![shop_id], row_to_shift).optional()
}

/// Opens a new shift. Errors if any open shift already exists for this shop.
/// Uses the seeded owner user as opened_by_user_id (single-user pilot).
#[tauri::command]
pub fn cash_shift_open(
    input: CashShiftOpenInput,
    state: State<'_, DbState>,
) -> Result<CashShiftDto, String> {
    let mut c = state.0.lock().map_err(|e| e.to_string())?;
    let tx = c.transaction().map_err(|e| e.to_string())?;

    // Reject double-open.
    if let Some(existing) = find_open_shift(&tx, &input.shop_id).map_err(|e| e.to_string())? {
        return Err(format!("SHIFT_ALREADY_OPEN: {}", existing.id));
    }

    let opening_paise = input.opening_denominations.total_paise()?;
    let opening_json =
        serde_json::to_string(&input.opening_denominations).map_err(|e| e.to_string())?;
    let id = format!("shift_{}", rand_id_hex(16));
    let opened_at = now_iso();

    // Resolve a default actor: prefer the seeded owner; fall back to first user in shop.
    let actor: String = tx
        .query_row(
            "SELECT id FROM users WHERE shop_id = ?1 AND role = 'owner' AND is_active = 1 \
             ORDER BY created_at LIMIT 1",
            params![input.shop_id],
            |r| r.get(0),
        )
        .or_else(|_| {
            tx.query_row(
                "SELECT id FROM users WHERE shop_id = ?1 AND is_active = 1 \
                 ORDER BY created_at LIMIT 1",
                params![input.shop_id],
                |r| r.get(0),
            )
        })
        .map_err(|e| format!("NO_ACTOR_USER: {e}"))?;

    tx.execute(
        "INSERT INTO cash_shifts \
            (id, shop_id, opened_by_user_id, opened_at, opening_balance_paise, opening_denominations_json) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, input.shop_id, actor, opened_at, opening_paise, opening_json],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    // SELECT under the same lock; std::sync::Mutex is not re-entrant.
    let sql = format!("SELECT {SHIFT_COLS} FROM cash_shifts WHERE id = ?1");
    c.query_row(&sql, params![id], row_to_shift)
        .map_err(|e| e.to_string())
}

/// Closes the shift, computing variance + Z-report in one transaction.
#[tauri::command]
pub fn cash_shift_close(
    input: CashShiftCloseInput,
    state: State<'_, DbState>,
) -> Result<CashShiftDto, String> {
    let mut c = state.0.lock().map_err(|e| e.to_string())?;
    let tx = c.transaction().map_err(|e| e.to_string())?;

    // Load the shift.
    let shift_sql = format!("SELECT {SHIFT_COLS} FROM cash_shifts WHERE id = ?1");
    let shift: CashShiftDto = tx
        .query_row(&shift_sql, params![input.shift_id], row_to_shift)
        .map_err(|e| format!("SHIFT_NOT_FOUND: {e}"))?;
    if shift.closed_at.is_some() {
        return Err("SHIFT_ALREADY_CLOSED".into());
    }

    let closing_paise = input.closing_denominations.total_paise()?;
    let closing_json =
        serde_json::to_string(&input.closing_denominations).map_err(|e| e.to_string())?;
    let closed_at = now_iso();

    // Compute Z-report aggregates in [opened_at, closed_at).
    let z = compute_z_report(
        &tx,
        &shift.id,
        &shift.shop_id,
        &shift.opened_at,
        &closed_at,
    )
    .map_err(|e| e.to_string())?;

    // Variance = closing actual - expected.
    // expected = opening + cash sales - cash returns - cash refunds (we treat
    // refunded-via-cash as part of returns) - bank deposits (zero today).
    let expected = shift.opening_balance_paise + z.tender_breakdown.cash - z.total_returns_paise;
    let variance = closing_paise - expected;
    const NOISE: i64 = 50;
    const APPROVAL_THRESHOLD: i64 = 50_000;
    if variance.abs() > APPROVAL_THRESHOLD && input.variance_approved_by_user_id.is_none() {
        return Err(format!(
            "VARIANCE_REQUIRES_APPROVAL: {} paise (threshold {})",
            variance, APPROVAL_THRESHOLD
        ));
    }
    // noise floor: silently treat tiny mismatches as zero variance.
    let final_variance = if variance.abs() <= NOISE { 0 } else { variance };

    // Resolve closer actor (default to opener if not provided externally).
    let actor: String = tx
        .query_row(
            "SELECT id FROM users WHERE shop_id = ?1 AND role = 'owner' AND is_active = 1 \
             ORDER BY created_at LIMIT 1",
            params![shift.shop_id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| shift.opened_by_user_id.clone());

    let z_json = serde_json::to_string(&z).map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE cash_shifts SET \
            closed_at = ?1, \
            closed_by_user_id = ?2, \
            closing_balance_paise = ?3, \
            closing_denominations_json = ?4, \
            expected_closing_paise = ?5, \
            variance_paise = ?6, \
            variance_approved_by_user_id = ?7, \
            z_report_json = ?8 \
         WHERE id = ?9",
        params![
            closed_at,
            actor,
            closing_paise,
            closing_json,
            expected,
            final_variance,
            input.variance_approved_by_user_id,
            z_json,
            input.shift_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    // Re-read under the same lock — Mutex is not re-entrant.
    c.query_row(&shift_sql, params![input.shift_id], row_to_shift)
        .map_err(|e| e.to_string())
}

/// Returns a Z-report for the shift. If still open, computes against now;
/// if closed, returns the stored snapshot.
#[tauri::command]
pub fn cash_shift_z_report(
    shift_id: String,
    state: State<'_, DbState>,
) -> Result<ZReportDto, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let shift_sql = format!("SELECT {SHIFT_COLS} FROM cash_shifts WHERE id = ?1");
    let shift: CashShiftDto = c
        .query_row(&shift_sql, params![shift_id], row_to_shift)
        .map_err(|e| format!("SHIFT_NOT_FOUND: {e}"))?;

    if let Some(json) = shift.z_report_json.as_deref() {
        return serde_json::from_str(json).map_err(|e| e.to_string());
    }
    let end = now_iso();
    compute_z_report(&c, &shift.id, &shift.shop_id, &shift.opened_at, &end)
        .map_err(|e| e.to_string())
}

// ─── Z-report aggregator ────────────────────────────────────────────────

fn compute_z_report(
    c: &Connection,
    shift_id: &str,
    shop_id: &str,
    period_start: &str,
    period_end: &str,
) -> rusqlite::Result<ZReportDto> {
    // Bill totals (excluding voided).
    let (bill_count, total_sales, total_discounts): (i64, i64, i64) = c.query_row(
        "SELECT \
            COUNT(*), \
            COALESCE(SUM(grand_total_paise), 0), \
            COALESCE(SUM(total_discount_paise), 0) \
         FROM bills \
         WHERE shop_id = ?1 AND is_voided = 0 \
           AND billed_at >= ?2 AND billed_at < ?3",
        params![shop_id, period_start, period_end],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;

    // Returns (refund headers in window).
    let (return_count, total_returns): (i64, i64) = c
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(refund_total_paise), 0) \
             FROM return_headers \
             WHERE shop_id = ?1 AND created_at >= ?2 AND created_at < ?3",
            params![shop_id, period_start, period_end],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or((0, 0));

    // Tender breakdown: sum payments by mode for non-voided bills in window.
    let mut tb = TenderBreakdownDto {
        cash: 0,
        upi: 0,
        card: 0,
        cheque: 0,
        credit: 0,
    };
    {
        let mut stmt = c.prepare(
            "SELECT p.mode, COALESCE(SUM(p.amount_paise), 0) \
             FROM payments p \
             JOIN bills b ON b.id = p.bill_id \
             WHERE b.shop_id = ?1 AND b.is_voided = 0 \
               AND b.billed_at >= ?2 AND b.billed_at < ?3 \
             GROUP BY p.mode",
        )?;
        let rows = stmt.query_map(params![shop_id, period_start, period_end], |r| {
            let mode: String = r.get(0)?;
            let amt: i64 = r.get(1)?;
            Ok((mode, amt))
        })?;
        for row in rows {
            let (mode, amt) = row?;
            match mode.as_str() {
                "cash" => tb.cash += amt,
                "upi" => tb.upi += amt,
                "card" => tb.card += amt,
                "credit" => tb.credit += amt,
                "wallet" => tb.upi += amt, // map wallet → upi bucket for Z-report
                _ => {}
            }
        }
    }

    // GST by HSN — sum CGST+SGST+IGST per HSN code from bill_lines→products.
    let mut gst_by_hsn: BTreeMap<String, i64> = BTreeMap::new();
    {
        let mut stmt = c.prepare(
            "SELECT pr.hsn, COALESCE(SUM(bl.cgst_paise + bl.sgst_paise + bl.igst_paise + bl.cess_paise), 0) \
             FROM bill_lines bl \
             JOIN bills b ON b.id = bl.bill_id \
             JOIN products pr ON pr.id = bl.product_id \
             WHERE b.shop_id = ?1 AND b.is_voided = 0 \
               AND b.billed_at >= ?2 AND b.billed_at < ?3 \
             GROUP BY pr.hsn",
        )?;
        let rows = stmt.query_map(params![shop_id, period_start, period_end], |r| {
            let hsn: String = r.get(0)?;
            let amt: i64 = r.get(1)?;
            Ok((hsn, amt))
        })?;
        for row in rows {
            let (hsn, amt) = row?;
            gst_by_hsn.insert(hsn, amt);
        }
    }

    Ok(ZReportDto {
        shift_id: shift_id.to_string(),
        shop_id: shop_id.to_string(),
        period_start: period_start.to_string(),
        period_end: period_end.to_string(),
        bill_count,
        return_count,
        total_sales_paise: total_sales,
        total_returns_paise: total_returns,
        total_discounts_paise: total_discounts,
        gst_by_hsn,
        tender_breakdown: tb,
    })
}

fn now_iso() -> String {
    use chrono::Utc;
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn rand_id_hex(bytes: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn seed(c: &Connection) {
        c.execute_batch(
            "CREATE TABLE shops (id TEXT PRIMARY KEY, name TEXT, gstin TEXT, state_code TEXT, retail_license TEXT, address TEXT, created_at TEXT);
             CREATE TABLE users (id TEXT PRIMARY KEY, shop_id TEXT, name TEXT, role TEXT, pin_hash TEXT, is_active INTEGER, created_at TEXT, mfa_enrolled INTEGER DEFAULT 0, totp_secret_encrypted TEXT, webauthn_credential_id TEXT);
             CREATE TABLE customers (id TEXT PRIMARY KEY, shop_id TEXT);
             CREATE TABLE bills (id TEXT PRIMARY KEY, shop_id TEXT, billed_at TEXT, is_voided INTEGER DEFAULT 0, grand_total_paise INTEGER, total_discount_paise INTEGER DEFAULT 0);
             CREATE TABLE bill_lines (id TEXT PRIMARY KEY, bill_id TEXT, product_id TEXT, cgst_paise INTEGER DEFAULT 0, sgst_paise INTEGER DEFAULT 0, igst_paise INTEGER DEFAULT 0, cess_paise INTEGER DEFAULT 0);
             CREATE TABLE products (id TEXT PRIMARY KEY, hsn TEXT);
             CREATE TABLE payments (id TEXT PRIMARY KEY, bill_id TEXT, mode TEXT, amount_paise INTEGER, ref_no TEXT, created_at TEXT);
             CREATE TABLE return_headers (id TEXT PRIMARY KEY, shop_id TEXT, refund_total_paise INTEGER, created_at TEXT);
             CREATE TABLE cash_shifts (
               id TEXT PRIMARY KEY, shop_id TEXT, opened_by_user_id TEXT, opened_at TEXT,
               opening_balance_paise INTEGER, opening_denominations_json TEXT,
               closed_at TEXT, closed_by_user_id TEXT, closing_balance_paise INTEGER,
               closing_denominations_json TEXT, expected_closing_paise INTEGER,
               variance_paise INTEGER, variance_approved_by_user_id TEXT, z_report_json TEXT
             );
             INSERT INTO shops (id, name, gstin, state_code, retail_license, address, created_at)
               VALUES ('shop1', 'Jagannath', '27AAAAA0000A1Z5', '27', 'MH-DL-001', 'Kalyan', '2026-01-01');
             INSERT INTO users (id, shop_id, name, role, pin_hash, is_active, created_at)
               VALUES ('u1', 'shop1', 'Sourav', 'owner', 'h', 1, '2026-01-01');"
        ).unwrap();
    }

    #[test]
    fn open_shift_inserts_row() {
        let mut c = Connection::open_in_memory().unwrap();
        seed(&c);
        let denoms = DenominationCountDto { d2000: 0, d500: 1, d200: 0, d100: 0, d50: 0, d20: 0, d10: 0, c5: 0, c2: 0, c1: 0 };
        let json = serde_json::to_string(&denoms).unwrap();
        let id = "shift_test1";
        c.execute(
            "INSERT INTO cash_shifts (id, shop_id, opened_by_user_id, opened_at, opening_balance_paise, opening_denominations_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, "shop1", "u1", "2026-04-29T10:00:00Z", 50000, json],
        ).unwrap();
        let shift = find_open_shift(&c, "shop1").unwrap();
        assert!(shift.is_some());
        assert_eq!(shift.unwrap().opening_balance_paise, 50000);
    }

    #[test]
    fn z_report_aggregates_bills_and_payments() {
        let c = Connection::open_in_memory().unwrap();
        seed(&c);
        c.execute_batch(
            "INSERT INTO bills (id, shop_id, billed_at, is_voided, grand_total_paise, total_discount_paise)
               VALUES ('b1', 'shop1', '2026-04-29T11:00:00Z', 0, 10000, 0),
                      ('b2', 'shop1', '2026-04-29T12:00:00Z', 0, 20000, 500);
             INSERT INTO payments (id, bill_id, mode, amount_paise, ref_no, created_at)
               VALUES ('p1', 'b1', 'cash', 10000, NULL, '2026-04-29T11:00:00Z'),
                      ('p2', 'b2', 'upi', 20000, 'RRN', '2026-04-29T12:00:00Z');"
        ).unwrap();
        let z = compute_z_report(&c, "shift_test", "shop1", "2026-04-29T10:00:00Z", "2026-04-29T13:00:00Z").unwrap();
        assert_eq!(z.bill_count, 2);
        assert_eq!(z.total_sales_paise, 30000);
        assert_eq!(z.total_discounts_paise, 500);
        assert_eq!(z.tender_breakdown.cash, 10000);
        assert_eq!(z.tender_breakdown.upi, 20000);
    }

    #[test]
    fn denomination_total_paise_correct() {
        let d = DenominationCountDto {
            d2000: 1, d500: 2, d200: 0, d100: 5, d50: 0, d20: 0, d10: 0, c5: 0, c2: 0, c1: 0,
        };
        // 2000 + 1000 + 500 = 3500 rupees = 350_000 paise
        assert_eq!(d.total_paise().unwrap(), 350_000);
    }

    #[test]
    fn negative_denomination_rejected() {
        let d = DenominationCountDto {
            d2000: -1, d500: 0, d200: 0, d100: 0, d50: 0, d20: 0, d10: 0, c5: 0, c2: 0, c1: 0,
        };
        assert!(d.total_paise().is_err());
    }
}
