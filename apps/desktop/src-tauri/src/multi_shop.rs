// multi_shop.rs — S22a. Per-shop inventory queries.
// Pairs with apps/desktop/src/components/MultiStoreScreen.tsx and
// migration 0044_batches_shop_id.

use crate::db::DbState;
use rusqlite::params;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShopRow {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShopStockRow {
    pub shop_id: String,
    pub shop_name: String,
    pub product_id: String,
    pub product_name: String,
    pub batch_id: String,
    pub batch_no: String,
    pub expiry_date: String,
    pub qty_on_hand: i64,
}

#[tauri::command]
pub fn shops_list(state: State<'_, DbState>) -> Result<Vec<ShopRow>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c.prepare("SELECT id, name FROM shops ORDER BY name").map_err(|e| e.to_string())?;
    let rows: Vec<ShopRow> = stmt.query_map([], |r| {
        Ok(ShopRow { id: r.get(0)?, name: r.get(1)? })
    }).map_err(|e| e.to_string())?
       .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn batches_list_by_shop(
    shop_id: String,
    limit: Option<i64>,
    state: State<'_, DbState>,
) -> Result<Vec<ShopStockRow>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(200).clamp(1, 1000);
    let mut stmt = c.prepare(
        "SELECT b.shop_id, COALESCE(s.name, b.shop_id) AS shop_name, \
                p.id, p.name, b.id, b.batch_no, b.expiry_date, b.qty_on_hand \
         FROM batches b \
         JOIN products p ON p.id = b.product_id \
         LEFT JOIN shops s ON s.id = b.shop_id \
         WHERE b.shop_id = ?1 AND b.qty_on_hand > 0 \
         ORDER BY p.name, b.expiry_date ASC \
         LIMIT ?2"
    ).map_err(|e| e.to_string())?;
    let rows: Vec<ShopStockRow> = stmt.query_map(params![shop_id, lim], |r| {
        Ok(ShopStockRow {
            shop_id: r.get(0)?, shop_name: r.get(1)?,
            product_id: r.get(2)?, product_name: r.get(3)?,
            batch_id: r.get(4)?, batch_no: r.get(5)?,
            expiry_date: r.get(6)?, qty_on_hand: r.get(7)?,
        })
    }).map_err(|e| e.to_string())?
       .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShopSummaryRow {
    pub shop_id: String,
    pub shop_name: String,
    pub product_count: i64,
    pub batch_count: i64,
    pub total_units: i64,
}

#[tauri::command]
pub fn shops_inventory_summary(state: State<'_, DbState>) -> Result<Vec<ShopSummaryRow>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c.prepare(
        "SELECT s.id, s.name, \
                COUNT(DISTINCT b.product_id), \
                COUNT(b.id), \
                COALESCE(SUM(b.qty_on_hand), 0) \
         FROM shops s \
         LEFT JOIN batches b ON b.shop_id = s.id AND b.qty_on_hand > 0 \
         GROUP BY s.id, s.name \
         ORDER BY s.name"
    ).map_err(|e| e.to_string())?;
    let rows: Vec<ShopSummaryRow> = stmt.query_map([], |r| {
        Ok(ShopSummaryRow {
            shop_id: r.get(0)?, shop_name: r.get(1)?,
            product_count: r.get(2)?, batch_count: r.get(3)?,
            total_units: r.get(4)?,
        })
    }).map_err(|e| e.to_string())?
       .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}
