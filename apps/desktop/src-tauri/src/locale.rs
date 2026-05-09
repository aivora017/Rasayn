// locale.rs â€” owner UI locale persistence (S28-B2).
//
// Reads/writes the `shops.locale` column added by migration 0051. The
// default value is 'mr' (Marathi) per Q-007 because the first pilot shop
// is in Kalyan; the founder may flip it to 'hi' for downstream Hindi-belt
// pilots from Settings -> Language.
//
// The frontend bootstrap (`apps/desktop/src/main.tsx`) currently reads
// the locale from `localStorage` to keep the cold-start path zero-DB.
// On first idle the SettingsScreen reconciles localStorage against the
// authoritative shops.locale column so a fresh-machine reinstall picks up
// the persisted preference automatically.

use crate::db::DbState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

const SUPPORTED: &[&str] = &["en", "hi", "mr"];

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocaleResponse {
    pub locale: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SetLocaleInput {
    pub shop_id: String,
    pub locale: String,
}

fn validate(loc: &str) -> Result<(), String> {
    if SUPPORTED.contains(&loc) {
        Ok(())
    } else {
        Err(format!(
            "unsupported locale '{}'; expected one of {:?}",
            loc, SUPPORTED
        ))
    }
}

#[tauri::command]
pub fn get_locale(shop_id: String, state: State<DbState>) -> Result<LocaleResponse, String> {
    let conn = state.0.lock().map_err(|e| format!("db lock: {e}"))?;
    let row: Option<String> = conn
        .query_row(
            "SELECT locale FROM shops WHERE id = ?1",
            params![shop_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("query locale: {e}"))?;
    Ok(LocaleResponse {
        locale: row.unwrap_or_else(|| "mr".to_string()),
    })
}

#[tauri::command]
pub fn set_locale(input: SetLocaleInput, state: State<DbState>) -> Result<LocaleResponse, String> {
    validate(&input.locale)?;
    let conn = state.0.lock().map_err(|e| format!("db lock: {e}"))?;
    let n = conn
        .execute(
            "UPDATE shops SET locale = ?1 WHERE id = ?2",
            params![input.locale, input.shop_id],
        )
        .map_err(|e| format!("update locale: {e}"))?;
    if n == 0 {
        return Err(format!("shop '{}' not found", input.shop_id));
    }
    Ok(LocaleResponse {
        locale: input.locale,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_supported_locales() {
        assert!(validate("en").is_ok());
        assert!(validate("hi").is_ok());
        assert!(validate("mr").is_ok());
    }

    #[test]
    fn validate_rejects_unsupported() {
        assert!(validate("fr").is_err());
        assert!(validate("").is_err());
        assert!(validate("MR").is_err()); // case-sensitive
    }
}
