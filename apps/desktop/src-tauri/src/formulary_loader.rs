// formulary_loader.rs — DDI/allergy/dose hydration for BillingClinicalGuard (S26.D).
//
// Hydrates the formulary engine in @pharmacare/formulary with real seed data
// from migrations 0026 (schema) + 0046 (seed). Before this module the engine
// no-op'd because the DDI / allergy / dose-range arrays were empty in TS.
//
// Severity in the schema is stored as 'info' | 'warn' | 'block'. We expose
// the same wire values to the TS side; the formulary engine maps to its own
// internal severity scale (low / moderate / high / contraindicated).
//
// Tauri commands:
//   - list_ddi_pairs            → all DDI pairs (whole formulary; small dataset)
//   - list_customer_allergies   → allergies for a single customer
//   - list_dose_ranges          → dose envelope for a product (via product_ingredients)

use crate::db::DbState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DdiPair {
    pub ingredient_a: String,
    pub ingredient_b: String,
    /// 'info' | 'warn' | 'block' — matches migration 0026 CHECK constraint.
    pub severity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mechanism: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clinical_effect: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub references_json: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomerAllergyRow {
    pub customer_id: String,
    pub ingredient_id: String,
    pub ingredient_inn: String,
    /// 'info' | 'warn' | 'block' — defaults to 'warn' per migration 0026.
    pub severity: String,
    pub recorded_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DoseRange {
    pub ingredient_id: String,
    pub ingredient_inn: String,
    pub age_min_years: i64,
    pub age_max_years: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_min_mg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_max_mg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub per_dose_max_mg: Option<f64>,
}

#[tauri::command]
pub fn list_ddi_pairs(db: State<'_, DbState>) -> Result<Vec<DdiPair>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT ingredient_a, ingredient_b, severity, mechanism,
                    clinical_effect, references_json
             FROM ddi_pairs
             ORDER BY ingredient_a ASC, ingredient_b ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(DdiPair {
                ingredient_a: r.get(0)?,
                ingredient_b: r.get(1)?,
                severity: r.get(2)?,
                mechanism: r.get(3)?,
                clinical_effect: r.get(4)?,
                references_json: r.get(5)?,
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
pub fn list_customer_allergies(
    db: State<'_, DbState>,
    customer_id: String,
) -> Result<Vec<CustomerAllergyRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT ca.customer_id, ca.ingredient_id, fi.inn, ca.severity, ca.recorded_at
             FROM customer_allergies ca
             JOIN formulary_ingredients fi ON fi.id = ca.ingredient_id
             WHERE ca.customer_id = ?1
             ORDER BY ca.recorded_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![customer_id], |r| {
            Ok(CustomerAllergyRow {
                customer_id: r.get(0)?,
                ingredient_id: r.get(1)?,
                ingredient_inn: r.get(2)?,
                severity: r.get(3)?,
                recorded_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Returns the *adult* (age_min_years <= 18 or in adult range) dose range for
/// a product's primary ingredient. The product is mapped via
/// product_ingredients (composite PK product_id+ingredient_id). For products
/// with multiple ingredients we return the first by ingredient_id ordering —
/// the engine on TS side composes per-ingredient bounds. Returns None when
/// no ingredient mapping exists or no dose_range row matches.
#[tauri::command]
pub fn list_dose_ranges(
    db: State<'_, DbState>,
    product_id: String,
) -> Result<Option<DoseRange>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let row = conn
        .query_row(
            "SELECT dr.ingredient_id, fi.inn, dr.age_min_years, dr.age_max_years,
                    dr.daily_min_mg, dr.daily_max_mg, dr.per_dose_max_mg
             FROM product_ingredients pi
             JOIN dose_ranges dr ON dr.ingredient_id = pi.ingredient_id
             JOIN formulary_ingredients fi ON fi.id = pi.ingredient_id
             WHERE pi.product_id = ?1
               AND dr.age_min_years >= 18
             ORDER BY pi.ingredient_id ASC, dr.age_min_years ASC
             LIMIT 1",
            params![product_id],
            |r| {
                Ok(DoseRange {
                    ingredient_id: r.get(0)?,
                    ingredient_inn: r.get(1)?,
                    age_min_years: r.get(2)?,
                    age_max_years: r.get(3)?,
                    daily_min_mg: r.get(4)?,
                    daily_max_mg: r.get(5)?,
                    per_dose_max_mg: r.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(row)
}
