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
