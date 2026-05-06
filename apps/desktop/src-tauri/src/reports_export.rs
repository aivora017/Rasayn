// reports_export.rs — Real GSTR-3B / GSTR-9 payload (S26.H part 2).
//
// Replaces ReportsExportPanel.tsx's SAMPLE_BILLS / SAMPLE_PURCHASES with
// real GSTR-3B summary buckets pulled from the live ledger. GSTR-3B is
// the monthly self-assessed summary (3.1 outward, 3.2 inter-state, 4 ITC,
// 5 nil/exempt); we ship the BIG buckets only — real reconciliation against
// GSTR-2B is out of scope for this sprint.
//
// Period format: YYYYMM, e.g. "202604" for April 2026.
//
// All amounts in paise (i64). The TS-side @pharmacare/gstr1 package converts
// to rupees + 2-decimal strings for the GSTN form upload format.

use crate::db::DbState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct OutwardSupplyBucket {
    pub taxable_value_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub cess_paise: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct InwardItcBucket {
    pub taxable_value_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub cess_paise: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Gstr3bPayload {
    pub period_yyyymm: String,
    pub shop_id: String,
    pub gstin: String,
    /// Section 3.1(a) — taxable outward supplies (other than zero-rated/nil).
    pub outward_taxable_supplies: OutwardSupplyBucket,
    /// Section 3.1(c) — nil-rated, exempted supplies.
    pub outward_nil_rated_paise: i64,
    /// Section 4(A)(5) — all other ITC (composite bucket of GRN totals).
    pub itc_all_other: InwardItcBucket,
    /// Section 4(B) — ITC reversed. We ship 0 — the owner edits before file.
    pub itc_reversed_paise: i64,
    /// Section 5 — exempt purchases (composite of GRN tax-free lines). 0 here;
    /// the owner can enter manually before filing.
    pub exempt_purchases_paise: i64,
    /// Bill counts — useful for the owner to sanity-check.
    pub bill_count: i64,
    pub voided_bill_count: i64,
}

fn validate_period(p: &str) -> Result<(i64, i64), String> {
    if p.len() != 6 || !p.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("INVALID_PERIOD:{}", p));
    }
    let yyyy: i64 = p[0..4].parse().map_err(|_| "INVALID_PERIOD")?;
    let mm: i64 = p[4..6].parse().map_err(|_| "INVALID_PERIOD")?;
    if !(1..=12).contains(&mm) {
        return Err(format!("INVALID_PERIOD_MONTH:{}", mm));
    }
    if !(2000..=2100).contains(&yyyy) {
        return Err(format!("INVALID_PERIOD_YEAR:{}", yyyy));
    }
    Ok((yyyy, mm))
}

#[tauri::command]
pub fn generate_gstr3b_payload(
    db: State<'_, DbState>,
    period_yyyymm: String,
    shop_id: String,
) -> Result<Gstr3bPayload, String> {
    let (_yyyy, _mm) = validate_period(&period_yyyymm)?;
    let yyyy = &period_yyyymm[0..4];
    let mm = &period_yyyymm[4..6];
    // billed_at is ISO8601 like 2026-04-30T12:34:56Z. substr(.,1,7) =
    // 'YYYY-MM' which we compare equal.
    let yyyy_mm = format!("{}-{}", yyyy, mm);

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Shop GSTIN
    let gstin: String = conn
        .query_row(
            "SELECT gstin FROM shops WHERE id = ?1",
            params![shop_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("SHOP_NOT_FOUND:{}", e))?;

    // Bill counts (incl. voided for sanity column)
    let bill_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM bills
             WHERE shop_id = ?1 AND substr(billed_at, 1, 7) = ?2 AND is_voided = 0",
            params![shop_id, yyyy_mm],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let voided_bill_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM bills
             WHERE shop_id = ?1 AND substr(billed_at, 1, 7) = ?2 AND is_voided = 1",
            params![shop_id, yyyy_mm],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    // 3.1(a) Outward taxable supplies — sum across non-voided, non-exempt bills.
    // Voided bills are excluded; nil-rated are reported separately at 3.1(c).
    let outward: (i64, i64, i64, i64, i64) = conn
        .query_row(
            "SELECT
                COALESCE(SUM(subtotal_paise - total_discount_paise), 0),
                COALESCE(SUM(total_cgst_paise), 0),
                COALESCE(SUM(total_sgst_paise), 0),
                COALESCE(SUM(total_igst_paise), 0),
                COALESCE(SUM(total_cess_paise), 0)
             FROM bills
             WHERE shop_id = ?1
               AND substr(billed_at, 1, 7) = ?2
               AND is_voided = 0
               AND gst_treatment IN ('intra_state', 'inter_state')",
            params![shop_id, yyyy_mm],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    // 3.1(c) Nil-rated outward — taxable_value where gst_treatment is exempt/nil.
    let nil_rated_paise: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(subtotal_paise - total_discount_paise), 0)
             FROM bills
             WHERE shop_id = ?1
               AND substr(billed_at, 1, 7) = ?2
               AND is_voided = 0
               AND gst_treatment IN ('exempt', 'nil_rated')",
            params![shop_id, yyyy_mm],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    // 4(A)(5) ITC all-other — composite of GRN totals for the period.
    // We do NOT split CGST/SGST/IGST at the GRN level (the schema does not
    // store it); the owner edits the breakdown before filing. We surface
    // total_cost_paise in the taxable_value bucket and zero the tax buckets,
    // signalling 'edit before file'.
    let itc_total: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_cost_paise), 0)
             FROM grns
             WHERE shop_id = ?1
               AND substr(invoice_date, 1, 7) = ?2
               AND status = 'posted'",
            params![shop_id, yyyy_mm],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(Gstr3bPayload {
        period_yyyymm,
        shop_id,
        gstin,
        outward_taxable_supplies: OutwardSupplyBucket {
            taxable_value_paise: outward.0,
            cgst_paise: outward.1,
            sgst_paise: outward.2,
            igst_paise: outward.3,
            cess_paise: outward.4,
        },
        outward_nil_rated_paise: nil_rated_paise,
        itc_all_other: InwardItcBucket {
            taxable_value_paise: itc_total,
            cgst_paise: 0,
            sgst_paise: 0,
            igst_paise: 0,
            cess_paise: 0,
        },
        itc_reversed_paise: 0,
        exempt_purchases_paise: 0,
        bill_count,
        voided_bill_count,
    })
}
