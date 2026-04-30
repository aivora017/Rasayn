// product_ingredients.rs — read/write helpers for the M2M table created in
// migration 0026 (composite PK on product_id+ingredient_id). Migration 0042
// added per_dose_mg / daily_mg / created_at columns. BillingClinicalGuard
// fetches `list_for_products` to feed real ingredient ids into the
// formulary DDI engine.

use crate::db::DbState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProductIngredientRow {
    pub product_id: String,
    pub ingredient_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strength_mg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub per_dose_mg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_mg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertProductIngredientInput {
    pub product_id: String,
    pub ingredient_id: String,
    pub strength_mg: Option<f64>,
    pub per_dose_mg: Option<f64>,
    pub daily_mg: Option<f64>,
}

#[tauri::command]
pub fn product_ingredients_list_for_products(
    product_ids: Vec<String>,
    state: State<'_, DbState>,
) -> Result<Vec<ProductIngredientRow>, String> {
    if product_ids.is_empty() {
        return Ok(Vec::new());
    }
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let cap = product_ids.len().min(200);
    let placeholders = (1..=cap).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT product_id, ingredient_id, strength_mg, per_dose_mg, daily_mg, created_at \
         FROM product_ingredients WHERE product_id IN ({placeholders})"
    );
    let mut stmt = c.prepare(&sql).map_err(|e| e.to_string())?;
    let bind: Vec<&dyn rusqlite::ToSql> = product_ids.iter().take(cap).map(|s| s as &dyn rusqlite::ToSql).collect();
    let rows = stmt.query_map(rusqlite::params_from_iter(bind), |r| {
        Ok(ProductIngredientRow {
            product_id: r.get(0)?,
            ingredient_id: r.get(1)?,
            strength_mg: r.get(2)?,
            per_dose_mg: r.get(3)?,
            daily_mg: r.get(4)?,
            created_at: r.get(5)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub fn product_ingredients_upsert(
    input: UpsertProductIngredientInput,
    state: State<'_, DbState>,
) -> Result<ProductIngredientRow, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO product_ingredients (product_id, ingredient_id, strength_mg, per_dose_mg, daily_mg) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(product_id, ingredient_id) DO UPDATE SET \
            strength_mg = excluded.strength_mg, \
            per_dose_mg = excluded.per_dose_mg, \
            daily_mg = excluded.daily_mg",
        params![input.product_id, input.ingredient_id, input.strength_mg, input.per_dose_mg, input.daily_mg],
    ).map_err(|e| e.to_string())?;
    c.query_row(
        "SELECT product_id, ingredient_id, strength_mg, per_dose_mg, daily_mg, created_at \
         FROM product_ingredients WHERE product_id = ?1 AND ingredient_id = ?2",
        params![input.product_id, input.ingredient_id],
        |r| Ok(ProductIngredientRow {
            product_id: r.get(0)?,
            ingredient_id: r.get(1)?,
            strength_mg: r.get(2)?,
            per_dose_mg: r.get(3)?,
            daily_mg: r.get(4)?,
            created_at: r.get(5)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn product_ingredients_delete(
    product_id: String,
    ingredient_id: String,
    state: State<'_, DbState>,
) -> Result<usize, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute(
        "DELETE FROM product_ingredients WHERE product_id = ?1 AND ingredient_id = ?2",
        params![product_id, ingredient_id],
    ).map_err(|e| e.to_string())
}
