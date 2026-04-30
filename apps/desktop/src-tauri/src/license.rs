// license.rs — Tauri commands to persist + read the singleton app_license row.
// Validation is JS-side via @pharmacare/license; Rust just stores the result.

use crate::db::DbState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppLicense {
    pub key_text: String,
    pub edition_flags: i64,
    pub expiry_iso: String,
    pub fingerprint: String,
    pub issued_at: String,
    pub last_validated: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLicenseInput {
    pub key_text: String,
    pub edition_flags: i64,
    pub expiry_iso: String,
    pub fingerprint: String,
}

#[tauri::command]
pub fn license_save(input: SaveLicenseInput, state: State<'_, DbState>) -> Result<AppLicense, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO app_license (id, key_text, edition_flags, expiry_iso, fingerprint, last_validated) \
         VALUES ('singleton', ?1, ?2, ?3, ?4, datetime('now')) \
         ON CONFLICT(id) DO UPDATE SET \
            key_text = excluded.key_text, \
            edition_flags = excluded.edition_flags, \
            expiry_iso = excluded.expiry_iso, \
            fingerprint = excluded.fingerprint, \
            last_validated = datetime('now')",
        params![input.key_text, input.edition_flags, input.expiry_iso, input.fingerprint],
    ).map_err(|e| e.to_string())?;
    license_get(state).and_then(|opt| opt.ok_or_else(|| "INSERT_LOST".into()))
}

#[tauri::command]
pub fn license_get(state: State<'_, DbState>) -> Result<Option<AppLicense>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.query_row(
        "SELECT key_text, edition_flags, expiry_iso, fingerprint, issued_at, last_validated \
         FROM app_license WHERE id = 'singleton'",
        [],
        |r| Ok(AppLicense {
            key_text: r.get(0)?,
            edition_flags: r.get(1)?,
            expiry_iso: r.get(2)?,
            fingerprint: r.get(3)?,
            issued_at: r.get(4)?,
            last_validated: r.get(5)?,
        }),
    ).optional().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn license_clear(state: State<'_, DbState>) -> Result<usize, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute("DELETE FROM app_license WHERE id = 'singleton'", [])
        .map_err(|e| e.to_string())
}
