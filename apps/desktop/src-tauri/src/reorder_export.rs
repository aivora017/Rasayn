// reorder_export.rs — Real reorder suggestions (S26.H part 1).
//
// Replaces ReorderScreen.tsx's MOCK_STOCK / MOCK_SUPPLIERS / MOCK_FORECASTS
// hardcoded data with live SQL pulls. The full @pharmacare/reorder-suggest
// engine in TS uses richer inputs (per-supplier MOQ, lead time, safety
// stock); this Rust command produces the *raw* materials (stock + velocity
// + last supplier) and a simple urgency heuristic. The TS layer can fold
// this into the engine for richer suggestions, OR display the raw output
// directly when the engine is overkill.
//
// Algorithm (per spec):
//   - avg_daily_velocity = sum(qty over last 30 days from bill_lines) / 30.0
//   - days_of_stock_remaining = current_stock_qty / max(avg_daily_velocity, 0.001)
//   - suggested_qty = ceil(avg_daily_velocity * horizon_days) - current_stock_qty
//                     (capped to >=0; no MOQ/round-up applied here)
//   - urgency:
//       high if days_of_stock <= 3 OR (days_of_stock < horizon_days/3)
//       med  if days_of_stock <= horizon_days
//       low  otherwise
//   - suggested_supplier_id = supplier_id of most-recent batches row (last GRN)

use crate::db::DbState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReorderSuggestion {
    pub product_id: String,
    pub product_name: String,
    pub current_stock_qty: f64,
    pub avg_daily_velocity: f64,
    pub suggested_qty: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_supplier_id: Option<String>,
    pub days_of_stock_remaining: f64,
    /// 'low' | 'med' | 'high'
    pub urgency: String,
}

fn classify_urgency(days_of_stock: f64, horizon_days: f64) -> &'static str {
    if days_of_stock <= 3.0 || days_of_stock < horizon_days / 3.0 {
        "high"
    } else if days_of_stock <= horizon_days {
        "med"
    } else {
        "low"
    }
}

#[tauri::command]
pub fn list_reorder_suggestions(
    db: State<'_, DbState>,
    shop_id: String,
    horizon_days: i32,
) -> Result<Vec<ReorderSuggestion>, String> {
    if horizon_days <= 0 {
        return Err(format!("INVALID_HORIZON_DAYS:{}", horizon_days));
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Per-product current stock = SUM(batches.qty_on_hand) where the batch
    // belongs to this shop. Migration 0044 added batches.shop_id; we filter
    // on it directly so a shared products catalogue still produces shop-
    // scoped reorder rows.
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, COALESCE(SUM(b.qty_on_hand), 0) AS stock_qty
             FROM products p
             LEFT JOIN batches b ON b.product_id = p.id AND b.shop_id = ?1
             WHERE p.is_active = 1
             GROUP BY p.id, p.name
             ORDER BY p.name ASC",
        )
        .map_err(|e| e.to_string())?;
    let stock_rows = stmt
        .query_map(params![shop_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, f64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out: Vec<ReorderSuggestion> = Vec::new();
    let horizon_f = horizon_days as f64;
    for row in stock_rows {
        let (product_id, product_name, stock_qty) = row.map_err(|e| e.to_string())?;

        // Sales velocity over the last 30 days. We use bills.billed_at;
        // we exclude voided bills (the bill_lines insert trigger already
        // decremented stock, but a voided bill still represents fake demand
        // for forecasting purposes — exclude it).
        let velocity_total: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(bl.qty), 0)
                 FROM bill_lines bl
                 JOIN bills b ON b.id = bl.bill_id
                 WHERE b.shop_id = ?1
                   AND b.is_voided = 0
                   AND bl.product_id = ?2
                   AND b.billed_at >= datetime('now', '-30 days')",
                params![shop_id, product_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let avg_daily_velocity = velocity_total / 30.0;

        // No demand and we have stock → don't suggest.
        if avg_daily_velocity <= 0.0 && stock_qty > 0.0 {
            continue;
        }

        let target_for_horizon = avg_daily_velocity * horizon_f;
        let raw_suggested = target_for_horizon - stock_qty;
        let suggested_qty = if raw_suggested > 0.0 {
            raw_suggested.ceil()
        } else {
            0.0
        };

        // Skip if nothing to suggest *and* we have stock left — the screen
        // doesn't need a row of zeros.
        if suggested_qty <= 0.0 && stock_qty > 0.0 {
            continue;
        }

        let days_of_stock_remaining = if avg_daily_velocity > 0.0 {
            stock_qty / avg_daily_velocity
        } else {
            // No demand AND no stock → treat as infinite (nothing to do).
            f64::INFINITY
        };

        // Most-recent supplier from the latest batch row for this product.
        let supplier_id: Option<String> = conn
            .query_row(
                "SELECT supplier_id FROM batches
                 WHERE product_id = ?1 AND shop_id = ?2
                 ORDER BY created_at DESC LIMIT 1",
                params![product_id, shop_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let urgency = classify_urgency(days_of_stock_remaining, horizon_f).to_string();

        out.push(ReorderSuggestion {
            product_id,
            product_name,
            current_stock_qty: stock_qty,
            avg_daily_velocity,
            suggested_qty,
            suggested_supplier_id: supplier_id,
            days_of_stock_remaining: if days_of_stock_remaining.is_finite() {
                days_of_stock_remaining
            } else {
                // Serde-friendly: send a large finite value rather than INF
                // so the JSON layer doesn't reject it.
                9_999.0
            },
            urgency,
        });
    }

    // Sort: highest urgency first, then ascending days_of_stock.
    out.sort_by(|a, b| {
        let rank = |u: &str| match u {
            "high" => 0,
            "med" => 1,
            _ => 2,
        };
        rank(&a.urgency).cmp(&rank(&b.urgency)).then(
            a.days_of_stock_remaining
                .partial_cmp(&b.days_of_stock_remaining)
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });

    Ok(out)
}
