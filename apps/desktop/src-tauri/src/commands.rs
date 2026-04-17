use crate::db::DbState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize)]
pub struct Health {
    pub ok: bool,
    pub version: String,
}

#[tauri::command]
pub fn health_check() -> Health {
    Health {
        ok: true,
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[tauri::command]
pub fn db_version(state: State<DbState>) -> Result<i64, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.query_row(
        "SELECT COALESCE(MAX(version),0) FROM _migrations",
        [],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

// --- Product search -------------------------------------------------------

#[derive(Serialize)]
pub struct ProductHit {
    pub id: String,
    pub name: String,
    #[serde(rename = "genericName")]
    pub generic_name: Option<String>,
    pub manufacturer: String,
    #[serde(rename = "gstRate")]
    pub gst_rate: i64,
    pub schedule: String,
    #[serde(rename = "mrpPaise")]
    pub mrp_paise: i64,
}

fn to_fts_query(q: &str) -> String {
    q.split_whitespace()
        .filter(|t| !t.is_empty())
        .map(|t| format!("{}*", t.replace(['"', '\''], " ")))
        .collect::<Vec<_>>()
        .join(" ")
}

#[tauri::command]
pub fn search_products(
    q: String,
    limit: Option<i64>,
    state: State<DbState>,
) -> Result<Vec<ProductHit>, String> {
    let clean = to_fts_query(&q);
    if clean.is_empty() {
        return Ok(vec![]);
    }
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c.prepare(
        "SELECT p.id, p.name, p.generic_name, p.manufacturer, p.gst_rate, p.schedule, p.mrp_paise
         FROM products_fts
         JOIN products p ON p.id = products_fts.id
         WHERE products_fts MATCH ?1 AND p.is_active = 1
         ORDER BY bm25(products_fts)
         LIMIT ?2"
    ).map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map(params![clean, limit.unwrap_or(20)], |r| {
            Ok(ProductHit {
                id: r.get(0)?,
                name: r.get(1)?,
                generic_name: r.get(2)?,
                manufacturer: r.get(3)?,
                gst_rate: r.get(4)?,
                schedule: r.get(5)?,
                mrp_paise: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    iter.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

// --- FEFO batch picker ----------------------------------------------------

#[derive(Serialize)]
pub struct BatchPick {
    pub id: String,
    #[serde(rename = "batchNo")]
    pub batch_no: String,
    #[serde(rename = "expiryDate")]
    pub expiry_date: String,
    #[serde(rename = "qtyOnHand")]
    pub qty_on_hand: f64,
    #[serde(rename = "mrpPaise")]
    pub mrp_paise: i64,
}

#[tauri::command]
pub fn pick_fefo_batch(
    product_id: String,
    state: State<DbState>,
) -> Result<Option<BatchPick>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let row = c.query_row(
        "SELECT id, batch_no, expiry_date, qty_on_hand, mrp_paise
         FROM v_fefo_batches WHERE product_id = ?1 LIMIT 1",
        params![product_id],
        |r| {
            Ok(BatchPick {
                id: r.get(0)?,
                batch_no: r.get(1)?,
                expiry_date: r.get(2)?,
                qty_on_hand: r.get(3)?,
                mrp_paise: r.get(4)?,
            })
        },
    );
    match row {
        Ok(b) => Ok(Some(b)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn list_fefo_candidates(
    product_id: String,
    state: State<DbState>,
) -> Result<Vec<BatchPick>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c
        .prepare(
            "SELECT id, batch_no, expiry_date, qty_on_hand, mrp_paise
               FROM v_fefo_batches WHERE product_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map(params![product_id], |r| {
            Ok(BatchPick {
                id: r.get(0)?,
                batch_no: r.get(1)?,
                expiry_date: r.get(2)?,
                qty_on_hand: r.get(3)?,
                mrp_paise: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    iter.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

// --- Save bill ------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBillInput {
    pub shop_id: String,
    pub bill_no: String,
    pub cashier_id: String,
    pub customer_id: Option<String>,
    pub doctor_id: Option<String>,
    pub rx_id: Option<String>,
    pub payment_mode: String,
    pub customer_state_code: Option<String>,
    pub lines: Vec<SaveBillLine>,
    /// A8 (ADR 0012) split-tender rows. Optional for backward-compat.
    /// None or empty → synthesised as a single tender for the full grand_total
    /// in `payment_mode`. Sum must equal grand_total ±50 paise (TENDER_TOLERANCE).
    #[serde(default)]
    pub tenders: Option<Vec<Tender>>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Tender {
    pub mode: String,
    pub amount_paise: i64,
    #[serde(default)]
    pub ref_no: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBillLine {
    pub product_id: String,
    pub batch_id: String,
    pub mrp_paise: i64,
    pub qty: f64,
    pub gst_rate: i64,
    pub discount_pct: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBillResult {
    pub bill_id: String,
    pub grand_total_paise: i64,
    pub lines_inserted: usize,
}

fn compute_line(
    mrp: i64,
    qty: f64,
    gst: i64,
    disc_pct: f64,
    inter: bool,
) -> (i64, i64, i64, i64, i64) {
    let gross = (mrp as f64 * qty).round() as i64;
    let discount = (gross as f64 * disc_pct / 100.0).round() as i64;
    let net = gross - discount;
    let taxable = if gst == 0 {
        net
    } else {
        (net as f64 * 100.0 / (100.0 + gst as f64)).round() as i64
    };
    let tax = net - taxable;
    if inter {
        (gross, discount, taxable, 0, tax)
    } else {
        let half = (tax as f64 / 2.0).floor() as i64;
        (gross, discount, taxable, half, tax - half)
    }
}

#[tauri::command]
pub fn save_bill(
    bill_id: String,
    input: SaveBillInput,
    state: State<DbState>,
) -> Result<SaveBillResult, String> {
    let mut c = state.0.lock().map_err(|e| e.to_string())?;
    let shop_state: String = c
        .query_row(
            "SELECT state_code FROM shops WHERE id = ?1",
            params![input.shop_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let inter = input
        .customer_state_code
        .as_deref()
        .is_some_and(|s| s != shop_state);
    let treatment = if inter { "inter_state" } else { "intra_state" };

    // A6 · NPPA/DPCO re-check (ADR 0010 §1). Enforced at save BEFORE any
    // transaction opens; UI-level validation is not trusted. Ceiling lives on
    // products.nppa_max_mrp_paise (NULL = uncapped). Breach aborts with a
    // reason code the UI can switch on.
    for l in input.lines.iter() {
        let cap: Option<i64> = c
            .query_row(
                "SELECT nppa_max_mrp_paise FROM products WHERE id = ?1",
                params![l.product_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if let Some(cap_v) = cap {
            if l.mrp_paise > cap_v {
                return Err(format!(
                    "NPPA_CAP_EXCEEDED:{}:mrp={}:cap={}",
                    l.product_id, l.mrp_paise, cap_v
                ));
            }
        }
    }

    // A7 · Rx-required gate (ADR 0011). Schedule H/H1/X lines require
    // bills.rx_id to be set. Server-side authority: the UI opens RxCaptureModal
    // on F8 when any H/H1/X line is present and rx_id is null, but defense in
    // depth requires this check here and a block trigger in migration 0012.
    // Hard Rule 9 — D&C Act 1940 s.18 prohibits sale of Schedule H without
    // a valid Rx, and Rules 1945 r.65 mandates 2-year retention.
    if input.rx_id.is_none() {
        for l in input.lines.iter() {
            let schedule: String = c
                .query_row(
                    "SELECT schedule FROM products WHERE id = ?1",
                    params![l.product_id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if matches!(schedule.as_str(), "H" | "H1" | "X" | "NDPS") {
                return Err(format!(
                    "RX_REQUIRED:product_id={}:schedule={}",
                    l.product_id, schedule
                ));
            }
        }
    }

    // A13 · Expiry guard (ADR 0013). Defensive re-check: batch's expiry_date
    // is trusted from DB, not from the input. Hard Rule 9 — expired sale is a
    // criminal offence under D&C Act s.27; never trust the client.
    //   * days_to_expiry <= 0  -> EXPIRED_BATCH (no override possible).
    //   * 0 < days <= 30       -> requires a fresh expiry_override_audit row
    //                             keyed by (batch_id, cashier_id) in the last
    //                             10 minutes.
    //   * days > 30            -> pass.
    for l in input.lines.iter() {
        let row: Option<(String, String)> = c
            .query_row(
                "SELECT expiry_date,
                        CAST((julianday(expiry_date) - julianday('now')) AS TEXT) AS days
                   FROM batches WHERE id = ?1",
                params![l.batch_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .ok();
        let Some((expiry_date, days_s)) = row else {
            return Err(format!("BATCH_NOT_FOUND:{}", l.batch_id));
        };
        let days_f: f64 = days_s.parse().unwrap_or(f64::NAN);
        let days: i64 = days_f.floor() as i64;
        if days <= 0 {
            return Err(format!(
                "EXPIRED_BATCH:batch_id={}:expiry={}:days_past={}",
                l.batch_id, expiry_date, -days
            ));
        }
        if days <= 30 {
            let has_override: i64 = c
                .query_row(
                    "SELECT COUNT(*) FROM expiry_override_audit
                      WHERE batch_id = ?1
                        AND actor_user_id = ?2
                        AND created_at > datetime('now','-10 minutes')",
                    params![l.batch_id, input.cashier_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if has_override == 0 {
                return Err(format!(
                    "NEAR_EXPIRY_NO_OVERRIDE:batch_id={}:expiry={}:days={}",
                    l.batch_id, expiry_date, days
                ));
            }
        }
    }

    let tx = c.transaction().map_err(|e| e.to_string())?;
    let mut subtotal = 0i64;
    let mut cgst = 0i64;
    let mut sgst = 0i64;
    let mut igst = 0i64;
    // (batch_id, line, disc_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, line_total_paise)
    type BillLineRow<'a> = (String, &'a SaveBillLine, i64, i64, i64, i64, i64, i64);
    let mut lines_out: Vec<BillLineRow> = vec![];
    for (i, l) in input.lines.iter().enumerate() {
        let (_g, disc, taxable, c_half, s_or_i) = compute_line(
            l.mrp_paise,
            l.qty,
            l.gst_rate,
            l.discount_pct.unwrap_or(0.0),
            inter,
        );
        let (cg, sg, ig) = if inter {
            (0, 0, s_or_i)
        } else {
            (c_half, s_or_i, 0)
        };
        subtotal += taxable;
        cgst += cg;
        sgst += sg;
        igst += ig;
        lines_out.push((
            format!("{}_l{}", bill_id, i + 1),
            l,
            disc,
            taxable,
            cg,
            sg,
            ig,
            taxable + cg + sg + ig,
        ));
    }
    let pre = subtotal + cgst + sgst + igst;
    let grand = ((pre as f64 / 100.0).round() as i64) * 100;
    let round_off = grand - pre;

    // A8 (ADR 0012) · Resolve tenders + validate sum within ±50 paise tolerance.
    const TENDER_TOLERANCE_PAISE: i64 = 50;
    let resolved_tenders: Vec<Tender> = match &input.tenders {
        Some(v) if !v.is_empty() => v.clone(),
        _ => {
            let fallback_mode = if input.payment_mode == "split" {
                "cash".to_string()
            } else {
                input.payment_mode.clone()
            };
            vec![Tender {
                mode: fallback_mode,
                amount_paise: grand,
                ref_no: None,
            }]
        }
    };
    let tender_sum: i64 = resolved_tenders.iter().map(|t| t.amount_paise).sum();
    if (tender_sum - grand).abs() > TENDER_TOLERANCE_PAISE {
        return Err(format!(
            "TENDER_MISMATCH:sum={}:grand={}:diff={}",
            tender_sum,
            grand,
            tender_sum - grand
        ));
    }
    let resolved_payment_mode: String = if resolved_tenders.len() > 1 {
        "split".to_string()
    } else {
        resolved_tenders[0].mode.clone()
    };

    tx.execute("INSERT INTO bills (id, shop_id, bill_no, customer_id, doctor_id, rx_id, cashier_id, gst_treatment,
                 subtotal_paise, total_discount_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
                 total_cess_paise, round_off_paise, grand_total_paise, payment_mode)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
        params![bill_id, input.shop_id, input.bill_no, input.customer_id, input.doctor_id, input.rx_id,
                input.cashier_id, treatment, subtotal, 0i64, cgst, sgst, igst, 0i64, round_off, grand,
                resolved_payment_mode]).map_err(|e| e.to_string())?;
    for (lid, l, disc, taxable, cg, sg, ig, total) in &lines_out {
        tx.execute("INSERT INTO bill_lines (id,bill_id,product_id,batch_id,qty,mrp_paise,discount_pct,discount_paise,
                    taxable_value_paise,gst_rate,cgst_paise,sgst_paise,igst_paise,cess_paise,line_total_paise)
                    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            params![lid, bill_id, l.product_id, l.batch_id, l.qty, l.mrp_paise,
                    l.discount_pct.unwrap_or(0.0), disc, taxable, l.gst_rate, cg, sg, ig, 0i64, total])
            .map_err(|e| e.to_string())?;
        // A13 · Stamp the bill_line_id onto the override audit row (if any)
        // that allowed this line through. Safe no-op when no override used.
        tx.execute(
            "UPDATE expiry_override_audit
                SET bill_line_id = ?1, bill_no = ?2
              WHERE batch_id = ?3
                AND actor_user_id = ?4
                AND bill_line_id IS NULL
                AND created_at > datetime('now','-10 minutes')",
            params![lid, input.bill_no, l.batch_id, input.cashier_id],
        )
        .map_err(|e| e.to_string())?;
    }
    for (pi, t) in resolved_tenders.iter().enumerate() {
        tx.execute(
            "INSERT INTO payments (id, bill_id, mode, amount_paise, ref_no) VALUES (?1,?2,?3,?4,?5)",
            params![format!("{}_p{}", bill_id, pi + 1), bill_id, t.mode, t.amount_paise, t.ref_no],
        ).map_err(|e| e.to_string())?;
    }

    tx.execute("INSERT INTO audit_log (actor_id, entity, entity_id, action, payload) VALUES (?1,'bill',?2,'create',?3)",
        params![input.cashier_id, bill_id,
            serde_json::json!({
                "billNo": input.bill_no,
                "total": grand,
                "tenderCount": resolved_tenders.len(),
                "paymentMode": resolved_payment_mode,
            }).to_string()])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(SaveBillResult {
        bill_id,
        grand_total_paise: grand,
        lines_inserted: lines_out.len(),
    })
}

// --- Inventory snapshot ---------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockRow {
    pub product_id: String,
    pub name: String,
    pub generic_name: Option<String>,
    pub manufacturer: String,
    pub schedule: String,
    pub gst_rate: i64,
    pub mrp_paise: i64,
    pub total_qty: f64,
    pub batch_count: i64,
    pub nearest_expiry: Option<String>,
    pub days_to_expiry: Option<i64>,
    pub has_expired_stock: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListStockOpts {
    pub q: Option<String>,
    pub low_stock_under: Option<f64>,
    pub near_expiry_days: Option<i64>,
    pub limit: Option<i64>,
}

#[tauri::command]
pub fn list_stock(
    opts: Option<ListStockOpts>,
    state: State<DbState>,
) -> Result<Vec<StockRow>, String> {
    let o = opts.unwrap_or(ListStockOpts {
        q: None,
        low_stock_under: None,
        near_expiry_days: None,
        limit: None,
    });
    let limit = o.limit.unwrap_or(200);

    let mut sql = String::from(
        r#"
        WITH live AS (
          SELECT product_id, SUM(qty_on_hand) AS total_qty, COUNT(*) AS batch_count, MIN(expiry_date) AS nearest_expiry
          FROM batches
          WHERE qty_on_hand > 0 AND expiry_date >= strftime('%Y-%m-%d','now')
          GROUP BY product_id
        ),
        dead AS (
          SELECT product_id, SUM(qty_on_hand) AS expired_qty
          FROM batches
          WHERE qty_on_hand > 0 AND expiry_date <  strftime('%Y-%m-%d','now')
          GROUP BY product_id
        )
        SELECT p.id, p.name, p.generic_name, p.manufacturer, p.schedule, p.gst_rate, p.mrp_paise,
               COALESCE(live.total_qty, 0)   AS total_qty,
               COALESCE(live.batch_count, 0) AS batch_count,
               live.nearest_expiry,
               CASE WHEN live.nearest_expiry IS NULL THEN NULL
                    ELSE CAST(julianday(live.nearest_expiry) - julianday(strftime('%Y-%m-%d','now')) AS INTEGER)
               END AS days_to_expiry,
               COALESCE(dead.expired_qty, 0) AS expired_qty
        FROM products p
        LEFT JOIN live ON live.product_id = p.id
        LEFT JOIN dead ON dead.product_id = p.id
        WHERE p.is_active = 1
    "#,
    );

    let mut bind: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(q) = &o.q {
        sql.push_str(" AND (LOWER(p.name) LIKE ?1 OR LOWER(COALESCE(p.generic_name,'')) LIKE ?1)");
        bind.push(Box::new(format!("%{}%", q.to_lowercase())));
    }
    if let Some(low) = o.low_stock_under {
        sql.push_str(&format!(
            " AND COALESCE(live.total_qty,0) <= ?{}",
            bind.len() + 1
        ));
        bind.push(Box::new(low));
    }
    if let Some(near) = o.near_expiry_days {
        sql.push_str(&format!(
            " AND (live.nearest_expiry IS NOT NULL AND julianday(live.nearest_expiry) - julianday(strftime('%Y-%m-%d','now')) <= ?{})",
            bind.len() + 1));
        bind.push(Box::new(near));
    }
    sql.push_str(
        " ORDER BY (COALESCE(live.total_qty,0) = 0) DESC, days_to_expiry ASC, p.name ASC LIMIT ?",
    );
    bind.push(Box::new(limit));
    // fix up the final ? to numbered
    let final_idx = bind.len();
    let sql = sql.replacen(" LIMIT ?", &format!(" LIMIT ?{}", final_idx), 1);

    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c.prepare(&sql).map_err(|e| e.to_string())?;
    let params_refs: Vec<&dyn rusqlite::ToSql> = bind.iter().map(|b| b.as_ref()).collect();
    let iter = stmt
        .query_map(params_refs.as_slice(), |r| {
            Ok(StockRow {
                product_id: r.get(0)?,
                name: r.get(1)?,
                generic_name: r.get(2)?,
                manufacturer: r.get(3)?,
                schedule: r.get(4)?,
                gst_rate: r.get(5)?,
                mrp_paise: r.get(6)?,
                total_qty: r.get(7)?,
                batch_count: r.get(8)?,
                nearest_expiry: r.get(9)?,
                days_to_expiry: r.get(10)?,
                has_expired_stock: r.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    iter.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

// --- save_grn -------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGrnLine {
    pub product_id: String,
    pub batch_no: String,
    pub mfg_date: String,
    pub expiry_date: String,
    pub qty: i64,
    pub purchase_price_paise: i64,
    pub mrp_paise: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGrnInput {
    pub shop_id: Option<String>,
    pub supplier_id: String,
    pub invoice_no: String,
    pub invoice_date: String,
    pub source: Option<String>,
    pub lines: Vec<SaveGrnLine>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGrnResult {
    pub grn_id: String,
    pub lines_inserted: i64,
    pub batch_ids: Vec<String>,
}

fn batch_id_for(grn_id: &str, idx: usize) -> String {
    let short: String = grn_id
        .strip_prefix("grn_")
        .unwrap_or(grn_id)
        .chars()
        .take(16)
        .collect();
    format!("b_{}_{:03}", short, idx)
}

#[tauri::command]
pub fn save_grn(
    grn_id: String,
    input: SaveGrnInput,
    state: State<DbState>,
) -> Result<SaveGrnResult, String> {
    if grn_id.trim().is_empty() {
        return Err("grnId required".into());
    }
    if input.supplier_id.trim().is_empty() {
        return Err("supplierId required".into());
    }
    if input.invoice_no.trim().is_empty() {
        return Err("invoiceNo required".into());
    }
    if input.lines.is_empty() {
        return Err("at least one line required".into());
    }
    if !regex_date(&input.invoice_date) {
        return Err("invoiceDate must be YYYY-MM-DD".into());
    }

    let mut c = state.0.lock().map_err(|e| e.to_string())?;
    let shop_id: String = match &input.shop_id {
        Some(s) if !s.is_empty() => s.clone(),
        _ => c
            .query_row("SELECT id FROM shops LIMIT 1", [], |r| {
                r.get::<_, String>(0)
            })
            .map_err(|_| "shopId required (no shop row exists)".to_string())?,
    };
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let mut batch_ids: Vec<String> = Vec::with_capacity(input.lines.len());

    // Pre-validate all lines and compute total cost before inserting header.
    let mut total_cost: i64 = 0;
    for (i, ln) in input.lines.iter().enumerate() {
        if ln.qty <= 0 {
            return Err(format!("line {}: qty must be > 0", i));
        }
        if ln.purchase_price_paise < 0 {
            return Err(format!("line {}: purchasePricePaise must be >= 0", i));
        }
        if ln.mrp_paise <= 0 {
            return Err(format!("line {}: mrpPaise must be > 0", i));
        }
        if ln.expiry_date < ln.mfg_date {
            return Err(format!("line {}: expiryDate must be >= mfgDate", i));
        }
        total_cost += ln.qty * ln.purchase_price_paise;
    }
    let src = input.source.clone().unwrap_or_else(|| "manual".to_string());
    tx.execute(
        "INSERT INTO grns (id, shop_id, supplier_id, invoice_no, invoice_date,
                           total_cost_paise, line_count, status, source)
         VALUES (?1,?2,?3,?4,?5,?6,?7,'posted',?8)",
        params![
            grn_id,
            shop_id,
            input.supplier_id,
            input.invoice_no,
            input.invoice_date,
            total_cost,
            input.lines.len() as i64,
            src
        ],
    )
    .map_err(|e| e.to_string())?;

    for (i, ln) in input.lines.iter().enumerate() {
        let id = batch_id_for(&grn_id, i + 1);
        tx.execute(
            "INSERT INTO batches (id, product_id, batch_no, mfg_date, expiry_date,
                                  qty_on_hand, purchase_price_paise, mrp_paise,
                                  supplier_id, grn_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                id,
                ln.product_id,
                ln.batch_no,
                ln.mfg_date,
                ln.expiry_date,
                ln.qty,
                ln.purchase_price_paise,
                ln.mrp_paise,
                input.supplier_id,
                grn_id
            ],
        )
        .map_err(|e| e.to_string())?;
        batch_ids.push(id);
    }

    tx.commit().map_err(|e| e.to_string())?;
    let lines_inserted = input.lines.len() as i64;
    Ok(SaveGrnResult {
        grn_id,
        lines_inserted,
        batch_ids,
    })
}

// --- Reports --------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayBookRow {
    pub bill_id: String,
    pub bill_no: String,
    pub billed_at: String,
    pub payment_mode: String,
    pub grand_total_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub is_voided: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayBookSummary {
    pub bill_count: i64,
    pub gross_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub by_payment: std::collections::BTreeMap<String, i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayBook {
    pub date: String,
    pub rows: Vec<DayBookRow>,
    pub summary: DayBookSummary,
}

#[tauri::command]
pub fn day_book(shop_id: String, date: String, state: State<DbState>) -> Result<DayBook, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c
        .prepare(
            "SELECT id, bill_no, billed_at, payment_mode,
                grand_total_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, is_voided
         FROM bills WHERE shop_id = ?1 AND substr(billed_at,1,10) = ?2
         ORDER BY billed_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<DayBookRow> = stmt
        .query_map(params![shop_id, date], |r| {
            Ok(DayBookRow {
                bill_id: r.get(0)?,
                bill_no: r.get(1)?,
                billed_at: r.get(2)?,
                payment_mode: r.get(3)?,
                grand_total_paise: r.get(4)?,
                cgst_paise: r.get(5)?,
                sgst_paise: r.get(6)?,
                igst_paise: r.get(7)?,
                is_voided: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let mut by_payment: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
    let mut gross = 0i64;
    let mut cgst = 0i64;
    let mut sgst = 0i64;
    let mut igst = 0i64;
    let mut cnt = 0i64;
    for r in rows.iter().filter(|r| r.is_voided == 0) {
        gross += r.grand_total_paise;
        cgst += r.cgst_paise;
        sgst += r.sgst_paise;
        igst += r.igst_paise;
        *by_payment.entry(r.payment_mode.clone()).or_insert(0) += r.grand_total_paise;
        cnt += 1;
    }
    Ok(DayBook {
        date,
        rows,
        summary: DayBookSummary {
            bill_count: cnt,
            gross_paise: gross,
            cgst_paise: cgst,
            sgst_paise: sgst,
            igst_paise: igst,
            by_payment,
        },
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GstrBucket {
    pub gst_rate: i64,
    pub taxable_value_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub line_count: i64,
}

#[tauri::command]
pub fn gstr1_summary(
    shop_id: String,
    from: String,
    to: String,
    state: State<DbState>,
) -> Result<Vec<GstrBucket>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c.prepare(
        "SELECT bl.gst_rate, COALESCE(SUM(bl.taxable_value_paise),0), COALESCE(SUM(bl.cgst_paise),0),
                COALESCE(SUM(bl.sgst_paise),0), COALESCE(SUM(bl.igst_paise),0), COUNT(*)
         FROM bill_lines bl JOIN bills b ON b.id = bl.bill_id
         WHERE b.shop_id = ?1 AND b.is_voided = 0
           AND substr(b.billed_at,1,10) BETWEEN ?2 AND ?3
         GROUP BY bl.gst_rate ORDER BY bl.gst_rate ASC"
    ).map_err(|e| e.to_string())?;
    let out: Vec<_> = stmt
        .query_map(params![shop_id, from, to], |r| {
            Ok(GstrBucket {
                gst_rate: r.get(0)?,
                taxable_value_paise: r.get(1)?,
                cgst_paise: r.get(2)?,
                sgst_paise: r.get(3)?,
                igst_paise: r.get(4)?,
                line_count: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopMoverRow {
    pub product_id: String,
    pub name: String,
    pub qty_sold: f64,
    pub revenue_paise: i64,
    pub bill_count: i64,
}

#[tauri::command]
pub fn top_movers(
    shop_id: String,
    from: String,
    to: String,
    limit: Option<i64>,
    state: State<DbState>,
) -> Result<Vec<TopMoverRow>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c
        .prepare(
            "SELECT p.id, p.name, COALESCE(SUM(bl.qty),0), COALESCE(SUM(bl.line_total_paise),0),
                COUNT(DISTINCT bl.bill_id)
         FROM bill_lines bl
         JOIN bills b ON b.id = bl.bill_id
         JOIN products p ON p.id = bl.product_id
         WHERE b.shop_id = ?1 AND b.is_voided = 0
           AND substr(b.billed_at,1,10) BETWEEN ?2 AND ?3
         GROUP BY p.id, p.name
         ORDER BY 4 DESC
         LIMIT ?4",
        )
        .map_err(|e| e.to_string())?;
    let out: Vec<_> = stmt
        .query_map(params![shop_id, from, to, limit.unwrap_or(10)], |r| {
            Ok(TopMoverRow {
                product_id: r.get(0)?,
                name: r.get(1)?,
                qty_sold: r.get(2)?,
                revenue_paise: r.get(3)?,
                bill_count: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(out)
}

// --- Directory (customers / doctors / prescriptions) ---------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub id: String,
    pub name: String,
    pub phone: Option<String>,
    pub gstin: Option<String>,
    pub gender: Option<String>,
    pub consent_abdm: i64,
    pub consent_marketing: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCustomerInput {
    pub id: Option<String>,
    pub shop_id: String,
    pub name: String,
    pub phone: Option<String>,
    pub gstin: Option<String>,
    pub gender: Option<String>,
    pub consent_abdm: Option<bool>,
    pub consent_marketing: Option<bool>,
    pub consent_method: Option<String>,
}

fn gen_id(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{}_{:x}", prefix, nanos)
}

fn current_iso() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

#[tauri::command]
pub fn search_customers(
    shop_id: String,
    q: String,
    limit: Option<i64>,
    state: State<DbState>,
) -> Result<Vec<Customer>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let like_lower = format!("%{}%", q.to_lowercase());
    let like_raw = format!("%{}%", q);
    let mut stmt = c
        .prepare(
            "SELECT id, name, phone, gstin, gender, consent_abdm, consent_marketing
         FROM customers
         WHERE shop_id = ?1
           AND (LOWER(name) LIKE ?2 OR phone LIKE ?3 OR LOWER(COALESCE(gstin,'')) LIKE ?2)
         ORDER BY name ASC LIMIT ?4",
        )
        .map_err(|e| e.to_string())?;
    let out: Vec<_> = stmt
        .query_map(
            params![shop_id, like_lower, like_raw, limit.unwrap_or(20)],
            |r| {
                Ok(Customer {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    phone: r.get(2)?,
                    gstin: r.get(3)?,
                    gender: r.get(4)?,
                    consent_abdm: r.get(5)?,
                    consent_marketing: r.get(6)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
pub fn upsert_customer(
    input: UpsertCustomerInput,
    state: State<DbState>,
) -> Result<String, String> {
    if input.name.trim().is_empty() {
        return Err("customer name required".into());
    }
    let id = input.id.clone().unwrap_or_else(|| gen_id("cus"));
    let has_consent =
        input.consent_abdm.unwrap_or(false) || input.consent_marketing.unwrap_or(false);
    let consent_at: Option<String> = if has_consent {
        Some(chrono_now_iso())
    } else {
        None
    };
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO customers (id, shop_id, name, phone, gstin, gender,
                                consent_marketing, consent_abdm, consent_captured_at, consent_method)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, phone=excluded.phone, gstin=excluded.gstin, gender=excluded.gender,
           consent_marketing=excluded.consent_marketing, consent_abdm=excluded.consent_abdm,
           consent_captured_at=excluded.consent_captured_at, consent_method=excluded.consent_method",
        params![id, input.shop_id, input.name.trim(), input.phone, input.gstin, input.gender,
                input.consent_marketing.unwrap_or(false) as i64,
                input.consent_abdm.unwrap_or(false) as i64,
                consent_at, input.consent_method],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

fn chrono_now_iso() -> String {
    // light ISO-8601 UTC without external crate dep
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // minimal; store as UTC seconds-based string for now
    format!("ts_{}", secs)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Doctor {
    pub id: String,
    pub reg_no: String,
    pub name: String,
    pub phone: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertDoctorInput {
    pub id: Option<String>,
    pub reg_no: String,
    pub name: String,
    pub phone: Option<String>,
}

#[tauri::command]
pub fn search_doctors(
    q: String,
    limit: Option<i64>,
    state: State<DbState>,
) -> Result<Vec<Doctor>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let like_lower = format!("%{}%", q.to_lowercase());
    let like_raw = format!("%{}%", q);
    let mut stmt = c
        .prepare(
            "SELECT id, reg_no, name, phone FROM doctors
         WHERE LOWER(name) LIKE ?1 OR LOWER(reg_no) LIKE ?1 OR phone LIKE ?2
         ORDER BY name ASC LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let out: Vec<_> = stmt
        .query_map(params![like_lower, like_raw, limit.unwrap_or(20)], |r| {
            Ok(Doctor {
                id: r.get(0)?,
                reg_no: r.get(1)?,
                name: r.get(2)?,
                phone: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
pub fn upsert_doctor(input: UpsertDoctorInput, state: State<DbState>) -> Result<String, String> {
    if input.reg_no.trim().is_empty() {
        return Err("regNo required".into());
    }
    if input.name.trim().is_empty() {
        return Err("doctor name required".into());
    }
    let id = input.id.clone().unwrap_or_else(|| gen_id("doc"));
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO doctors (id, reg_no, name, phone) VALUES (?1,?2,?3,?4)
         ON CONFLICT(id) DO UPDATE SET reg_no=excluded.reg_no, name=excluded.name, phone=excluded.phone",
        params![id, input.reg_no.trim(), input.name.trim(), input.phone],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prescription {
    pub id: String,
    pub customer_id: String,
    pub doctor_id: Option<String>,
    pub kind: String,
    pub image_path: Option<String>,
    pub issued_date: String,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRxInput {
    pub shop_id: String,
    pub customer_id: String,
    pub doctor_id: Option<String>,
    pub kind: String,
    pub image_path: Option<String>,
    pub issued_date: String,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn create_prescription(input: CreateRxInput, state: State<DbState>) -> Result<String, String> {
    if input.customer_id.is_empty() {
        return Err("customerId required".into());
    }
    if !regex_date(&input.issued_date) {
        return Err("issuedDate must be YYYY-MM-DD".into());
    }
    let id = gen_id("rx");
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO prescriptions (id, shop_id, customer_id, doctor_id, kind, image_path, issued_date, notes)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![id, input.shop_id, input.customer_id, input.doctor_id,
                input.kind, input.image_path, input.issued_date, input.notes],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

fn regex_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b[..4].iter().all(|c| c.is_ascii_digit())
        && b[5..7].iter().all(|c| c.is_ascii_digit())
        && b[8..].iter().all(|c| c.is_ascii_digit())
}

#[tauri::command]
pub fn list_prescriptions(
    customer_id: String,
    state: State<DbState>,
) -> Result<Vec<Prescription>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c
        .prepare(
            "SELECT id, customer_id, doctor_id, kind, image_path, issued_date, notes
         FROM prescriptions WHERE customer_id = ?1
         ORDER BY issued_date DESC, created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let out: Vec<_> = stmt
        .query_map(params![customer_id], |r| {
            Ok(Prescription {
                id: r.get(0)?,
                customer_id: r.get(1)?,
                doctor_id: r.get(2)?,
                kind: r.get(3)?,
                image_path: r.get(4)?,
                issued_date: r.get(5)?,
                notes: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(out)
}

// --- Supplier templates (X1 Tier A) -----------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplierRow {
    pub id: String,
    pub name: String,
    pub gstin: Option<String>,
}

#[tauri::command]
pub fn list_suppliers(shop_id: String, state: State<DbState>) -> Result<Vec<SupplierRow>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c
        .prepare("SELECT id, name, gstin FROM suppliers WHERE shop_id = ?1 ORDER BY name")
        .map_err(|e| e.to_string())?;
    let out: Vec<_> = stmt
        .query_map(params![shop_id], |r| {
            Ok(SupplierRow {
                id: r.get(0)?,
                name: r.get(1)?,
                gstin: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(out)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HeaderPatterns {
    pub invoice_no: String,
    pub invoice_date: String,
    pub total: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supplier: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinePatterns {
    pub row: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SupplierTemplateDTO {
    pub id: String,
    pub supplier_id: String,
    pub name: String,
    pub header_patterns: HeaderPatterns,
    pub line_patterns: LinePatterns,
    pub column_map: serde_json::Value,
    pub date_format: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSupplierTemplateInput {
    pub id: Option<String>,
    pub shop_id: String,
    pub supplier_id: String,
    pub name: String,
    pub header_patterns: HeaderPatterns,
    pub line_patterns: LinePatterns,
    pub column_map: serde_json::Value,
    #[serde(default)]
    pub date_format: Option<String>,
    #[serde(default)]
    pub is_active: Option<bool>,
}

fn row_to_tpl(r: &rusqlite::Row) -> rusqlite::Result<SupplierTemplateDTO> {
    let header_s: String = r.get(4)?;
    let line_s: String = r.get(5)?;
    let col_s: String = r.get(6)?;
    let header: HeaderPatterns = serde_json::from_str(&header_s).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    let line: LinePatterns = serde_json::from_str(&line_s).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    let col: serde_json::Value = serde_json::from_str(&col_s).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    Ok(SupplierTemplateDTO {
        id: r.get(0)?,
        supplier_id: r.get(2)?,
        name: r.get(3)?,
        header_patterns: header,
        line_patterns: line,
        column_map: col,
        date_format: r.get(7)?,
    })
}

#[tauri::command]
pub fn list_supplier_templates(
    shop_id: String,
    supplier_id: Option<String>,
    state: State<DbState>,
) -> Result<Vec<SupplierTemplateDTO>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let rows: Vec<SupplierTemplateDTO> = if let Some(sup) = supplier_id {
        let mut stmt = c.prepare(
            "SELECT id, shop_id, supplier_id, name, header_patterns, line_patterns, column_map, date_format
             FROM supplier_templates WHERE shop_id = ?1 AND supplier_id = ?2 ORDER BY name"
        ).map_err(|e| e.to_string())?;
        let v: Vec<_> = stmt
            .query_map(params![shop_id, sup], row_to_tpl)
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        v
    } else {
        let mut stmt = c.prepare(
            "SELECT id, shop_id, supplier_id, name, header_patterns, line_patterns, column_map, date_format
             FROM supplier_templates WHERE shop_id = ?1 ORDER BY name"
        ).map_err(|e| e.to_string())?;
        let v: Vec<_> = stmt
            .query_map(params![shop_id], row_to_tpl)
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        v
    };
    Ok(rows)
}

#[tauri::command]
pub fn upsert_supplier_template(
    input: UpsertSupplierTemplateInput,
    state: State<DbState>,
) -> Result<String, String> {
    if input.name.trim().is_empty() {
        return Err("name required".into());
    }
    if input.shop_id.trim().is_empty() {
        return Err("shopId required".into());
    }
    if input.supplier_id.trim().is_empty() {
        return Err("supplierId required".into());
    }
    let id = input.id.clone().unwrap_or_else(|| gen_id("stpl"));
    let header = serde_json::to_string(&input.header_patterns).map_err(|e| e.to_string())?;
    let line = serde_json::to_string(&input.line_patterns).map_err(|e| e.to_string())?;
    let col = serde_json::to_string(&input.column_map).map_err(|e| e.to_string())?;
    let fmt = input.date_format.unwrap_or_else(|| "DD/MM/YYYY".into());
    let active = if input.is_active.unwrap_or(true) {
        1
    } else {
        0
    };
    let now = current_iso();
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO supplier_templates
           (id, shop_id, supplier_id, name, header_patterns, line_patterns, column_map, date_format, is_active, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, header_patterns=excluded.header_patterns,
           line_patterns=excluded.line_patterns, column_map=excluded.column_map,
           date_format=excluded.date_format, is_active=excluded.is_active, updated_at=excluded.updated_at",
        params![id, input.shop_id, input.supplier_id, input.name, header, line, col, fmt, active, now],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn delete_supplier_template(id: String, state: State<DbState>) -> Result<(), String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute("DELETE FROM supplier_templates WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestHeader {
    pub invoice_no: Option<String>,
    pub invoice_date: Option<String>,
    pub total_paise: Option<i64>,
    pub supplier_hint: Option<String>,
    pub confidence: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestLine {
    pub product_hint: String,
    pub batch_no: Option<String>,
    pub expiry_date: Option<String>,
    pub qty: i64,
    pub rate_paise: i64,
    pub mrp_paise: Option<i64>,
    pub gst_rate: Option<i64>,
    pub confidence: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateTestResult {
    pub header: TestHeader,
    pub lines: Vec<TestLine>,
}

fn capture_first(re_src: &str, text: &str) -> Option<String> {
    if re_src.is_empty() {
        return None;
    }
    let re = regex::Regex::new(re_src).ok()?;
    let c = re.captures(text)?;
    if c.len() >= 2 {
        c.get(1).map(|m| m.as_str().to_string())
    } else {
        c.get(0).map(|m| m.as_str().to_string())
    }
}

fn parse_total_paise(s: &str) -> Option<i64> {
    let cleaned: String = s
        .chars()
        .filter(|ch| ch.is_ascii_digit() || *ch == '.')
        .collect();
    if cleaned.is_empty() {
        return None;
    }
    let f: f64 = cleaned.parse().ok()?;
    Some((f * 100.0).round() as i64)
}

fn parse_dated(s: &str, fmt: &str) -> Option<String> {
    let parts: Vec<&str> = s.split(['/', '-']).filter(|p| !p.is_empty()).collect();
    if parts.len() != 3 {
        return None;
    }
    match fmt {
        "DD/MM/YYYY" | "DD-MMM-YYYY" => {
            let d = parts[0];
            let m = parts[1];
            let y = parts[2];
            if fmt == "DD-MMM-YYYY" {
                let mon = match m.to_uppercase().as_str() {
                    "JAN" => "01",
                    "FEB" => "02",
                    "MAR" => "03",
                    "APR" => "04",
                    "MAY" => "05",
                    "JUN" => "06",
                    "JUL" => "07",
                    "AUG" => "08",
                    "SEP" => "09",
                    "OCT" => "10",
                    "NOV" => "11",
                    "DEC" => "12",
                    _ => return None,
                };
                Some(format!("{:0>4}-{}-{:0>2}", y, mon, d))
            } else {
                Some(format!("{:0>4}-{:0>2}-{:0>2}", y, m, d))
            }
        }
        "MM/DD/YYYY" => Some(format!(
            "{:0>4}-{:0>2}-{:0>2}",
            parts[2], parts[0], parts[1]
        )),
        "YYYY-MM-DD" => Some(format!(
            "{:0>4}-{:0>2}-{:0>2}",
            parts[0], parts[1], parts[2]
        )),
        _ => None,
    }
}

#[tauri::command]
pub fn test_supplier_template(
    template: SupplierTemplateDTO,
    sample_text: String,
) -> Result<TemplateTestResult, String> {
    let h = &template.header_patterns;
    let inv_no = capture_first(&h.invoice_no, &sample_text);
    let inv_date_raw = capture_first(&h.invoice_date, &sample_text);
    let inv_date = inv_date_raw
        .as_ref()
        .and_then(|s| parse_dated(s, &template.date_format));
    let total_paise = capture_first(&h.total, &sample_text)
        .as_deref()
        .and_then(parse_total_paise);
    let supplier_hint = h
        .supplier
        .as_deref()
        .and_then(|p| capture_first(p, &sample_text));

    let mut present = 0u8;
    if inv_no.is_some() {
        present += 1;
    }
    if inv_date.is_some() {
        present += 1;
    }
    if total_paise.is_some() {
        present += 1;
    }
    let hdr_conf = present as f64 / 3.0;

    let mut lines = Vec::<TestLine>::new();
    if !template.line_patterns.row.is_empty() {
        if let Ok(re) = regex::Regex::new(&template.line_patterns.row) {
            for cap in re.captures_iter(&sample_text) {
                let get_i = |i: usize| cap.get(i).map(|m| m.as_str().to_string());
                let col = &template.column_map;
                let idx = |k: &str| -> Option<usize> {
                    col.get(k)
                        .and_then(|v| v.as_u64())
                        .map(|n| (n as usize) + 1)
                };
                let product = idx("product").and_then(get_i).unwrap_or_default();
                let batch = idx("batchNo").and_then(get_i);
                let expiry_raw = idx("expiryDate").and_then(get_i);
                let expiry = expiry_raw
                    .as_ref()
                    .and_then(|s| parse_dated(s, &template.date_format));
                let qty: i64 = idx("qty")
                    .and_then(get_i)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                let rate_paise = idx("ratePaise")
                    .and_then(get_i)
                    .as_deref()
                    .and_then(parse_total_paise)
                    .unwrap_or(0);
                let mrp_paise = idx("mrpPaise")
                    .and_then(get_i)
                    .as_deref()
                    .and_then(parse_total_paise);
                let gst_rate = idx("gstRate").and_then(get_i).and_then(|s| s.parse().ok());
                let mut fields = 0u8;
                let mut total_fields = 0u8;
                for k in ["product", "batchNo", "expiryDate", "qty", "ratePaise"] {
                    if col.get(k).is_some() {
                        total_fields += 1;
                    }
                }
                if !product.is_empty() {
                    fields += 1;
                }
                if batch.is_some() {
                    fields += 1;
                }
                if expiry.is_some() {
                    fields += 1;
                }
                if qty > 0 {
                    fields += 1;
                }
                if rate_paise > 0 {
                    fields += 1;
                }
                let conf = if total_fields == 0 {
                    0.0
                } else {
                    (fields as f64) / (total_fields as f64)
                };
                lines.push(TestLine {
                    product_hint: product,
                    batch_no: batch,
                    expiry_date: expiry,
                    qty,
                    rate_paise,
                    mrp_paise,
                    gst_rate,
                    confidence: conf,
                });
            }
        }
    }

    Ok(TemplateTestResult {
        header: TestHeader {
            invoice_no: inv_no,
            invoice_date: inv_date,
            total_paise,
            supplier_hint,
            confidence: hdr_conf,
        },
        lines,
    })
}

// ---------------------------------------------------------------------------
// Shop (settings) — read/write the shop_local row seeded by db::ensure_default_shop.
// F5 in AUDIT_REPORT_2026-04-15.md: first-run settings must overwrite the
// placeholder GSTIN/state-code/license before any GST invoice is issued.

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Shop {
    pub id: String,
    pub name: String,
    pub gstin: String,
    pub state_code: String,
    pub retail_license: String,
    pub address: String,
    pub created_at: String,
}

fn is_valid_gstin(g: &str) -> bool {
    // 15 chars, uppercase alphanumerics; placeholder "00AAAAA0000A0Z0" passes
    // length + charset but fails the structural regex — owner must replace.
    g.len() == 15 && g.chars().all(|c| c.is_ascii_alphanumeric())
}

#[tauri::command]
pub fn shop_get(id: String, state: State<DbState>) -> Result<Option<Shop>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let row = c.query_row(
        "SELECT id, name, gstin, state_code, retail_license, address, created_at
         FROM shops WHERE id = ?1",
        params![id],
        |r| {
            Ok(Shop {
                id: r.get(0)?,
                name: r.get(1)?,
                gstin: r.get(2)?,
                state_code: r.get(3)?,
                retail_license: r.get(4)?,
                address: r.get(5)?,
                created_at: r.get(6)?,
            })
        },
    );
    match row {
        Ok(s) => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopUpdateInput {
    pub id: String,
    pub name: String,
    pub gstin: String,
    pub state_code: String,
    pub retail_license: String,
    pub address: String,
}

#[tauri::command]
pub fn shop_update(input: ShopUpdateInput, state: State<DbState>) -> Result<Shop, String> {
    if input.name.trim().is_empty() {
        return Err("name required".into());
    }
    if !is_valid_gstin(&input.gstin) {
        return Err("gstin must be 15 alphanumeric characters".into());
    }
    if input.state_code.len() != 2 || !input.state_code.chars().all(|c| c.is_ascii_digit()) {
        return Err("state_code must be a 2-digit code".into());
    }
    if input.retail_license.trim().is_empty() {
        return Err("retail_license required".into());
    }
    if input.address.trim().is_empty() {
        return Err("address required".into());
    }

    let c = state.0.lock().map_err(|e| e.to_string())?;
    let rows = c
        .execute(
            "UPDATE shops SET name = ?2, gstin = ?3, state_code = ?4,
           retail_license = ?5, address = ?6
         WHERE id = ?1",
            params![
                input.id,
                input.name,
                input.gstin,
                input.state_code,
                input.retail_license,
                input.address
            ],
        )
        .map_err(|e| e.to_string())?;
    if rows == 0 {
        return Err(format!("shop {} not found", input.id));
    }
    // Audit-log the write for DPDP/CERT-In traceability.
    let _ = c.execute(
        "INSERT INTO audit_log (actor_id, entity, entity_id, action, payload)
         VALUES ('system', 'shop', ?1, 'update', ?2)",
        params![
            input.id,
            format!(
                r#"{{"name":{},"gstin":{}}}"#,
                serde_json::Value::String(input.name.clone()),
                serde_json::Value::String(input.gstin.clone())
            ),
        ],
    );
    drop(c);
    shop_get(input.id.clone(), state)?.ok_or_else(|| "shop disappeared after update".into())
}

// ---------------------------------------------------------------------------
// F7: SQLite backup / restore.
// `db_backup` runs `VACUUM INTO` (atomic, hot-backup-safe, rebuilds the file)
// then verifies the copy with `PRAGMA integrity_check`. `db_restore` validates
// the source first, snapshots the current DB to a `.pre-restore.bak` sibling,
// swaps the in-memory connection, and reopens. Both write to audit_log.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub path: String,
    pub size_bytes: i64,
    pub integrity: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub restored_from: String,
    pub pre_restore_backup: Option<String>,
    pub integrity: String,
}

fn integrity_check(conn: &Connection) -> Result<String, String> {
    conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_backup(dest_path: String, state: State<DbState>) -> Result<BackupResult, String> {
    if dest_path.trim().is_empty() {
        return Err("dest_path required".into());
    }
    let dest = std::path::PathBuf::from(&dest_path);
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
    }
    // Refuse to overwrite an existing file silently — keep restore boring.
    if dest.exists() {
        return Err(format!(
            "destination already exists: {} (delete it or pick another path)",
            dest.display()
        ));
    }

    let c = state.0.lock().map_err(|e| e.to_string())?;
    // VACUUM INTO requires a string literal — escape any single quotes in the path.
    let safe = dest_path.replace('\'', "''");
    c.execute(&format!("VACUUM INTO '{}'", safe), [])
        .map_err(|e| format!("VACUUM INTO failed: {e}"))?;

    // Verify the freshly written copy in a separate connection.
    let check = Connection::open(&dest).map_err(|e| format!("open backup: {e}"))?;
    let result = integrity_check(&check)?;
    drop(check);
    if result != "ok" {
        return Err(format!("backup integrity check failed: {result}"));
    }
    let size_bytes = std::fs::metadata(&dest)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    let _ = c.execute(
        "INSERT INTO audit_log (actor_id, entity, entity_id, action, payload)
         VALUES ('system', 'db', 'backup', 'create', ?1)",
        params![format!(
            r#"{{"path":{},"sizeBytes":{}}}"#,
            serde_json::Value::String(dest_path.clone()),
            size_bytes
        )],
    );
    tracing::info!(target: "db", path = %dest_path, size_bytes, "backup written");
    Ok(BackupResult {
        path: dest_path,
        size_bytes,
        integrity: result,
    })
}

#[tauri::command]
pub fn db_restore(source_path: String, state: State<DbState>) -> Result<RestoreResult, String> {
    if source_path.trim().is_empty() {
        return Err("source_path required".into());
    }
    let src = std::path::PathBuf::from(&source_path);
    if !src.exists() {
        return Err(format!("source file not found: {}", src.display()));
    }
    // Step 1: validate the source BEFORE we touch the live DB.
    {
        let probe = Connection::open(&src).map_err(|e| format!("open source: {e}"))?;
        let result = integrity_check(&probe)?;
        if result != "ok" {
            return Err(format!("source integrity check failed: {result}"));
        }
    }

    // Step 2: lock + snapshot current DB beside itself.
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let dest = crate::db::default_db_path();
    let pre_restore_backup = if dest.exists() {
        let bak = dest.with_extension(format!(
            "pre-restore-{}.bak",
            chrono::Utc::now().format("%Y%m%dT%H%M%S")
        ));
        std::fs::copy(&dest, &bak).map_err(|e| format!("snapshot before restore failed: {e}"))?;
        Some(bak.to_string_lossy().into_owned())
    } else {
        None
    };

    // Step 3: drop the live connection by swapping in an in-memory placeholder,
    // then overwrite the file on disk and reopen.
    let placeholder = Connection::open_in_memory().map_err(|e| e.to_string())?;
    let old = std::mem::replace(&mut *guard, placeholder);
    drop(old);
    std::fs::copy(&src, &dest).map_err(|e| format!("copy restore: {e}"))?;

    let new_conn = crate::db::open_local(&dest).map_err(|e| e.to_string())?;
    *guard = new_conn;

    // Re-verify on the newly opened connection.
    let after = integrity_check(&guard)?;
    if after != "ok" {
        return Err(format!("post-restore integrity check failed: {after}"));
    }

    let _ = guard.execute(
        "INSERT INTO audit_log (actor_id, entity, entity_id, action, payload)
         VALUES ('system', 'db', 'restore', 'replace', ?1)",
        params![format!(
            r#"{{"source":{}}}"#,
            serde_json::Value::String(source_path.clone())
        )],
    );
    tracing::warn!(target: "db", source = %source_path, "database restored from backup");
    Ok(RestoreResult {
        restored_from: source_path,
        pre_restore_backup,
        integrity: after,
    })
}

#[cfg(test)]
mod backup_restore_tests {
    //! Round-trip test for the SQL primitives that underlie F7. These don't
    //! exercise tauri::State (hard to fake without a runtime); they assert
    //! the on-disk semantics that `db_backup` / `db_restore` rely on:
    //! VACUUM INTO atomically writes a valid file, integrity_check returns
    //! "ok" on a healthy DB and a non-"ok" string on corruption.
    use super::*;
    use rusqlite::Connection;

    fn seed(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT NOT NULL);
             INSERT INTO t(v) VALUES ('alpha'),('beta'),('gamma');",
        )
        .unwrap();
    }

    #[test]
    fn vacuum_into_then_integrity_check_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let src = Connection::open_in_memory().unwrap();
        seed(&src);
        let dest = dir.path().join("backup.db");
        let dest_str = dest.to_string_lossy().replace('\'', "''");
        src.execute(&format!("VACUUM INTO '{}'", dest_str), [])
            .unwrap();

        let restored = Connection::open(&dest).unwrap();
        let result = integrity_check(&restored).unwrap();
        assert_eq!(result, "ok");
        let count: i64 = restored
            .query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn integrity_check_returns_ok_for_fresh_db() {
        let conn = Connection::open_in_memory().unwrap();
        seed(&conn);
        assert_eq!(integrity_check(&conn).unwrap(), "ok");
    }
}

// --- A8 · list payments by bill (ADR 0012) -------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentRowOut {
    pub id: String,
    pub bill_id: String,
    pub mode: String,
    pub amount_paise: i64,
    pub ref_no: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn list_payments_by_bill(
    bill_id: String,
    state: State<DbState>,
) -> Result<Vec<PaymentRowOut>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c
        .prepare(
            "SELECT id, bill_id, mode, amount_paise, ref_no, created_at
             FROM payments WHERE bill_id = ?1 ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map(params![bill_id], |r| {
            Ok(PaymentRowOut {
                id: r.get(0)?,
                bill_id: r.get(1)?,
                mode: r.get(2)?,
                amount_paise: r.get(3)?,
                ref_no: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    iter.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

// -----------------------------------------------------------------------------
// A13 · User lookup (role gating for expiry-override and future compliance)
// -----------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserOut {
    pub id: String,
    pub shop_id: String,
    pub name: String,
    pub role: String,
    pub is_active: i64,
}

#[tauri::command]
pub fn user_get(id: String, state: State<DbState>) -> Result<Option<UserOut>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let row = c.query_row(
        "SELECT id, shop_id, name, role, is_active FROM users WHERE id = ?1",
        params![id],
        |r| {
            Ok(UserOut {
                id: r.get(0)?,
                shop_id: r.get(1)?,
                name: r.get(2)?,
                role: r.get(3)?,
                is_active: r.get(4)?,
            })
        },
    );
    match row {
        Ok(u) => Ok(Some(u)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// -----------------------------------------------------------------------------
// A13 · Expiry override (ADR 0013)
// -----------------------------------------------------------------------------
// The cashier or owner calls this before save_bill when a line has a batch
// with 0 < days_to_expiry <= 30. save_bill then looks for a matching fresh
// row and allows the line. Caller is responsible for confirming the user is
// an owner BEFORE invoking this command (UI gate), but Rust re-checks the
// role here as a defence-in-depth measure.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpiryOverrideInput {
    pub product_id: String,
    pub batch_id: String,
    pub actor_user_id: String,
    pub reason: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExpiryOverrideOut {
    pub id: String,
    pub batch_id: String,
    pub actor_user_id: String,
    pub actor_role: String,
    pub days_past_expiry: i64, // negative when still in the warn-window
    pub created_at: String,
}

#[tauri::command]
pub fn record_expiry_override(
    input: ExpiryOverrideInput,
    state: State<DbState>,
) -> Result<ExpiryOverrideOut, String> {
    if input.reason.trim().len() < 4 {
        return Err("REASON_TOO_SHORT:min=4".into());
    }
    let c = state.0.lock().map_err(|e| e.to_string())?;

    // Defence-in-depth: role check.
    let actor_role: String = c
        .query_row(
            "SELECT role FROM users WHERE id = ?1 AND is_active = 1",
            params![input.actor_user_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("USER_NOT_FOUND:{}:{}", input.actor_user_id, e))?;
    if actor_role != "owner" {
        return Err(format!("OVERRIDE_FORBIDDEN:role={}", actor_role));
    }

    // Pull batch expiry to compute days_past_expiry at the moment of override.
    let (batch_expiry, days_f): (String, f64) = c
        .query_row(
            "SELECT expiry_date,
                    CAST((julianday('now') - julianday(expiry_date)) AS REAL)
               FROM batches WHERE id = ?1",
            params![input.batch_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)),
        )
        .map_err(|e| format!("BATCH_NOT_FOUND:{}:{}", input.batch_id, e))?;
    // days_past is +ve when already past expiry, negative while still in warn.
    let days_past: i64 = days_f.floor() as i64;

    // Hard Rule 9: expired batches are never overridable.
    if days_past >= 0 {
        return Err(format!(
            "EXPIRED_BATCH_NOT_OVERRIDABLE:batch_id={}:expiry={}",
            input.batch_id, batch_expiry
        ));
    }

    let id = format!(
        "eo_{}_{}",
        &input.batch_id,
        chrono::Utc::now().timestamp_millis()
    );
    c.execute(
        "INSERT INTO expiry_override_audit
           (id, bill_line_id, bill_no, product_id, batch_id, actor_user_id,
            actor_role, reason, days_past_expiry)
         VALUES (?1, NULL, NULL, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            input.product_id,
            input.batch_id,
            input.actor_user_id,
            actor_role,
            input.reason.trim(),
            days_past
        ],
    )
    .map_err(|e| e.to_string())?;

    let created_at: String = c
        .query_row(
            "SELECT created_at FROM expiry_override_audit WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(ExpiryOverrideOut {
        id,
        batch_id: input.batch_id,
        actor_user_id: input.actor_user_id,
        actor_role,
        days_past_expiry: days_past,
        created_at,
    })
}

// -----------------------------------------------------------------------------
// A13 · get_nearest_expiry (ADR 0013)
// -----------------------------------------------------------------------------
// Returns the next-to-expire in-stock batch for a product, with days_to_expiry
// pre-computed in SQL. Used by BillingScreen to render the red/amber chip as
// soon as a line is added, without pre-allocating FEFO.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpiryStatusOut {
    pub batch_id: String,
    pub batch_no: String,
    pub expiry_date: String,
    pub qty_on_hand: i64,
    pub days_to_expiry: i64,
}

#[tauri::command]
pub fn get_nearest_expiry(
    product_id: String,
    state: State<DbState>,
) -> Result<Option<ExpiryStatusOut>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let row = c.query_row(
        "SELECT id, batch_no, expiry_date, qty_on_hand,
                CAST((julianday(expiry_date) - julianday('now')) AS REAL)
           FROM batches
          WHERE product_id = ?1 AND qty_on_hand > 0
          ORDER BY expiry_date ASC, batch_no ASC
          LIMIT 1",
        params![product_id],
        |r| {
            let days_f: f64 = r.get(4)?;
            Ok(ExpiryStatusOut {
                batch_id: r.get(0)?,
                batch_no: r.get(1)?,
                expiry_date: r.get(2)?,
                qty_on_hand: r.get(3)?,
                days_to_expiry: days_f.floor() as i64,
            })
        },
    );
    match row {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// ============================================================================
// A9 · Invoice print (ADR 0014)
//
// get_bill_full   : single read surface for print + GSTR-1 line export + stock
//                   reconcile. Populates nested Shop/Bill/Customer/Prescription/
//                   Line/Payment/HsnSummary blocks in one call.
// record_print    : writes print_audit row and returns (printCount, isDuplicate,
//                   stampedAt). First call per bill = isDuplicate=0 ("ORIGINAL"),
//                   subsequent = isDuplicate=1 ("DUPLICATE — REPRINT").
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopOutFull {
    pub id: String,
    pub name: String,
    pub gstin: String,
    pub state_code: String,
    pub retail_license: String,
    pub address: String,
    pub pharmacist_name: Option<String>,
    pub pharmacist_reg_no: Option<String>,
    pub fssai_no: Option<String>,
    pub default_invoice_layout: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BillOutFull {
    pub id: String,
    pub bill_no: String,
    pub billed_at: String,
    pub customer_id: Option<String>,
    pub rx_id: Option<String>,
    pub cashier_id: String,
    pub gst_treatment: String,
    pub subtotal_paise: i64,
    pub total_discount_paise: i64,
    pub total_cgst_paise: i64,
    pub total_sgst_paise: i64,
    pub total_igst_paise: i64,
    pub total_cess_paise: i64,
    pub round_off_paise: i64,
    pub grand_total_paise: i64,
    pub payment_mode: String,
    pub is_voided: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerOutFull {
    pub id: String,
    pub name: String,
    pub phone: Option<String>,
    pub gstin: Option<String>,
    pub address: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrescriptionOutFull {
    pub id: String,
    pub doctor_name: Option<String>,
    pub doctor_reg_no: Option<String>,
    pub kind: String,
    pub issued_date: String,
    pub notes: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BillLineOutFull {
    pub id: String,
    pub product_id: String,
    pub product_name: String,
    pub hsn: String,
    pub batch_id: String,
    pub batch_no: Option<String>,
    pub expiry_date: Option<String>,
    pub qty: f64,
    pub mrp_paise: i64,
    pub discount_pct: f64,
    pub discount_paise: i64,
    pub taxable_value_paise: i64,
    pub gst_rate: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub cess_paise: i64,
    pub line_total_paise: i64,
    pub schedule: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HsnSummaryOut {
    pub hsn: String,
    pub gst_rate: i64,
    pub taxable_value_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub cess_paise: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BillFullOut {
    pub shop: ShopOutFull,
    pub bill: BillOutFull,
    pub customer: Option<CustomerOutFull>,
    pub prescription: Option<PrescriptionOutFull>,
    pub lines: Vec<BillLineOutFull>,
    pub payments: Vec<PaymentRowOut>,
    pub hsn_tax_summary: Vec<HsnSummaryOut>,
}

#[tauri::command]
pub fn get_bill_full(bill_id: String, state: State<DbState>) -> Result<BillFullOut, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;

    // --- bill header ---
    let bill = c
        .query_row(
            "SELECT id, bill_no, billed_at, customer_id, rx_id, cashier_id,
                    gst_treatment, subtotal_paise, total_discount_paise,
                    total_cgst_paise, total_sgst_paise, total_igst_paise,
                    total_cess_paise, round_off_paise, grand_total_paise,
                    payment_mode, is_voided, shop_id
               FROM bills WHERE id = ?1",
            params![bill_id],
            |r| {
                Ok((
                    BillOutFull {
                        id: r.get(0)?,
                        bill_no: r.get(1)?,
                        billed_at: r.get(2)?,
                        customer_id: r.get(3)?,
                        rx_id: r.get(4)?,
                        cashier_id: r.get(5)?,
                        gst_treatment: r.get(6)?,
                        subtotal_paise: r.get(7)?,
                        total_discount_paise: r.get(8)?,
                        total_cgst_paise: r.get(9)?,
                        total_sgst_paise: r.get(10)?,
                        total_igst_paise: r.get(11)?,
                        total_cess_paise: r.get(12)?,
                        round_off_paise: r.get(13)?,
                        grand_total_paise: r.get(14)?,
                        payment_mode: r.get(15)?,
                        is_voided: r.get(16)?,
                    },
                    r.get::<_, String>(17)?,
                ))
            },
        )
        .map_err(|e| format!("BILL_NOT_FOUND:{}:{}", bill_id, e))?;
    let (bill_header, shop_id) = bill;

    // --- shop ---
    let shop = c
        .query_row(
            "SELECT id, name, gstin, state_code, retail_license, address,
                    pharmacist_name, pharmacist_reg_no, fssai_no,
                    default_invoice_layout
               FROM shops WHERE id = ?1",
            params![shop_id],
            |r| {
                Ok(ShopOutFull {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    gstin: r.get(2)?,
                    state_code: r.get(3)?,
                    retail_license: r.get(4)?,
                    address: r.get(5)?,
                    pharmacist_name: r.get(6)?,
                    pharmacist_reg_no: r.get(7)?,
                    fssai_no: r.get(8)?,
                    default_invoice_layout: r.get(9)?,
                })
            },
        )
        .map_err(|e| format!("SHOP_NOT_FOUND:{}:{}", shop_id, e))?;

    // --- customer (optional) ---
    let customer = if let Some(ref cid) = bill_header.customer_id {
        c.query_row(
            "SELECT id, name, phone, gstin, address
               FROM customers WHERE id = ?1",
            params![cid],
            |r| {
                Ok(CustomerOutFull {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    phone: r.get(2)?,
                    gstin: r.get(3)?,
                    address: r.get(4)?,
                })
            },
        )
        .ok()
    } else {
        None
    };

    // --- prescription (optional) ---
    let prescription = if let Some(ref rid) = bill_header.rx_id {
        c.query_row(
            "SELECT p.id, d.name, d.reg_no, p.kind, p.issued_date, p.notes
               FROM prescriptions p
               LEFT JOIN doctors d ON d.id = p.doctor_id
               WHERE p.id = ?1",
            params![rid],
            |r| {
                Ok(PrescriptionOutFull {
                    id: r.get(0)?,
                    doctor_name: r.get(1)?,
                    doctor_reg_no: r.get(2)?,
                    kind: r.get(3)?,
                    issued_date: r.get(4)?,
                    notes: r.get(5)?,
                })
            },
        )
        .ok()
    } else {
        None
    };

    // --- lines (with product HSN + schedule + batch detail) ---
    let mut lines_stmt = c
        .prepare(
            "SELECT bl.id, bl.product_id, p.name AS product_name, p.hsn, p.schedule,
                    bl.batch_id, b.batch_no, b.expiry_date,
                    bl.qty, bl.mrp_paise, bl.discount_pct, bl.discount_paise,
                    bl.taxable_value_paise, bl.gst_rate,
                    bl.cgst_paise, bl.sgst_paise, bl.igst_paise, bl.cess_paise,
                    bl.line_total_paise
               FROM bill_lines bl
               JOIN products p ON p.id = bl.product_id
               LEFT JOIN batches b ON b.id = bl.batch_id
              WHERE bl.bill_id = ?1
              ORDER BY bl.id ASC",
        )
        .map_err(|e| e.to_string())?;
    let lines: Vec<BillLineOutFull> = lines_stmt
        .query_map(params![bill_id], |r| {
            Ok(BillLineOutFull {
                id: r.get(0)?,
                product_id: r.get(1)?,
                product_name: r.get(2)?,
                hsn: r.get(3)?,
                schedule: r.get(4)?,
                batch_id: r.get(5)?,
                batch_no: r.get(6)?,
                expiry_date: r.get(7)?,
                qty: r.get(8)?,
                mrp_paise: r.get(9)?,
                discount_pct: r.get(10)?,
                discount_paise: r.get(11)?,
                taxable_value_paise: r.get(12)?,
                gst_rate: r.get(13)?,
                cgst_paise: r.get(14)?,
                sgst_paise: r.get(15)?,
                igst_paise: r.get(16)?,
                cess_paise: r.get(17)?,
                line_total_paise: r.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    // --- payments (reuse existing shape) ---
    let mut pay_stmt = c
        .prepare(
            "SELECT id, bill_id, mode, amount_paise, ref_no, created_at
               FROM payments WHERE bill_id = ?1 ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;
    let payments: Vec<PaymentRowOut> = pay_stmt
        .query_map(params![bill_id], |r| {
            Ok(PaymentRowOut {
                id: r.get(0)?,
                bill_id: r.get(1)?,
                mode: r.get(2)?,
                amount_paise: r.get(3)?,
                ref_no: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    // --- HSN-wise tax summary (grouped aggregation in SQL) ---
    let mut hsn_stmt = c
        .prepare(
            "SELECT p.hsn, bl.gst_rate,
                    SUM(bl.taxable_value_paise),
                    SUM(bl.cgst_paise), SUM(bl.sgst_paise),
                    SUM(bl.igst_paise), SUM(bl.cess_paise)
               FROM bill_lines bl
               JOIN products p ON p.id = bl.product_id
              WHERE bl.bill_id = ?1
              GROUP BY p.hsn, bl.gst_rate
              ORDER BY p.hsn ASC",
        )
        .map_err(|e| e.to_string())?;
    let hsn_tax_summary: Vec<HsnSummaryOut> = hsn_stmt
        .query_map(params![bill_id], |r| {
            Ok(HsnSummaryOut {
                hsn: r.get(0)?,
                gst_rate: r.get(1)?,
                taxable_value_paise: r.get(2)?,
                cgst_paise: r.get(3)?,
                sgst_paise: r.get(4)?,
                igst_paise: r.get(5)?,
                cess_paise: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    Ok(BillFullOut {
        shop,
        bill: bill_header,
        customer,
        prescription,
        lines,
        payments,
        hsn_tax_summary,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPrintInput {
    pub bill_id: String,
    pub layout: String,
    pub actor_user_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintReceiptOut {
    pub id: String,
    pub bill_id: String,
    pub layout: String,
    pub is_duplicate: i64,
    pub print_count: i64,
    pub stamped_at: String,
}

#[tauri::command]
pub fn record_print(
    input: RecordPrintInput,
    state: State<DbState>,
) -> Result<PrintReceiptOut, String> {
    if !matches!(input.layout.as_str(), "thermal_80mm" | "a5_gst") {
        return Err(format!("INVALID_LAYOUT:{}", input.layout));
    }
    let c = state.0.lock().map_err(|e| e.to_string())?;

    // Ensure the bill exists (catches stale IDs before we write the audit row).
    let _bill_no: String = c
        .query_row(
            "SELECT bill_no FROM bills WHERE id = ?1",
            params![input.bill_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("BILL_NOT_FOUND:{}:{}", input.bill_id, e))?;

    // Ensure the actor exists.
    let _actor_role: String = c
        .query_row(
            "SELECT role FROM users WHERE id = ?1 AND is_active = 1",
            params![input.actor_user_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("USER_NOT_FOUND:{}:{}", input.actor_user_id, e))?;

    // Count prior prints — first print is ORIGINAL (is_duplicate=0), any after is DUPLICATE (=1).
    let prior: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM print_audit WHERE bill_id = ?1",
            params![input.bill_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let is_duplicate: i64 = if prior == 0 { 0 } else { 1 };
    let id = format!("pa_{}", chrono::Utc::now().timestamp_millis());
    c.execute(
        "INSERT INTO print_audit (id, bill_id, layout, actor_user_id, is_duplicate)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            id,
            input.bill_id,
            input.layout,
            input.actor_user_id,
            is_duplicate
        ],
    )
    .map_err(|e| e.to_string())?;
    let stamped_at: String = c
        .query_row(
            "SELECT printed_at FROM print_audit WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(PrintReceiptOut {
        id,
        bill_id: input.bill_id,
        layout: input.layout,
        is_duplicate,
        print_count: prior + 1,
        stamped_at,
    })
}

// ───────────────────────────── A10: GSTR-1 export ─────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopForGstr1 {
    pub id: String,
    pub gstin: String,
    pub state_code: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerForGstr1 {
    pub id: String,
    pub gstin: Option<String>,
    pub name: String,
    pub state_code: Option<String>,
    pub address: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillLineForGstr1 {
    pub id: String,
    pub product_id: String,
    pub hsn: String,
    pub gst_rate: i64,
    pub qty: f64,
    pub taxable_value_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub cess_paise: i64,
    pub line_total_paise: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillForGstr1 {
    pub id: String,
    pub bill_no: String,
    pub billed_at: String,
    pub doc_series: String,
    pub gst_treatment: String,
    pub subtotal_paise: i64,
    pub total_discount_paise: i64,
    pub total_cgst_paise: i64,
    pub total_sgst_paise: i64,
    pub total_igst_paise: i64,
    pub total_cess_paise: i64,
    pub round_off_paise: i64,
    pub grand_total_paise: i64,
    pub is_voided: i64,
    pub customer: Option<CustomerForGstr1>,
    pub lines: Vec<BillLineForGstr1>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gstr1InputOut {
    pub shop: ShopForGstr1,
    pub bills: Vec<BillForGstr1>,
    pub period: String,
}

/// Read-path: given a shop + period (MMYYYY), return a composite payload that
/// the TS `@pharmacare/gstr1` package consumes to produce the JSON/CSV.
///
/// Selection: bills whose `billed_at` falls in (MM,YYYY) *IST* — we push the
/// IST conversion down to TS to keep the Rust side timezone-agnostic.
/// We include voided bills so the doc section can count cancellations.
#[tauri::command]
pub fn generate_gstr1_payload(
    shop_id: String,
    period: String,
    state: State<DbState>,
) -> Result<Gstr1InputOut, String> {
    // Validate period format
    if period.len() != 6 || !period.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("PERIOD_INVALID:{}", period));
    }
    let month: i64 = period[0..2].parse().map_err(|_| "PERIOD_INVALID")?;
    if !(1..=12).contains(&month) {
        return Err(format!("PERIOD_INVALID:month={}", month));
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let c = &*conn;

    // Shop
    let shop = c
        .query_row(
            "SELECT id, gstin, state_code, name FROM shops WHERE id = ?1",
            params![shop_id],
            |r| {
                Ok(ShopForGstr1 {
                    id: r.get(0)?,
                    gstin: r.get(1)?,
                    state_code: r.get(2)?,
                    name: r.get(3)?,
                })
            },
        )
        .map_err(|e| format!("SHOP_NOT_FOUND:{}", e))?;

    // Period range filter — SQLite substring on billed_at (ISO8601, UTC). We pull
    // a wider window (prev+next day buffer) and let TS filter by IST.
    let yyyy = &period[2..6];
    let mm = &period[0..2];
    // Build approximate UTC window: from (yyyy-mm-01T00:00:00Z - 1 day) to (yyyy-(mm+1)-01T00:00:00Z + 1 day)
    // Simpler: fetch any bill where substr(billed_at,1,7) in {prev-month, this-month, next-month}
    let (pm_mm, pm_yyyy) = prev_month(mm, yyyy);
    let (nm_mm, nm_yyyy) = next_month(mm, yyyy);
    let pattern_this = format!("{}-{}", yyyy, mm);
    let pattern_prev = format!("{}-{}", pm_yyyy, pm_mm);
    let pattern_next = format!("{}-{}", nm_yyyy, nm_mm);

    let mut bills: Vec<BillForGstr1> = Vec::new();
    let mut stmt = c
        .prepare(
            "SELECT id, bill_no, billed_at, doc_series, gst_treatment,
                    subtotal_paise, total_discount_paise,
                    total_cgst_paise, total_sgst_paise, total_igst_paise, total_cess_paise,
                    round_off_paise, grand_total_paise, is_voided, customer_id
             FROM bills
             WHERE shop_id = ?1
               AND (substr(billed_at,1,7) = ?2
                    OR substr(billed_at,1,7) = ?3
                    OR substr(billed_at,1,7) = ?4)
             ORDER BY billed_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            params![shop_id, pattern_this, pattern_prev, pattern_next],
            |r| {
                Ok((
                    r.get::<_, String>(0)?, // id
                    r.get::<_, String>(1)?, // bill_no
                    r.get::<_, String>(2)?, // billed_at
                    r.get::<_, String>(3)?, // doc_series
                    r.get::<_, String>(4)?, // gst_treatment
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, i64>(7)?,
                    r.get::<_, i64>(8)?,
                    r.get::<_, i64>(9)?,
                    r.get::<_, i64>(10)?,
                    r.get::<_, i64>(11)?,
                    r.get::<_, i64>(12)?,
                    r.get::<_, i64>(13)?,            // is_voided
                    r.get::<_, Option<String>>(14)?, // customer_id
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    type BillRowTuple = (
        String,
        String,
        String,
        String,
        String,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        Option<String>,
    );
    let mut bill_tuples: Vec<BillRowTuple> = Vec::new();
    for row in rows {
        bill_tuples.push(row.map_err(|e| e.to_string())?);
    }

    for t in bill_tuples {
        let customer: Option<CustomerForGstr1> = match &t.14 {
            Some(cid) => c
                .query_row(
                    "SELECT id, name, phone, gstin, address FROM customers WHERE id = ?1",
                    params![cid],
                    |r| {
                        let gstin: Option<String> = r.get(3)?;
                        let address: Option<String> = r.get(4)?;
                        let state_code = gstin.as_ref().and_then(|g| {
                            if g.len() >= 2 {
                                Some(g[0..2].to_string())
                            } else {
                                None
                            }
                        });
                        Ok(CustomerForGstr1 {
                            id: r.get(0)?,
                            name: r.get(1)?,
                            gstin,
                            state_code,
                            address,
                        })
                    },
                )
                .ok(),
            None => None,
        };

        // Lines — JOIN products for HSN
        let mut lstmt = c
            .prepare(
                "SELECT bl.id, bl.product_id, p.hsn, bl.gst_rate, bl.qty,
                        bl.taxable_value_paise, bl.cgst_paise, bl.sgst_paise,
                        bl.igst_paise, bl.cess_paise, bl.line_total_paise
                 FROM bill_lines bl
                 JOIN products p ON p.id = bl.product_id
                 WHERE bl.bill_id = ?1
                 ORDER BY rowid ASC",
            )
            .map_err(|e| e.to_string())?;
        let lrows = lstmt
            .query_map(params![t.0], |r| {
                Ok(BillLineForGstr1 {
                    id: r.get(0)?,
                    product_id: r.get(1)?,
                    hsn: r.get(2)?,
                    gst_rate: r.get(3)?,
                    qty: r.get(4)?,
                    taxable_value_paise: r.get(5)?,
                    cgst_paise: r.get(6)?,
                    sgst_paise: r.get(7)?,
                    igst_paise: r.get(8)?,
                    cess_paise: r.get(9)?,
                    line_total_paise: r.get(10)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut lines: Vec<BillLineForGstr1> = Vec::new();
        for lr in lrows {
            lines.push(lr.map_err(|e| e.to_string())?);
        }

        bills.push(BillForGstr1 {
            id: t.0,
            bill_no: t.1,
            billed_at: t.2,
            doc_series: t.3,
            gst_treatment: t.4,
            subtotal_paise: t.5,
            total_discount_paise: t.6,
            total_cgst_paise: t.7,
            total_sgst_paise: t.8,
            total_igst_paise: t.9,
            total_cess_paise: t.10,
            round_off_paise: t.11,
            grand_total_paise: t.12,
            is_voided: t.13,
            customer,
            lines,
        });
    }

    Ok(Gstr1InputOut {
        shop,
        bills,
        period,
    })
}

fn prev_month(mm: &str, yyyy: &str) -> (String, String) {
    let m: i64 = mm.parse().unwrap_or(1);
    let y: i64 = yyyy.parse().unwrap_or(2026);
    if m == 1 {
        (format!("{:02}", 12), format!("{:04}", y - 1))
    } else {
        (format!("{:02}", m - 1), yyyy.to_string())
    }
}

fn next_month(mm: &str, yyyy: &str) -> (String, String) {
    let m: i64 = mm.parse().unwrap_or(1);
    let y: i64 = yyyy.parse().unwrap_or(2026);
    if m == 12 {
        (format!("{:02}", 1), format!("{:04}", y + 1))
    } else {
        (format!("{:02}", m + 1), yyyy.to_string())
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGstr1ReturnInput {
    pub shop_id: String,
    pub period: String,
    pub json_blob: String,
    pub csv_b2b: String,
    pub csv_b2cl: String,
    pub csv_b2cs: String,
    pub csv_hsn: String,
    pub csv_exemp: String,
    pub csv_doc: String,
    pub hash_sha256: String,
    pub bill_count: i64,
    pub grand_total_paise: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GstReturnOut {
    pub id: String,
    pub shop_id: String,
    pub return_type: String,
    pub period: String,
    pub status: String,
    pub hash_sha256: String,
    pub bill_count: i64,
    pub grand_total_paise: i64,
    pub generated_at: String,
    pub filed_at: Option<String>,
    pub filed_by_user_id: Option<String>,
}

/// Persist a generated GSTR-1 return. Draft rows are upserted by unique
/// (shop_id, return_type, period, status); filed rows are immutable (regeneration
/// produces a new amended row instead).
#[tauri::command]
pub fn save_gstr1_return(
    input: SaveGstr1ReturnInput,
    state: State<DbState>,
) -> Result<GstReturnOut, String> {
    if input.period.len() != 6 {
        return Err(format!("PERIOD_INVALID:{}", input.period));
    }
    if input.hash_sha256.len() != 64 {
        return Err("HASH_INVALID".into());
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let c = &*conn;

    // Does a filed row already exist for this period? If so, this becomes 'amended'.
    let filed_exists: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM gst_returns
             WHERE shop_id = ?1 AND return_type = 'GSTR1' AND period = ?2 AND status = 'filed'",
            params![input.shop_id, input.period],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let status = if filed_exists > 0 { "amended" } else { "draft" };

    // If same (shop, period, status) row exists AND hash matches, no-op; else upsert.
    let existing: Option<(String, String)> = c
        .query_row(
            "SELECT id, hash_sha256 FROM gst_returns
             WHERE shop_id = ?1 AND return_type = 'GSTR1' AND period = ?2 AND status = ?3",
            params![input.shop_id, input.period, status],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();

    let id = match existing {
        Some((eid, ehash)) if ehash == input.hash_sha256 => {
            // No-op — return existing
            return read_gst_return(c, &eid);
        }
        Some((eid, _)) => {
            c.execute(
                "UPDATE gst_returns
                 SET json_blob=?2, csv_b2b=?3, csv_b2cl=?4, csv_b2cs=?5, csv_hsn=?6, csv_exemp=?7, csv_doc=?8,
                     hash_sha256=?9, bill_count=?10, grand_total_paise=?11,
                     generated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE id=?1",
                params![
                    eid,
                    input.json_blob,
                    input.csv_b2b,
                    input.csv_b2cl,
                    input.csv_b2cs,
                    input.csv_hsn,
                    input.csv_exemp,
                    input.csv_doc,
                    input.hash_sha256,
                    input.bill_count,
                    input.grand_total_paise
                ],
            )
            .map_err(|e| e.to_string())?;
            eid
        }
        None => {
            let new_id = format!("gr_{}", chrono::Utc::now().timestamp_millis());
            c.execute(
                "INSERT INTO gst_returns
                 (id, shop_id, return_type, period, status,
                  json_blob, csv_b2b, csv_b2cl, csv_b2cs, csv_hsn, csv_exemp, csv_doc,
                  hash_sha256, bill_count, grand_total_paise)
                 VALUES (?1, ?2, 'GSTR1', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    new_id,
                    input.shop_id,
                    input.period,
                    status,
                    input.json_blob,
                    input.csv_b2b,
                    input.csv_b2cl,
                    input.csv_b2cs,
                    input.csv_hsn,
                    input.csv_exemp,
                    input.csv_doc,
                    input.hash_sha256,
                    input.bill_count,
                    input.grand_total_paise
                ],
            )
            .map_err(|e| e.to_string())?;
            new_id
        }
    };

    read_gst_return(c, &id)
}

fn read_gst_return(c: &Connection, id: &str) -> Result<GstReturnOut, String> {
    c.query_row(
        "SELECT id, shop_id, return_type, period, status, hash_sha256,
                bill_count, grand_total_paise, generated_at, filed_at, filed_by_user_id
         FROM gst_returns WHERE id = ?1",
        params![id],
        |r| {
            Ok(GstReturnOut {
                id: r.get(0)?,
                shop_id: r.get(1)?,
                return_type: r.get(2)?,
                period: r.get(3)?,
                status: r.get(4)?,
                hash_sha256: r.get(5)?,
                bill_count: r.get(6)?,
                grand_total_paise: r.get(7)?,
                generated_at: r.get(8)?,
                filed_at: r.get(9)?,
                filed_by_user_id: r.get(10)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_gst_returns(
    shop_id: String,
    state: State<DbState>,
) -> Result<Vec<GstReturnOut>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let c = &*conn;
    let mut stmt = c
        .prepare(
            "SELECT id, shop_id, return_type, period, status, hash_sha256,
                    bill_count, grand_total_paise, generated_at, filed_at, filed_by_user_id
             FROM gst_returns WHERE shop_id = ?1
             ORDER BY period DESC, generated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![shop_id], |r| {
            Ok(GstReturnOut {
                id: r.get(0)?,
                shop_id: r.get(1)?,
                return_type: r.get(2)?,
                period: r.get(3)?,
                status: r.get(4)?,
                hash_sha256: r.get(5)?,
                bill_count: r.get(6)?,
                grand_total_paise: r.get(7)?,
                generated_at: r.get(8)?,
                filed_at: r.get(9)?,
                filed_by_user_id: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkFiledInput {
    pub return_id: String,
    pub actor_user_id: String,
}

/// Flip a draft return → filed. Owner-role gate; back-fills bills.filed_period
/// for all bills whose billed_at substring matches the period (approximate — TS
/// layer has already filtered by IST; this is a defensive coverage stamp).
#[tauri::command]
pub fn mark_gstr1_filed(
    input: MarkFiledInput,
    state: State<DbState>,
) -> Result<GstReturnOut, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let c = &*conn;

    // Actor must be owner + active (same gate as record_expiry_override)
    let (role, active): (String, i64) = c
        .query_row(
            "SELECT role, is_active FROM users WHERE id = ?1",
            params![input.actor_user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("USER_NOT_FOUND:{}", e))?;
    if active != 1 {
        return Err("USER_INACTIVE".into());
    }
    if role != "owner" {
        return Err(format!("ROLE_REQUIRED:owner:got={}", role));
    }

    // Return must be draft or amended
    let (shop_id, period, status): (String, String, String) = c
        .query_row(
            "SELECT shop_id, period, status FROM gst_returns WHERE id = ?1",
            params![input.return_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| format!("RETURN_NOT_FOUND:{}", e))?;

    if status != "draft" && status != "amended" {
        return Err(format!("INVALID_STATUS:{}", status));
    }

    // Flip → filed
    c.execute(
        "UPDATE gst_returns
         SET status = 'filed',
             filed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             filed_by_user_id = ?2
         WHERE id = ?1",
        params![input.return_id, input.actor_user_id],
    )
    .map_err(|e| e.to_string())?;

    // Back-fill bills.filed_period for in-period bills (same approx match as generate)
    let yyyy = &period[2..6];
    let mm = &period[0..2];
    let pattern = format!("{}-{}", yyyy, mm);
    c.execute(
        "UPDATE bills
         SET filed_period = ?2
         WHERE shop_id = ?1
           AND substr(billed_at,1,7) = ?3
           AND filed_period IS NULL
           AND is_voided = 0",
        params![shop_id, period, pattern],
    )
    .map_err(|e| e.to_string())?;

    read_gst_return(c, &input.return_id)
}

// =============================================================================
// A11 · Stock reconcile (ADR 0016, migration 0015)
// =============================================================================
// Physical-count sessions → preview variance → owner finalizes → writes
// stock_adjustments + stock_movements rows and back-fills batches.qty_on_hand
// inside a single transaction.

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CountSessionOut {
    pub id: String,
    pub shop_id: String,
    pub title: String,
    pub status: String,
    pub opened_by: String,
    pub opened_at: String,
    pub finalized_by: Option<String>,
    pub finalized_at: Option<String>,
    pub line_count: i64,
    pub adjustment_count: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCountSessionInput {
    pub shop_id: String,
    pub title: String,
    pub opened_by_user_id: String,
}

#[tauri::command]
pub fn open_count_session(
    input: OpenCountSessionInput,
    state: State<DbState>,
) -> Result<CountSessionOut, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    // Validate the user belongs to the shop and is active.
    let (role, is_active): (String, i64) = c
        .query_row(
            "SELECT role, is_active FROM users WHERE id = ?1 AND shop_id = ?2",
            params![input.opened_by_user_id, input.shop_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "UNKNOWN_USER".to_string())?;
    if is_active != 1 {
        return Err("USER_INACTIVE".to_string());
    }
    if role != "owner" && role != "pharmacist" && role != "cashier" {
        return Err("FORBIDDEN_ROLE".to_string());
    }
    let id = gen_id("pc");
    c.execute(
        "INSERT INTO physical_counts (id, shop_id, title, opened_by) VALUES (?1, ?2, ?3, ?4)",
        params![id, input.shop_id, input.title, input.opened_by_user_id],
    )
    .map_err(|e| e.to_string())?;
    read_count_session(&c, &id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordCountLineInput {
    pub session_id: String,
    pub batch_id: String,
    pub counted_qty: i64,
    pub counted_by_user_id: String,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn record_count_line(input: RecordCountLineInput, state: State<DbState>) -> Result<(), String> {
    if input.counted_qty < 0 {
        return Err("NEGATIVE_QTY".to_string());
    }
    let c = state.0.lock().map_err(|e| e.to_string())?;
    // Session must be open.
    let status: String = c
        .query_row(
            "SELECT status FROM physical_counts WHERE id = ?1",
            params![input.session_id],
            |r| r.get(0),
        )
        .map_err(|_| "UNKNOWN_SESSION".to_string())?;
    if status != "open" {
        return Err(format!("SESSION_{}", status.to_uppercase()));
    }
    // Batch must exist.
    let product_id: String = c
        .query_row(
            "SELECT product_id FROM batches WHERE id = ?1",
            params![input.batch_id],
            |r| r.get(0),
        )
        .map_err(|_| "UNKNOWN_BATCH".to_string())?;

    // Is there already a line? If yes, append to revisions + overwrite qty.
    let existing: Option<(String, i64, Option<String>, String)> = c
        .query_row(
            "SELECT id, counted_qty, notes, revisions FROM physical_count_lines
             WHERE physical_count_id = ?1 AND batch_id = ?2",
            params![input.session_id, input.batch_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok();

    if let Some((line_id, old_qty, old_notes, revisions)) = existing {
        // Append revision entry.
        let rev_json = {
            let old_notes_json = match old_notes {
                Some(n) => serde_json::to_string(&n).unwrap_or_else(|_| "null".into()),
                None => "null".into(),
            };
            let now = current_iso();
            let new_entry = format!(
                r#"{{"ts":"{}","by":"{}","old_qty":{},"old_notes":{}}}"#,
                now, input.counted_by_user_id, old_qty, old_notes_json
            );
            // Parse existing JSON array → push new entry → stringify.
            let mut arr: serde_json::Value =
                serde_json::from_str(&revisions).unwrap_or(serde_json::Value::Array(vec![]));
            if let Some(v) = arr.as_array_mut() {
                let parsed: serde_json::Value =
                    serde_json::from_str(&new_entry).unwrap_or(serde_json::Value::Null);
                v.push(parsed);
            }
            arr.to_string()
        };
        c.execute(
            "UPDATE physical_count_lines
             SET counted_qty = ?1, counted_by = ?2, counted_at = ?3, notes = ?4, revisions = ?5
             WHERE id = ?6",
            params![
                input.counted_qty,
                input.counted_by_user_id,
                current_iso(),
                input.notes,
                rev_json,
                line_id,
            ],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let line_id = gen_id("pcl");
        c.execute(
            "INSERT INTO physical_count_lines
             (id, physical_count_id, batch_id, product_id, counted_qty, counted_by, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                line_id,
                input.session_id,
                input.batch_id,
                product_id,
                input.counted_qty,
                input.counted_by_user_id,
                input.notes,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchStateRow {
    pub batch_id: String,
    pub product_id: String,
    pub product_name: String,
    pub batch_no: String,
    pub expiry_date: String,
    pub system_qty: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CountLineRow {
    pub batch_id: String,
    pub product_id: String,
    pub counted_qty: i64,
    pub counted_by: String,
    pub counted_at: String,
    pub notes: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CountSessionSnapshot {
    pub session: CountSessionOut,
    pub system: Vec<BatchStateRow>,
    pub lines: Vec<CountLineRow>,
}

#[tauri::command]
pub fn get_count_session(
    session_id: String,
    state: State<DbState>,
) -> Result<CountSessionSnapshot, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let session = read_count_session(&c, &session_id)?;
    // Load the full shop's batch state — UI filters on client.
    let mut stmt = c
        .prepare(
            "SELECT b.id, b.product_id, p.name, b.batch_no, b.expiry_date, b.qty_on_hand
             FROM batches b
             JOIN products p ON p.id = b.product_id
             WHERE b.qty_on_hand >= 0
             ORDER BY p.name ASC, b.expiry_date ASC",
        )
        .map_err(|e| e.to_string())?;
    let system: Vec<BatchStateRow> = stmt
        .query_map([], |r| {
            Ok(BatchStateRow {
                batch_id: r.get(0)?,
                product_id: r.get(1)?,
                product_name: r.get(2)?,
                batch_no: r.get(3)?,
                expiry_date: r.get(4)?,
                system_qty: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut stmt2 = c
        .prepare(
            "SELECT batch_id, product_id, counted_qty, counted_by, counted_at, notes
             FROM physical_count_lines
             WHERE physical_count_id = ?1
             ORDER BY counted_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let lines: Vec<CountLineRow> = stmt2
        .query_map(params![session_id], |r| {
            Ok(CountLineRow {
                batch_id: r.get(0)?,
                product_id: r.get(1)?,
                counted_qty: r.get(2)?,
                counted_by: r.get(3)?,
                counted_at: r.get(4)?,
                notes: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(CountSessionSnapshot {
        session,
        system,
        lines,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeDecision {
    pub batch_id: String,
    pub counted_qty: i64,
    pub reason_code: String,
    pub reason_notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeCountInput {
    pub session_id: String,
    pub actor_user_id: String,
    pub decisions: Vec<FinalizeDecision>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeCountOut {
    pub session_id: String,
    pub adjustments_written: usize,
    pub net_delta: i64,
    pub finalized_at: String,
}

#[tauri::command]
pub fn finalize_count(
    input: FinalizeCountInput,
    state: State<DbState>,
) -> Result<FinalizeCountOut, String> {
    let mut c = state.0.lock().map_err(|e| e.to_string())?;
    // Owner-gate (defence in depth).
    let (role, is_active): (String, i64) = c
        .query_row(
            "SELECT role, is_active FROM users WHERE id = ?1",
            params![input.actor_user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "UNKNOWN_USER".to_string())?;
    if is_active != 1 {
        return Err("USER_INACTIVE".to_string());
    }
    if role != "owner" {
        return Err("FORBIDDEN_ROLE".to_string());
    }

    let allowed_reasons = [
        "shrinkage",
        "damage",
        "expiry_dump",
        "data_entry_error",
        "theft",
        "transfer_out",
        "other",
    ];
    for d in &input.decisions {
        if !allowed_reasons.contains(&d.reason_code.as_str()) {
            return Err(format!("INVALID_REASON:{}", d.reason_code));
        }
        if d.counted_qty < 0 {
            return Err(format!("NEGATIVE_QTY:{}", d.batch_id));
        }
    }

    let status: String = c
        .query_row(
            "SELECT status FROM physical_counts WHERE id = ?1",
            params![input.session_id],
            |r| r.get(0),
        )
        .map_err(|_| "UNKNOWN_SESSION".to_string())?;
    if status != "open" {
        return Err(format!("SESSION_{}", status.to_uppercase()));
    }

    let tx = c.transaction().map_err(|e| e.to_string())?;
    let mut written = 0usize;
    let mut net_delta: i64 = 0;

    for d in &input.decisions {
        // Pull system_qty + product_id fresh inside the transaction.
        let (product_id, system_qty): (String, i64) = tx
            .query_row(
                "SELECT product_id, qty_on_hand FROM batches WHERE id = ?1",
                params![d.batch_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| format!("UNKNOWN_BATCH:{}", d.batch_id))?;
        let delta = d.counted_qty - system_qty;
        if delta == 0 {
            continue; // matches aren't written
        }
        let adj_id = gen_id("adj");
        tx.execute(
            "INSERT INTO stock_adjustments
             (id, physical_count_id, batch_id, product_id,
              system_qty_before, counted_qty, qty_delta,
              reason_code, reason_notes, created_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                adj_id,
                input.session_id,
                d.batch_id,
                product_id,
                system_qty,
                d.counted_qty,
                delta,
                d.reason_code,
                d.reason_notes,
                input.actor_user_id,
            ],
        )
        .map_err(|e| e.to_string())?;

        // Stock movement (ledger row).
        let mv_id = gen_id("mv_adj");
        tx.execute(
            "INSERT INTO stock_movements
             (id, batch_id, product_id, qty_delta, movement_type,
              ref_table, ref_id, actor_id, reason)
             VALUES (?1, ?2, ?3, ?4, 'adjust', 'stock_adjustments', ?5, ?6, ?7)",
            params![
                mv_id,
                d.batch_id,
                product_id,
                delta,
                adj_id,
                input.actor_user_id,
                d.reason_code,
            ],
        )
        .map_err(|e| e.to_string())?;

        // Back-fill qty_on_hand.
        tx.execute(
            "UPDATE batches SET qty_on_hand = ?1 WHERE id = ?2",
            params![d.counted_qty, d.batch_id],
        )
        .map_err(|e| e.to_string())?;

        written += 1;
        net_delta += delta;
    }

    // Mark session finalized.
    let finalized_at = current_iso();
    tx.execute(
        "UPDATE physical_counts
         SET status = 'finalized', finalized_by = ?2, finalized_at = ?3
         WHERE id = ?1",
        params![input.session_id, input.actor_user_id, finalized_at],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(FinalizeCountOut {
        session_id: input.session_id,
        adjustments_written: written,
        net_delta,
        finalized_at,
    })
}

#[tauri::command]
pub fn cancel_count_session(
    session_id: String,
    actor_user_id: String,
    state: State<DbState>,
) -> Result<CountSessionOut, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let (role, is_active): (String, i64) = c
        .query_row(
            "SELECT role, is_active FROM users WHERE id = ?1",
            params![actor_user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "UNKNOWN_USER".to_string())?;
    if is_active != 1 {
        return Err("USER_INACTIVE".to_string());
    }
    if role != "owner" {
        return Err("FORBIDDEN_ROLE".to_string());
    }
    let status: String = c
        .query_row(
            "SELECT status FROM physical_counts WHERE id = ?1",
            params![session_id],
            |r| r.get(0),
        )
        .map_err(|_| "UNKNOWN_SESSION".to_string())?;
    if status != "open" {
        return Err(format!("SESSION_{}", status.to_uppercase()));
    }
    c.execute(
        "UPDATE physical_counts
         SET status = 'cancelled', cancelled_by = ?2, cancelled_at = ?3
         WHERE id = ?1",
        params![session_id, actor_user_id, current_iso()],
    )
    .map_err(|e| e.to_string())?;
    read_count_session(&c, &session_id)
}

#[tauri::command]
pub fn list_count_sessions(
    shop_id: String,
    limit: Option<i64>,
    state: State<DbState>,
) -> Result<Vec<CountSessionOut>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let n = limit.unwrap_or(50).clamp(1, 500);
    let mut stmt = c
        .prepare(
            "SELECT pc.id, pc.shop_id, pc.title, pc.status, pc.opened_by, pc.opened_at,
                    pc.finalized_by, pc.finalized_at,
                    (SELECT COUNT(*) FROM physical_count_lines WHERE physical_count_id = pc.id),
                    (SELECT COUNT(*) FROM stock_adjustments    WHERE physical_count_id = pc.id)
             FROM physical_counts pc
             WHERE pc.shop_id = ?1
             ORDER BY pc.opened_at DESC
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<CountSessionOut> = stmt
        .query_map(params![shop_id, n], |r| {
            Ok(CountSessionOut {
                id: r.get(0)?,
                shop_id: r.get(1)?,
                title: r.get(2)?,
                status: r.get(3)?,
                opened_by: r.get(4)?,
                opened_at: r.get(5)?,
                finalized_by: r.get(6)?,
                finalized_at: r.get(7)?,
                line_count: r.get(8)?,
                adjustment_count: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn read_count_session(c: &Connection, id: &str) -> Result<CountSessionOut, String> {
    c.query_row(
        "SELECT pc.id, pc.shop_id, pc.title, pc.status, pc.opened_by, pc.opened_at,
                pc.finalized_by, pc.finalized_at,
                (SELECT COUNT(*) FROM physical_count_lines WHERE physical_count_id = pc.id),
                (SELECT COUNT(*) FROM stock_adjustments    WHERE physical_count_id = pc.id)
         FROM physical_counts pc
         WHERE pc.id = ?1",
        params![id],
        |r| {
            Ok(CountSessionOut {
                id: r.get(0)?,
                shop_id: r.get(1)?,
                title: r.get(2)?,
                status: r.get(3)?,
                opened_by: r.get(4)?,
                opened_at: r.get(5)?,
                finalized_by: r.get(6)?,
                finalized_at: r.get(7)?,
                line_count: r.get(8)?,
                adjustment_count: r.get(9)?,
            })
        },
    )
    .map_err(|e| format!("SESSION_NOT_FOUND:{}", e))
}

// ============================================================================
// A12 — E-invoice IRN — Cygnet primary, ClearTax secondary, MockAdapter for tests
// ============================================================================

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IrnPartyOut {
    pub gstin: String,
    pub legal_name: String,
    pub address1: String,
    pub location: String,
    pub pincode: i64,
    pub state_code: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IrnLineOut {
    pub sl_no: i64,
    pub product_name: String,
    pub hsn: String,
    pub qty: f64,
    pub unit: Option<String>,
    pub mrp_paise: i64,
    pub discount_paise: i64,
    pub taxable_value_paise: i64,
    pub gst_rate: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub line_total_paise: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IrnBillOut {
    pub bill_id: String,
    pub bill_no: String,
    pub billed_at_iso: String,
    pub gst_treatment: String,
    pub subtotal_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub round_off_paise: i64,
    pub grand_total_paise: i64,
    pub seller: IrnPartyOut,
    pub buyer: IrnPartyOut,
    pub lines: Vec<IrnLineOut>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IrnShopOut {
    pub annual_turnover_paise: i64,
    pub einvoice_enabled: bool,
    pub einvoice_vendor: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IrnPayloadOut {
    pub shop: IrnShopOut,
    pub bill: IrnBillOut,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IrnRecordOut {
    pub id: String,
    pub bill_id: String,
    pub shop_id: String,
    pub vendor: String,
    pub status: String,
    pub irn: Option<String>,
    pub ack_no: Option<String>,
    pub ack_date: Option<String>,
    pub signed_invoice: Option<String>,
    pub qr_code: Option<String>,
    pub error_code: Option<String>,
    pub error_msg: Option<String>,
    pub attempt_count: i64,
    pub last_attempt_at: Option<String>,
    pub submitted_at: Option<String>,
    pub cancelled_at: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubmitIrnInput {
    pub bill_id: String,
    pub actor_user_id: String,
    /// When "mock", uses the in-process mock adapter. Otherwise routed to the
    /// shop's configured vendor (Cygnet default).
    pub vendor_override: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CancelIrnInput {
    pub irn_record_id: String,
    pub actor_user_id: String,
    pub cancel_reason: String,
    pub cancel_remarks: Option<String>,
}

/// Pluggable adapter. A real CygnetAdapter would wrap reqwest; shipped as
/// a stubbed impl until the vendor contract signs. MockAdapter is what
/// tests + demo pilots use.
pub trait EinvoiceAdapter: Send + Sync {
    fn vendor_name(&self) -> &'static str;
    fn submit(&self, payload: &IrnPayloadOut) -> Result<IrnAckInner, IrnErrorInner>;
    fn cancel(&self, irn: &str, reason: &str, remarks: &str) -> Result<(), IrnErrorInner>;
}

#[derive(Debug, Clone)]
pub struct IrnAckInner {
    pub irn: String,
    pub ack_no: String,
    pub ack_date: String,
    pub signed_invoice: String,
    pub qr_code: String,
}

#[derive(Debug, Clone)]
pub struct IrnErrorInner {
    pub code: String,
    pub msg: String,
}

pub struct MockAdapter;

impl EinvoiceAdapter for MockAdapter {
    fn vendor_name(&self) -> &'static str {
        "mock"
    }
    fn submit(&self, payload: &IrnPayloadOut) -> Result<IrnAckInner, IrnErrorInner> {
        Ok(IrnAckInner {
            irn: format!("IRN_{}_{}", payload.bill.bill_id, current_iso()),
            ack_no: format!("ACK_{}", payload.bill.bill_no),
            ack_date: current_iso(),
            signed_invoice: format!("SIGNED({})", payload.bill.bill_no),
            qr_code: format!("QR({})", payload.bill.bill_no),
        })
    }
    fn cancel(&self, _irn: &str, _reason: &str, _remarks: &str) -> Result<(), IrnErrorInner> {
        Ok(())
    }
}

/// Placeholder impl — the real wire call lands once the Cygnet contract closes.
/// Kept behind a feature flag at shop level (`einvoice_enabled`) so it's
/// impossible to accidentally submit real invoices with this stub.
pub struct CygnetAdapter;
impl EinvoiceAdapter for CygnetAdapter {
    fn vendor_name(&self) -> &'static str {
        "cygnet"
    }
    fn submit(&self, _payload: &IrnPayloadOut) -> Result<IrnAckInner, IrnErrorInner> {
        Err(IrnErrorInner {
            code: "ADAPTER_NOT_IMPLEMENTED".to_string(),
            msg: "Cygnet adapter stub — real HTTP wire not yet wired up; contract pending"
                .to_string(),
        })
    }
    fn cancel(&self, _irn: &str, _reason: &str, _remarks: &str) -> Result<(), IrnErrorInner> {
        Err(IrnErrorInner {
            code: "ADAPTER_NOT_IMPLEMENTED".to_string(),
            msg: "Cygnet cancel stub".to_string(),
        })
    }
}

pub struct ClearTaxAdapter;
impl EinvoiceAdapter for ClearTaxAdapter {
    fn vendor_name(&self) -> &'static str {
        "cleartax"
    }
    fn submit(&self, _payload: &IrnPayloadOut) -> Result<IrnAckInner, IrnErrorInner> {
        Err(IrnErrorInner {
            code: "ADAPTER_NOT_IMPLEMENTED".to_string(),
            msg: "ClearTax adapter stub — secondary vendor plan, contract pending".to_string(),
        })
    }
    fn cancel(&self, _irn: &str, _reason: &str, _remarks: &str) -> Result<(), IrnErrorInner> {
        Err(IrnErrorInner {
            code: "ADAPTER_NOT_IMPLEMENTED".to_string(),
            msg: "ClearTax cancel stub".to_string(),
        })
    }
}

fn adapter_for(vendor: &str) -> Box<dyn EinvoiceAdapter> {
    match vendor {
        "mock" => Box::new(MockAdapter),
        "cygnet" => Box::new(CygnetAdapter),
        "cleartax" => Box::new(ClearTaxAdapter),
        _ => Box::new(CygnetAdapter),
    }
}

/// Build the IRN payload from a saved bill. Read-only.
#[tauri::command]
pub fn generate_irn_payload(
    bill_id: String,
    state: State<DbState>,
) -> Result<IrnPayloadOut, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Shop row for the bill
    let (
        shop_id,
        shop_gstin,
        shop_name,
        shop_state_code,
        shop_address,
        turnover,
        einvoice_enabled,
        einvoice_vendor,
    ): (String, String, String, String, String, i64, i64, String) = db
        .query_row(
            "SELECT s.id, s.gstin, s.name, s.state_code, s.address,
                    s.annual_turnover_paise, s.einvoice_enabled, s.einvoice_vendor
             FROM bills b JOIN shops s ON s.id = b.shop_id
             WHERE b.id = ?1",
            rusqlite::params![bill_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            },
        )
        .map_err(|e| format!("BILL_NOT_FOUND:{}", e))?;

    // Bill header
    let (
        bill_no,
        billed_at,
        gst_treatment,
        subtotal,
        cgst,
        sgst,
        igst,
        round_off,
        grand_total,
        customer_id,
    ): (
        String,
        String,
        String,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        Option<String>,
    ) = db
        .query_row(
            "SELECT bill_no, billed_at, gst_treatment, subtotal_paise,
                    total_cgst_paise, total_sgst_paise, total_igst_paise,
                    round_off_paise, grand_total_paise, customer_id
             FROM bills WHERE id = ?1",
            rusqlite::params![bill_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                ))
            },
        )
        .map_err(|e| format!("BILL_ROW_ERR:{}", e))?;

    // Customer / buyer (required for B2B IRN)
    let (buyer_gstin, buyer_name, buyer_address): (String, String, String) =
        if let Some(cid) = &customer_id {
            db.query_row(
                "SELECT COALESCE(gstin,''), name, COALESCE(address,'')
                 FROM customers WHERE id = ?1",
                rusqlite::params![cid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|e| format!("CUSTOMER_ERR:{}", e))?
        } else {
            (String::new(), String::new(), String::new())
        };

    // Lines
    let mut stmt = db
        .prepare(
            "SELECT bl.product_id, p.name, p.hsn,
                    bl.qty, bl.mrp_paise, bl.discount_paise, bl.taxable_value_paise,
                    bl.gst_rate, bl.cgst_paise, bl.sgst_paise, bl.igst_paise,
                    bl.line_total_paise
             FROM bill_lines bl
             JOIN products p ON p.id = bl.product_id
             WHERE bl.bill_id = ?1
             ORDER BY rowid ASC",
        )
        .map_err(|e| e.to_string())?;
    let mut lines: Vec<IrnLineOut> = Vec::new();
    let line_iter = stmt
        .query_map(rusqlite::params![bill_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, f64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, i64>(7)?,
                r.get::<_, i64>(8)?,
                r.get::<_, i64>(9)?,
                r.get::<_, i64>(10)?,
                r.get::<_, i64>(11)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut sl: i64 = 1;
    for row in line_iter {
        let (_pid, pname, hsn, qty, mrp, disc, taxable, rate, cg, sg, ig, total) =
            row.map_err(|e| e.to_string())?;
        lines.push(IrnLineOut {
            sl_no: sl,
            product_name: pname,
            hsn: hsn.unwrap_or_default(),
            qty,
            unit: None,
            mrp_paise: mrp,
            discount_paise: disc,
            taxable_value_paise: taxable,
            gst_rate: rate,
            cgst_paise: cg,
            sgst_paise: sg,
            igst_paise: ig,
            line_total_paise: total,
        });
        sl += 1;
    }

    Ok(IrnPayloadOut {
        shop: IrnShopOut {
            annual_turnover_paise: turnover,
            einvoice_enabled: einvoice_enabled != 0,
            einvoice_vendor,
        },
        bill: IrnBillOut {
            bill_id,
            bill_no,
            billed_at_iso: billed_at,
            gst_treatment,
            subtotal_paise: subtotal,
            cgst_paise: cgst,
            sgst_paise: sgst,
            igst_paise: igst,
            round_off_paise: round_off,
            grand_total_paise: grand_total,
            seller: IrnPartyOut {
                gstin: shop_gstin,
                legal_name: shop_name,
                address1: shop_address,
                location: String::new(),
                pincode: 0,
                state_code: shop_state_code,
            },
            buyer: IrnPartyOut {
                gstin: buyer_gstin,
                legal_name: buyer_name,
                address1: buyer_address,
                location: String::new(),
                pincode: 0,
                state_code: String::new(),
            },
            lines,
        },
    })
}

/// Submit the IRN. Validates turnover + einvoice_enabled, opens a transaction,
/// writes irn_records(status=pending) → calls adapter → on success updates
/// status=acked with ack fields → on failure updates status=failed.
/// Always increments attempt_count and writes einvoice_audit.
#[tauri::command]
pub fn submit_irn(input: SubmitIrnInput, state: State<DbState>) -> Result<IrnRecordOut, String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;

    // Re-read shop row for defense-in-depth turnover gate
    let (shop_id, einvoice_enabled, shop_vendor, turnover): (String, i64, String, i64) = db
        .query_row(
            "SELECT s.id, s.einvoice_enabled, s.einvoice_vendor, s.annual_turnover_paise
             FROM bills b JOIN shops s ON s.id = b.shop_id WHERE b.id = ?1",
            rusqlite::params![input.bill_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| format!("BILL_NOT_FOUND:{}", e))?;

    if einvoice_enabled == 0 {
        return Err("EINVOICE_DISABLED".to_string());
    }
    if turnover <= 5_00_00_000_00 {
        return Err("TURNOVER_BELOW_THRESHOLD".to_string());
    }

    // Validate actor exists + is_active
    let (actor_active,): (i64,) = db
        .query_row(
            "SELECT is_active FROM users WHERE id = ?1",
            rusqlite::params![input.actor_user_id],
            |r| Ok((r.get(0)?,)),
        )
        .map_err(|e| format!("USER_NOT_FOUND:{}", e))?;
    if actor_active == 0 {
        return Err("USER_INACTIVE".to_string());
    }

    // Build payload via the same reader, but inline the query to stay under one lock
    let payload = drop_and_generate(&mut db, &input.bill_id)?;

    let vendor = input.vendor_override.clone().unwrap_or(shop_vendor);
    let record_id = gen_id("irn");
    let payload_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let now = current_iso();

    let tx = db.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO irn_records(
            id, bill_id, shop_id, vendor, status, payload_json,
            attempt_count, last_attempt_at, actor_user_id, created_at
         ) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, 0, ?6, ?7, ?8)",
        rusqlite::params![
            record_id,
            input.bill_id,
            shop_id,
            vendor,
            payload_json,
            now,
            input.actor_user_id,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Audit: submit_attempt
    tx.execute(
        "INSERT INTO einvoice_audit(id, irn_record_id, event, actor_user_id, shop_id, details, at)
         VALUES (?1, ?2, 'submit_attempt', ?3, ?4, ?5, ?6)",
        rusqlite::params![
            gen_id("ea"),
            record_id,
            input.actor_user_id,
            shop_id,
            format!("{{\"vendor\":\"{}\"}}", vendor),
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Call adapter outside DB lock risk — but trait is sync and fast enough for tests
    let adapter = adapter_for(&vendor);
    let submit_result = adapter.submit(&payload);

    match submit_result {
        Ok(ack) => {
            tx.execute(
                "UPDATE irn_records SET
                    status = 'acked',
                    irn = ?1, ack_no = ?2, ack_date = ?3,
                    signed_invoice = ?4, qr_code = ?5,
                    attempt_count = attempt_count + 1,
                    last_attempt_at = ?6, submitted_at = ?6
                 WHERE id = ?7",
                rusqlite::params![
                    ack.irn,
                    ack.ack_no,
                    ack.ack_date,
                    ack.signed_invoice,
                    ack.qr_code,
                    now,
                    record_id,
                ],
            )
            .map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO einvoice_audit(id, irn_record_id, event, actor_user_id, shop_id, at)
                 VALUES (?1, ?2, 'submit_success', ?3, ?4, ?5)",
                rusqlite::params![gen_id("ea"), record_id, input.actor_user_id, shop_id, now,],
            )
            .map_err(|e| e.to_string())?;
        }
        Err(err) => {
            tx.execute(
                "UPDATE irn_records SET
                    status = 'failed',
                    error_code = ?1, error_msg = ?2,
                    attempt_count = attempt_count + 1,
                    last_attempt_at = ?3
                 WHERE id = ?4",
                rusqlite::params![err.code, err.msg, now, record_id],
            )
            .map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO einvoice_audit(id, irn_record_id, event, actor_user_id, shop_id, details, at)
                 VALUES (?1, ?2, 'submit_failure', ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    gen_id("ea"),
                    record_id,
                    input.actor_user_id,
                    shop_id,
                    format!("{{\"code\":\"{}\"}}", err.code),
                    now,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    // Re-read the row for return
    read_irn_record(&db, &record_id)
}

/// Internal helper: build payload out-of-band without owning the outer lock
/// (we already hold it; the function is sync).
fn drop_and_generate(
    db: &mut rusqlite::Connection,
    bill_id: &str,
) -> Result<IrnPayloadOut, String> {
    let (
        _shop_id,
        shop_gstin,
        shop_name,
        shop_state_code,
        shop_address,
        turnover,
        einvoice_enabled,
        einvoice_vendor,
    ): (String, String, String, String, String, i64, i64, String) = db
        .query_row(
            "SELECT s.id, s.gstin, s.name, s.state_code, s.address,
                    s.annual_turnover_paise, s.einvoice_enabled, s.einvoice_vendor
             FROM bills b JOIN shops s ON s.id = b.shop_id
             WHERE b.id = ?1",
            rusqlite::params![bill_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            },
        )
        .map_err(|e| format!("BILL_NOT_FOUND:{}", e))?;

    let (
        bill_no,
        billed_at,
        gst_treatment,
        subtotal,
        cgst,
        sgst,
        igst,
        round_off,
        grand_total,
        customer_id,
    ): (
        String,
        String,
        String,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        Option<String>,
    ) = db
        .query_row(
            "SELECT bill_no, billed_at, gst_treatment, subtotal_paise,
                    total_cgst_paise, total_sgst_paise, total_igst_paise,
                    round_off_paise, grand_total_paise, customer_id
             FROM bills WHERE id = ?1",
            rusqlite::params![bill_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                ))
            },
        )
        .map_err(|e| format!("BILL_ROW_ERR:{}", e))?;

    let (buyer_gstin, buyer_name, buyer_address): (String, String, String) =
        if let Some(cid) = &customer_id {
            db.query_row(
                "SELECT COALESCE(gstin,''), name, COALESCE(address,'')
             FROM customers WHERE id = ?1",
                rusqlite::params![cid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|e| format!("CUSTOMER_ERR:{}", e))?
        } else {
            (String::new(), String::new(), String::new())
        };

    let mut lines: Vec<IrnLineOut> = Vec::new();
    {
        let mut stmt = db
            .prepare(
                "SELECT p.name, p.hsn, bl.qty, bl.mrp_paise, bl.discount_paise,
                        bl.taxable_value_paise, bl.gst_rate, bl.cgst_paise,
                        bl.sgst_paise, bl.igst_paise, bl.line_total_paise
                 FROM bill_lines bl
                 JOIN products p ON p.id = bl.product_id
                 WHERE bl.bill_id = ?1
                 ORDER BY rowid ASC",
            )
            .map_err(|e| e.to_string())?;
        let it = stmt
            .query_map(rusqlite::params![bill_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, f64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, i64>(7)?,
                    r.get::<_, i64>(8)?,
                    r.get::<_, i64>(9)?,
                    r.get::<_, i64>(10)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut sl: i64 = 1;
        for row in it {
            let (pname, hsn, qty, mrp, disc, taxable, rate, cg, sg, ig, total) =
                row.map_err(|e| e.to_string())?;
            lines.push(IrnLineOut {
                sl_no: sl,
                product_name: pname,
                hsn: hsn.unwrap_or_default(),
                qty,
                unit: None,
                mrp_paise: mrp,
                discount_paise: disc,
                taxable_value_paise: taxable,
                gst_rate: rate,
                cgst_paise: cg,
                sgst_paise: sg,
                igst_paise: ig,
                line_total_paise: total,
            });
            sl += 1;
        }
    }

    Ok(IrnPayloadOut {
        shop: IrnShopOut {
            annual_turnover_paise: turnover,
            einvoice_enabled: einvoice_enabled != 0,
            einvoice_vendor,
        },
        bill: IrnBillOut {
            bill_id: bill_id.to_string(),
            bill_no,
            billed_at_iso: billed_at,
            gst_treatment,
            subtotal_paise: subtotal,
            cgst_paise: cgst,
            sgst_paise: sgst,
            igst_paise: igst,
            round_off_paise: round_off,
            grand_total_paise: grand_total,
            seller: IrnPartyOut {
                gstin: shop_gstin,
                legal_name: shop_name,
                address1: shop_address,
                location: String::new(),
                pincode: 0,
                state_code: shop_state_code,
            },
            buyer: IrnPartyOut {
                gstin: buyer_gstin,
                legal_name: buyer_name,
                address1: buyer_address,
                location: String::new(),
                pincode: 0,
                state_code: String::new(),
            },
            lines,
        },
    })
}

fn read_irn_record(db: &rusqlite::Connection, id: &str) -> Result<IrnRecordOut, String> {
    db.query_row(
        "SELECT id, bill_id, shop_id, vendor, status, irn, ack_no, ack_date,
                signed_invoice, qr_code, error_code, error_msg,
                attempt_count, last_attempt_at, submitted_at, cancelled_at, created_at
         FROM irn_records WHERE id = ?1",
        rusqlite::params![id],
        |r| {
            Ok(IrnRecordOut {
                id: r.get(0)?,
                bill_id: r.get(1)?,
                shop_id: r.get(2)?,
                vendor: r.get(3)?,
                status: r.get(4)?,
                irn: r.get(5)?,
                ack_no: r.get(6)?,
                ack_date: r.get(7)?,
                signed_invoice: r.get(8)?,
                qr_code: r.get(9)?,
                error_code: r.get(10)?,
                error_msg: r.get(11)?,
                attempt_count: r.get(12)?,
                last_attempt_at: r.get(13)?,
                submitted_at: r.get(14)?,
                cancelled_at: r.get(15)?,
                created_at: r.get(16)?,
            })
        },
    )
    .map_err(|e| format!("IRN_RECORD_NOT_FOUND:{}", e))
}

/// Retry a failed IRN. Writes a NEW irn_records row (prior row stays failed).
#[tauri::command]
pub fn retry_irn(
    bill_id: String,
    actor_user_id: String,
    state: State<DbState>,
) -> Result<IrnRecordOut, String> {
    // Must not have an active record for this bill
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let active: Option<String> = db
            .query_row(
                "SELECT id FROM irn_records
                 WHERE bill_id = ?1 AND status IN ('pending','submitted','acked')
                 LIMIT 1",
                rusqlite::params![bill_id],
                |r| r.get(0),
            )
            .ok();
        if active.is_some() {
            return Err("IRN_ALREADY_ACTIVE".to_string());
        }
    }

    submit_irn(
        SubmitIrnInput {
            bill_id,
            actor_user_id,
            vendor_override: None,
        },
        state,
    )
}

/// Cancel an acked IRN. Owner-gate; within 24h of ack_date.
#[tauri::command]
pub fn cancel_irn(input: CancelIrnInput, state: State<DbState>) -> Result<IrnRecordOut, String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;

    let (actor_role, actor_active): (String, i64) = db
        .query_row(
            "SELECT role, is_active FROM users WHERE id = ?1",
            rusqlite::params![input.actor_user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("USER_NOT_FOUND:{}", e))?;
    if actor_active == 0 {
        return Err("USER_INACTIVE".to_string());
    }
    if actor_role != "owner" {
        return Err("OWNER_REQUIRED".to_string());
    }

    let (irn, status, ack_date, shop_id, vendor): (
        Option<String>,
        String,
        Option<String>,
        String,
        String,
    ) = db
        .query_row(
            "SELECT irn, status, ack_date, shop_id, vendor
             FROM irn_records WHERE id = ?1",
            rusqlite::params![input.irn_record_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|e| format!("IRN_RECORD_NOT_FOUND:{}", e))?;

    if status != "acked" {
        return Err("IRN_NOT_ACKED".to_string());
    }
    let irn_val = irn.ok_or_else(|| "IRN_VALUE_MISSING".to_string())?;
    let ack = ack_date.ok_or_else(|| "ACK_DATE_MISSING".to_string())?;

    // 24h window check — ack_date is ISO-8601 UTC
    let ack_dt =
        chrono::DateTime::parse_from_rfc3339(&ack).map_err(|e| format!("ACK_DATE_PARSE:{}", e))?;
    let now_dt = chrono::Utc::now();
    let diff = now_dt.signed_duration_since(ack_dt.with_timezone(&chrono::Utc));
    if diff.num_hours() >= 24 {
        return Err("CANCEL_WINDOW_EXPIRED".to_string());
    }

    let remarks = input.cancel_remarks.clone().unwrap_or_default();
    let adapter = adapter_for(&vendor);
    let cancel_res = adapter.cancel(&irn_val, &input.cancel_reason, &remarks);

    let now = current_iso();
    let tx = db.transaction().map_err(|e| e.to_string())?;

    match cancel_res {
        Ok(()) => {
            tx.execute(
                "UPDATE irn_records SET status = 'cancelled',
                    cancelled_at = ?1, cancel_reason = ?2, cancel_remarks = ?3
                 WHERE id = ?4",
                rusqlite::params![now, input.cancel_reason, remarks, input.irn_record_id],
            )
            .map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO einvoice_audit(id, irn_record_id, event, actor_user_id, shop_id, at)
                 VALUES (?1, ?2, 'cancel_success', ?3, ?4, ?5)",
                rusqlite::params![
                    gen_id("ea"),
                    input.irn_record_id,
                    input.actor_user_id,
                    shop_id,
                    now,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        Err(err) => {
            tx.execute(
                "INSERT INTO einvoice_audit(id, irn_record_id, event, actor_user_id, shop_id, details, at)
                 VALUES (?1, ?2, 'cancel_failure', ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    gen_id("ea"),
                    input.irn_record_id,
                    input.actor_user_id,
                    shop_id,
                    format!("{{\"code\":\"{}\"}}", err.code),
                    now,
                ],
            )
            .map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
            return Err(format!("CANCEL_FAILED:{}", err.code));
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    read_irn_record(&db, &input.irn_record_id)
}

/// List IRN records by shop + status filter (optional). Newest first.
#[tauri::command]
pub fn list_irn_records(
    shop_id: String,
    status: Option<String>,
    limit: Option<i64>,
    state: State<DbState>,
) -> Result<Vec<IrnRecordOut>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(500);

    let mut stmt = match status {
        Some(_) => db
            .prepare(
                "SELECT id, bill_id, shop_id, vendor, status, irn, ack_no, ack_date,
                        signed_invoice, qr_code, error_code, error_msg,
                        attempt_count, last_attempt_at, submitted_at, cancelled_at, created_at
                 FROM irn_records
                 WHERE shop_id = ?1 AND status = ?2
                 ORDER BY created_at DESC
                 LIMIT ?3",
            )
            .map_err(|e| e.to_string())?,
        None => db
            .prepare(
                "SELECT id, bill_id, shop_id, vendor, status, irn, ack_no, ack_date,
                        signed_invoice, qr_code, error_code, error_msg,
                        attempt_count, last_attempt_at, submitted_at, cancelled_at, created_at
                 FROM irn_records
                 WHERE shop_id = ?1
                 ORDER BY created_at DESC
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?,
    };

    let mapper = |r: &rusqlite::Row| {
        Ok(IrnRecordOut {
            id: r.get(0)?,
            bill_id: r.get(1)?,
            shop_id: r.get(2)?,
            vendor: r.get(3)?,
            status: r.get(4)?,
            irn: r.get(5)?,
            ack_no: r.get(6)?,
            ack_date: r.get(7)?,
            signed_invoice: r.get(8)?,
            qr_code: r.get(9)?,
            error_code: r.get(10)?,
            error_msg: r.get(11)?,
            attempt_count: r.get(12)?,
            last_attempt_at: r.get(13)?,
            submitted_at: r.get(14)?,
            cancelled_at: r.get(15)?,
            created_at: r.get(16)?,
        })
    };

    let rows: Vec<IrnRecordOut> = match status {
        Some(s) => stmt
            .query_map(rusqlite::params![shop_id, s, lim], mapper)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?,
        None => stmt
            .query_map(rusqlite::params![shop_id, lim], mapper)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?,
    };

    Ok(rows)
}

/// Get the active IRN for a bill, if any.
#[tauri::command]
pub fn get_irn_for_bill(
    bill_id: String,
    state: State<DbState>,
) -> Result<Option<IrnRecordOut>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let id: Option<String> = db
        .query_row(
            "SELECT id FROM irn_records
             WHERE bill_id = ?1
             ORDER BY created_at DESC LIMIT 1",
            rusqlite::params![bill_id],
            |r| r.get(0),
        )
        .ok();
    match id {
        Some(i) => read_irn_record(&db, &i).map(Some),
        None => Ok(None),
    }
}
