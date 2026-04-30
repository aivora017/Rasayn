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
    ).map_err(|e| e.to_string())
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

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use crate::db::apply_migrations;

    #[test]
    fn migration_0043_creates_singleton_table() {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        let count: i64 = c.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='app_license'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn insert_then_upsert_via_on_conflict() {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        c.execute(
            "INSERT INTO app_license (id, key_text, edition_flags, expiry_iso, fingerprint) \
             VALUES ('singleton', 'PCPR-2026-AAAA-AAAA-AAAA-AAAA-AAAA-FFFF', 7, '2027-04-29T00:00:00Z', 'feedface')",
            [],
        ).unwrap();
        c.execute(
            "INSERT INTO app_license (id, key_text, edition_flags, expiry_iso, fingerprint, last_validated) \
             VALUES ('singleton', 'PCPR-2027-BBBB-BBBB-BBBB-BBBB-BBBB-EEEE', 15, '2028-04-29T00:00:00Z', 'feedface', datetime('now')) \
             ON CONFLICT(id) DO UPDATE SET \
               key_text = excluded.key_text, \
               edition_flags = excluded.edition_flags, \
               expiry_iso = excluded.expiry_iso, \
               last_validated = datetime('now')",
            [],
        ).unwrap();
        let (key, flags): (String, i64) = c.query_row(
            "SELECT key_text, edition_flags FROM app_license WHERE id = 'singleton'",
            [], |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert!(key.starts_with("PCPR-2027"));
        assert_eq!(flags, 15);
        let row_count: i64 = c.query_row("SELECT count(*) FROM app_license", [], |r| r.get(0)).unwrap();
        assert_eq!(row_count, 1, "singleton must stay 1 row");
    }

    #[test]
    fn check_constraint_rejects_non_singleton_id() {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        let r = c.execute(
            "INSERT INTO app_license (id, key_text, edition_flags, expiry_iso, fingerprint) \
             VALUES ('not_singleton', 'PCPR-2026-AAAA-AAAA-AAAA-AAAA-AAAA-FFFF', 7, '2027-04-29T00:00:00Z', 'feedface')",
            [],
        );
        assert!(r.is_err(), "id must be 'singleton' per CHECK constraint");
    }

    #[test]
    fn delete_clears_singleton() {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        c.execute(
            "INSERT INTO app_license (id, key_text, edition_flags, expiry_iso, fingerprint) \
             VALUES ('singleton', 'PCPR-2026-A-A-A-A-A-FFFF', 7, '2027-04-29T00:00:00Z', 'fp')",
            [],
        ).unwrap();
        let n_before: i64 = c.query_row("SELECT count(*) FROM app_license", [], |r| r.get(0)).unwrap();
        assert_eq!(n_before, 1);
        c.execute("DELETE FROM app_license WHERE id = 'singleton'", []).unwrap();
        let n_after: i64 = c.query_row("SELECT count(*) FROM app_license", [], |r| r.get(0)).unwrap();
        assert_eq!(n_after, 0);
    }
}
