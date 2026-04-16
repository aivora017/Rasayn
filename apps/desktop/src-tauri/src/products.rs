// A1 SKU master — product CRUD commands.
//
// These are the owner-facing master-data commands. Sale-side reads still go
// through `search_products` (FTS5) / `pick_fefo_batch` / `list_stock` in
// commands.rs. Keep A1 surface narrow: upsert, get, list (paged), deactivate.
//
// Hard rules enforced:
//  * Hard Rule 1 (LAN-first): pure SQLite. No network.
//  * Hard Rule 5 (compliance automatic): HSN + NPPA cap + Schedule-image
//    enforced in migration 0006/0001 triggers; validated again here for
//    user-friendly error messages before hitting the trigger.
//  * Hard Rule 7 (Win7/4GB): `idx_products_active_name` keeps listing cheap.

use crate::db::DbState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

const PHARMA_HSN: &[&str] = &["3003", "3004", "3005", "3006", "9018"];
const GST_RATES: &[i64] = &[0, 5, 12, 18, 28];
const SCHEDULES: &[&str] = &["OTC", "G", "H", "H1", "X", "NDPS"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductRow {
    pub id: String,
    pub name: String,
    #[serde(rename = "genericName")]
    pub generic_name: Option<String>,
    pub manufacturer: String,
    pub hsn: String,
    #[serde(rename = "gstRate")]
    pub gst_rate: i64,
    pub schedule: String,
    #[serde(rename = "packForm")]
    pub pack_form: String,
    #[serde(rename = "packSize")]
    pub pack_size: i64,
    #[serde(rename = "mrpPaise")]
    pub mrp_paise: i64,
    #[serde(rename = "nppaMaxMrpPaise")]
    pub nppa_max_mrp_paise: Option<i64>,
    #[serde(rename = "imageSha256")]
    pub image_sha256: Option<String>,
    #[serde(rename = "isActive")]
    pub is_active: bool,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct ProductInput {
    pub id: Option<String>,
    pub name: String,
    #[serde(rename = "genericName")]
    pub generic_name: Option<String>,
    pub manufacturer: String,
    pub hsn: String,
    #[serde(rename = "gstRate")]
    pub gst_rate: i64,
    pub schedule: String,
    #[serde(rename = "packForm")]
    pub pack_form: String,
    #[serde(rename = "packSize")]
    pub pack_size: i64,
    #[serde(rename = "mrpPaise")]
    pub mrp_paise: i64,
    #[serde(rename = "nppaMaxMrpPaise")]
    pub nppa_max_mrp_paise: Option<i64>,
    #[serde(rename = "imageSha256")]
    pub image_sha256: Option<String>,
}

fn gen_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // Good enough for local; replace with ULID in a later branch.
    format!("prd_{:x}_{:04x}", ms, rand_suffix())
}

fn rand_suffix() -> u16 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    (n & 0xFFFF) as u16
}

fn validate(p: &ProductInput) -> Result<(), String> {
    if p.name.trim().is_empty() {
        return Err("name is required".into());
    }
    if p.manufacturer.trim().is_empty() {
        return Err("manufacturer is required".into());
    }
    // India GSTN: HSN may be 4, 6, or 8 digits. Chapter prefix (first 4)
    // must be in the pharma whitelist. Mirrors migration 0008 trigger.
    if !matches!(p.hsn.len(), 4 | 6 | 8) || !p.hsn.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!(
            "HSN must be 4, 6, or 8 digits (got '{}')",
            p.hsn
        ));
    }
    if !PHARMA_HSN.contains(&&p.hsn[..4]) {
        return Err(format!(
            "HSN prefix must be one of {} (got '{}')",
            PHARMA_HSN.join("/"),
            p.hsn
        ));
    }
    if !GST_RATES.contains(&p.gst_rate) {
        return Err("gst_rate must be 0/5/12/18/28".into());
    }
    if !SCHEDULES.contains(&p.schedule.as_str()) {
        return Err("schedule must be OTC/G/H/H1/X/NDPS".into());
    }
    if p.pack_size <= 0 {
        return Err("pack_size must be > 0".into());
    }
    if p.mrp_paise <= 0 {
        return Err("mrp must be > 0".into());
    }
    if let Some(cap) = p.nppa_max_mrp_paise {
        if cap <= 0 {
            return Err("nppa_max_mrp must be > 0 or null".into());
        }
        if p.mrp_paise > cap {
            return Err(format!(
                "MRP {}p exceeds NPPA ceiling {}p (DPCO 2013)",
                p.mrp_paise, cap
            ));
        }
    }
    // X2 moat
    if matches!(p.schedule.as_str(), "H" | "H1" | "X")
        && p.image_sha256.as_deref().map(str::is_empty).unwrap_or(true)
    {
        return Err(format!(
            "Schedule {} product requires an image (X2 moat)",
            p.schedule
        ));
    }
    Ok(())
}

fn row_from<'a>(r: &rusqlite::Row<'a>) -> rusqlite::Result<ProductRow> {
    Ok(ProductRow {
        id: r.get(0)?,
        name: r.get(1)?,
        generic_name: r.get(2)?,
        manufacturer: r.get(3)?,
        hsn: r.get(4)?,
        gst_rate: r.get(5)?,
        schedule: r.get(6)?,
        pack_form: r.get(7)?,
        pack_size: r.get(8)?,
        mrp_paise: r.get(9)?,
        nppa_max_mrp_paise: r.get(10)?,
        image_sha256: r.get(11)?,
        is_active: r.get::<_, i64>(12)? == 1,
        created_at: r.get(13)?,
        updated_at: r.get(14)?,
    })
}

