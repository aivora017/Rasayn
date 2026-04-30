// product_ingredients.rs — read/write helpers for the M2M table introduced
// in migration 0042. BillingClinicalGuard fetches `list_for_products` to
// feed real ingredient ids into the formulary DDI engine.

use crate::db::DbState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProductIngredientRow {
    pub id: String,
    pub product_id: String,
    pub ingredient_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub per_dose_mg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_mg: Option<f64>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertProductIngredientInput {
    pub id: String,
    pub product_id: String,
    pub ingredient_id: String,
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

    // Build a SQL IN clause with placeholders. Cap at 200 to keep SQLite happy.
    let cap = product_ids.len().min(200);
    let placeholders = (1..=cap).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, product_id, ingredient_id, per_dose_mg, daily_mg, created_at \
         FROM product_ingredients WHERE product_id IN ({placeholders})"
    );
    let mut stmt = c.prepare(&sql).map_err(|e| e.to_string())?;

    let bind: Vec<&dyn rusqlite::ToSql> = product_ids.iter().take(cap).map(|s| s as &dyn rusqlite::ToSql).collect();
    let rows = stmt.query_map(rusqlite::params_from_iter(bind), |r| {
        Ok(ProductIngredientRow {
            id: r.get(0)?,
            product_id: r.get(1)?,
            ingredient_id: r.get(2)?,
            per_dose_mg: r.get(3)?,
            daily_mg: r.get(4)?,
            created_at: r.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn product_ingredients_upsert(
    input: UpsertProductIngredientInput,
    state: State<'_, DbState>,
) -> Result<ProductIngredientRow, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO product_ingredients (id, product_id, ingredient_id, per_dose_mg, daily_mg) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(product_id, ingredient_id) DO UPDATE SET \
            per_dose_mg = excluded.per_dose_mg, \
            daily_mg = excluded.daily_mg",
        params![input.id, input.product_id, input.ingredient_id, input.per_dose_mg, input.daily_mg],
    ).map_err(|e| e.to_string())?;
    c.query_row(
        "SELECT id, product_id, ingredient_id, per_dose_mg, daily_mg, created_at \
         FROM product_ingredients WHERE product_id = ?1 AND ingredient_id = ?2",
        params![input.product_id, input.ingredient_id],
        |r| Ok(ProductIngredientRow {
            id: r.get(0)?,
            product_id: r.get(1)?,
            ingredient_id: r.get(2)?,
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

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use crate::db::apply_migrations;

    fn seed_product(c: &Connection) {
        c.execute_batch(
            "INSERT INTO products (id, name, hsn, gst_rate, schedule, mrp_paise, created_at, is_active) \
             VALUES ('p_para', 'Paracetamol 500mg', '30049011', 12, 'OTC', 200, '2026-01-01', 1);
             INSERT INTO products (id, name, hsn, gst_rate, schedule, mrp_paise, created_at, is_active) \
             VALUES ('p_amox', 'Amoxicillin 500mg', '30041010', 12, 'H', 380, '2026-01-01', 1);"
        ).unwrap();
    }

    #[test]
    fn migration_0042_creates_product_ingredients_table() {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        let count: i64 = c.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='product_ingredients'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn upsert_then_overwrite_via_on_conflict() {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        seed_product(&c);
        c.execute(
            "INSERT INTO product_ingredients (id, product_id, ingredient_id, per_dose_mg, daily_mg) \
             VALUES ('pi1', 'p_para', 'paracetamol', 500.0, 4000.0) \
             ON CONFLICT(product_id, ingredient_id) DO UPDATE SET per_dose_mg = excluded.per_dose_mg",
            [],
        ).unwrap();
        // Update with a different per_dose_mg via the same ON CONFLICT path
        c.execute(
            "INSERT INTO product_ingredients (id, product_id, ingredient_id, per_dose_mg, daily_mg) \
             VALUES ('pi2', 'p_para', 'paracetamol', 650.0, 4000.0) \
             ON CONFLICT(product_id, ingredient_id) DO UPDATE SET per_dose_mg = excluded.per_dose_mg",
            [],
        ).unwrap();
        let dose: f64 = c.query_row(
            "SELECT per_dose_mg FROM product_ingredients WHERE product_id='p_para' AND ingredient_id='paracetamol'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(dose, 650.0);
        let row_count: i64 = c.query_row(
            "SELECT count(*) FROM product_ingredients WHERE product_id='p_para'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(row_count, 1, "ON CONFLICT update must keep row count at 1");
    }

    #[test]
    fn list_for_products_returns_only_matching() {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        seed_product(&c);
        c.execute_batch(
            "INSERT INTO product_ingredients (id, product_id, ingredient_id) VALUES ('pi_p1', 'p_para', 'paracetamol');
             INSERT INTO product_ingredients (id, product_id, ingredient_id) VALUES ('pi_a1', 'p_amox', 'amoxicillin');
             INSERT INTO product_ingredients (id, product_id, ingredient_id) VALUES ('pi_a2', 'p_amox', 'penicillin');"
        ).unwrap();
        let n: i64 = c.query_row(
            "SELECT count(*) FROM product_ingredients WHERE product_id = 'p_amox'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn cascade_delete_when_product_removed() {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        seed_product(&c);
        c.execute("INSERT INTO product_ingredients (id, product_id, ingredient_id) VALUES ('pi1', 'p_para', 'paracetamol')", []).unwrap();
        // Soft-delete on products table (is_active=0) doesn't cascade; verify row still present
        c.execute("UPDATE products SET is_active = 0 WHERE id = 'p_para'", []).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM product_ingredients WHERE product_id = 'p_para'", [], |r