const SELECT_COLS: &str = "id, name, generic_name, manufacturer, hsn, gst_rate, schedule, \
     pack_form, pack_size, mrp_paise, nppa_max_mrp_paise, image_sha256, is_active, \
     created_at, updated_at";

#[tauri::command]
pub fn upsert_product(input: ProductInput, state: State<DbState>) -> Result<ProductRow, String> {
    validate(&input)?;
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let id = input.id.clone().unwrap_or_else(gen_id);
    let now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
    let sql = format!(
        "INSERT INTO products (id, name, generic_name, manufacturer, hsn, gst_rate, schedule, \
         pack_form, pack_size, mrp_paise, nppa_max_mrp_paise, image_sha256, is_active, \
         created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, {now}, {now}) \
         ON CONFLICT(id) DO UPDATE SET \
            name=excluded.name, generic_name=excluded.generic_name, \
            manufacturer=excluded.manufacturer, hsn=excluded.hsn, \
            gst_rate=excluded.gst_rate, schedule=excluded.schedule, \
            pack_form=excluded.pack_form, pack_size=excluded.pack_size, \
            mrp_paise=excluded.mrp_paise, nppa_max_mrp_paise=excluded.nppa_max_mrp_paise, \
            image_sha256=excluded.image_sha256, updated_at={now}"
    );
    c.execute(
        &sql,
        params![
            id,
            input.name.trim(),
            input.generic_name.as_deref(),
            input.manufacturer.trim(),
            input.hsn,
            input.gst_rate,
            input.schedule,
            input.pack_form,
            input.pack_size,
            input.mrp_paise,
            input.nppa_max_mrp_paise,
            input.image_sha256.as_deref(),
        ],
    )
    .map_err(|e| e.to_string())?;

    let row = c
        .query_row(
            &format!("SELECT {SELECT_COLS} FROM products WHERE id = ?1"),
            params![id],
            row_from,
        )
        .map_err(|e| e.to_string())?;
    Ok(row)
}

#[tauri::command]
pub fn get_product(id: String, state: State<DbState>) -> Result<Option<ProductRow>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.query_row(
        &format!("SELECT {SELECT_COLS} FROM products WHERE id = ?1"),
        params![id],
        row_from,
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize, Default)]
pub struct ListProductsArgs {
    pub q: Option<String>,
    #[serde(rename = "activeOnly")]
    pub active_only: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[tauri::command]
pub fn list_products(
    args: Option<ListProductsArgs>,
    state: State<DbState>,
) -> Result<Vec<ProductRow>, String> {
    let a = args.unwrap_or_default();
    let limit = a.limit.unwrap_or(200).clamp(1, 2000);
    let offset = a.offset.unwrap_or(0).max(0);
    let active_only = a.active_only.unwrap_or(true);

    let c = state.0.lock().map_err(|e| e.to_string())?;
    let like =
        a.q.as_deref()
            .map(|q| format!("%{}%", q.trim().to_lowercase()))
            .unwrap_or_else(|| "%".to_string());
    let sql = format!(
        "SELECT {SELECT_COLS} FROM products \
         WHERE ({active_clause}) \
           AND (LOWER(name) LIKE ?1 OR LOWER(COALESCE(generic_name,'')) LIKE ?1 \
                OR LOWER(manufacturer) LIKE ?1) \
         ORDER BY name ASC LIMIT ?2 OFFSET ?3",
        active_clause = if active_only { "is_active = 1" } else { "1=1" }
    );
    let mut stmt = c.prepare(&sql).map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map(params![like, limit, offset], row_from)
        .map_err(|e| e.to_string())?;
    iter.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn deactivate_product(id: String, state: State<DbState>) -> Result<(), String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let n = c
        .execute(
            "UPDATE products SET is_active = 0, \
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') \
             WHERE id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("product not found".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;
    use rusqlite::Connection;

    fn mem_db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        apply_migrations(&c).unwrap();
        c
    }

    fn base_input() -> ProductInput {
        ProductInput {
            id: None,
            name: "Crocin 500".into(),
            generic_name: Some("Paracetamol".into()),
            manufacturer: "GSK".into(),
            hsn: "3004".into(),
            gst_rate: 12,
            schedule: "OTC".into(),
            pack_form: "tablet".into(),
            pack_size: 15,
            mrp_paise: 3500,
            nppa_max_mrp_paise: Some(4000),
            image_sha256: None,
        }
    }

    #[test]
    fn validate_rejects_bad_hsn() {
        let mut p = base_input();
        p.hsn = "9999".into();
        assert!(validate(&p).is_err());
    }

    #[test]
    fn validate_rejects_mrp_over_nppa() {
        let mut p = base_input();
        p.mrp_paise = 5000;
        p.nppa_max_mrp_paise = Some(4000);
        let err = validate(&p).unwrap_err();
        assert!(err.contains("NPPA"));
    }

    #[test]
    fn validate_requires_image_for_schedule_h() {
        let mut p = base_input();
        p.schedule = "H1".into();
        p.image_sha256 = None;
        assert!(validate(&p).is_err());
    }

    #[test]
    fn migration_trigger_blocks_bad_hsn_even_if_validate_skipped() {
        let c = mem_db();
        // Bypass validate() and hit the DB directly — trigger must catch it.
        let r = c.execute(
            "INSERT INTO products (id,name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise) \
             VALUES ('p1','X','ACME','1111',5,'OTC','tablet',10,100)",
            [],
        );
        assert!(r.is_err(), "trigger should reject non-pharma HSN");
    }

    #[test]
    fn migration_trigger_blocks_mrp_over_nppa() {
       