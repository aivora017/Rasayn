// abdm.rs — ABDM/ABHA verification + dispensation log Tauri commands.
// Tables: abha_profiles + abdm_dispensations (migration 0032).

use crate::db::DbState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AbhaProfile {
    pub customer_id: String,
    pub abha_number: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dob: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gender: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mobile_e164: Option<String>,
    pub verified_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consent_token_encrypted: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAbhaProfileInput {
    pub customer_id: String,
    pub abha_number: String,
    pub name: String,
    pub dob: Option<String>,
    pub gender: Option<String>,
    pub mobile_e164: Option<String>,
    pub consent_token_encrypted: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AbdmDispensation {
    pub bill_id: String,
    pub abha_number: String,
    pub fhir_payload_json: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uhi_event_id: Option<String>,
    pub pushed_at: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogDispensationInput {
    pub bill_id: String,
    pub abha_number: String,
    pub fhir_payload_json: String,
    pub uhi_event_id: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

fn now_iso() -> String {
    use chrono::Utc;
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

#[tauri::command]
pub fn abdm_upsert_profile(
    input: UpsertAbhaProfileInput,
    state: State<'_, DbState>,
) -> Result<AbhaProfile, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    c.execute(
        "INSERT INTO abha_profiles \
           (customer_id, abha_number, name, dob, gender, mobile_e164, verified_at, consent_token_encrypted) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
         ON CONFLICT(customer_id) DO UPDATE SET \
           abha_number = excluded.abha_number, \
           name = excluded.name, \
           dob = excluded.dob, \
           gender = excluded.gender, \
           mobile_e164 = excluded.mobile_e164, \
           verified_at = excluded.verified_at, \
           consent_token_encrypted = excluded.consent_token_encrypted",
        params![
            input.customer_id, input.abha_number, input.name, input.dob, input.gender,
            input.mobile_e164, now, input.consent_token_encrypted
        ],
    ).map_err(|e| e.to_string())?;
    c.query_row(
        "SELECT customer_id, abha_number, name, dob, gender, mobile_e164, verified_at, consent_token_encrypted \
         FROM abha_profiles WHERE customer_id = ?1",
        params![input.customer_id],
        |r| Ok(AbhaProfile {
            customer_id: r.get(0)?, abha_number: r.get(1)?, name: r.get(2)?,
            dob: r.get(3)?, gender: r.get(4)?, mobile_e164: r.get(5)?,
            verified_at: r.get(6)?, consent_token_encrypted: r.get(7)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn abdm_get_profile(
    customer_id: String,
    state: State<'_, DbState>,
) -> Result<Option<AbhaProfile>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.query_row(
        "SELECT customer_id, abha_number, name, dob, gender, mobile_e164, verified_at, consent_token_encrypted \
         FROM abha_profiles WHERE customer_id = ?1",
        params![customer_id],
        |r| Ok(AbhaProfile {
            customer_id: r.get(0)?, abha_number: r.get(1)?, name: r.get(2)?,
            dob: r.get(3)?, gender: r.get(4)?, mobile_e164: r.get(5)?,
            verified_at: r.get(6)?, consent_token_encrypted: r.get(7)?,
        }),
    ).optional().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn abdm_revoke_consent(
    customer_id: String,
    state: State<'_, DbState>,
) -> Result<usize, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute(
        "UPDATE abha_profiles SET consent_token_encrypted = NULL WHERE customer_id = ?1",
        params![customer_id],
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn abdm_log_dispensation(
    input: LogDispensationInput,
    state: State<'_, DbState>,
) -> Result<AbdmDispensation, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO abdm_dispensations \
           (bill_id, abha_number, fhir_payload_json, uhi_event_id, status, error) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
         ON CONFLICT(bill_id) DO UPDATE SET \
           uhi_event_id = excluded.uhi_event_id, \
           status = excluded.status, \
           error = excluded.error, \
           pushed_at = datetime('now')",
        params![input.bill_id, input.abha_number, input.fhir_payload_json,
                input.uhi_event_id, input.status, input.error],
    ).map_err(|e| e.to_string())?;
    c.query_row(
        "SELECT bill_id, abha_number, fhir_payload_json, uhi_event_id, pushed_at, status, error \
         FROM abdm_dispensations WHERE bill_id = ?1",
        params![input.bill_id],
        |r| Ok(AbdmDispensation {
            bill_id: r.get(0)?, abha_number: r.get(1)?, fhir_payload_json: r.get(2)?,
            uhi_event_id: r.get(3)?, pushed_at: r.get(4)?, status: r.get(5)?, error: r.get(6)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn abdm_list_dispensations(
    abha_number: Option<String>,
    limit: Option<i64>,
    state: State<'_, DbState>,
) -> Result<Vec<AbdmDispensation>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(50).clamp(1, 500);
    let map = |r: &rusqlite::Row<'_>| -> rusqlite::Result<AbdmDispensation> {
        Ok(AbdmDispensation {
            bill_id: r.get(0)?, abha_number: r.get(1)?, fhir_payload_json: r.get(2)?,
            uhi_event_id: r.get(3)?, pushed_at: r.get(4)?, status: r.get(5)?, error: r.get(6)?,
        })
    };
    let rows: Vec<AbdmDispensation> = if let Some(a) = abha_number {
        let mut stmt = c.prepare(
            "SELECT bill_id, abha_number, fhir_payload_json, uhi_event_id, pushed_at, status, error \
             FROM abdm_dispensations WHERE abha_number = ?1 ORDER BY pushed_at DESC LIMIT ?2"
        ).map_err(|e| e.to_string())?;
        let collected = stmt.query_map(params![a, lim], map)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        collected
    } else {
        let mut stmt = c.prepare(
            "SELECT bill_id, abha_number, fhir_payload_json, uhi_event_id, pushed_at, status, error \
             FROM abdm_dispensations ORDER BY pushed_at DESC LIMIT ?1"
        ).map_err(|e| e.to_string())?;
        let collected = stmt.query_map(params![lim], map)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        collected
    };
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use crate::db::apply_migrations;

    fn seed_customer(c: &Connection) {
        c.execute_batch(
            "INSERT INTO customers (id, shop_id, name, phone, gender, consent_abdm, consent_marketing, created_at) \
             VALUES ('c1', 'shop_local', 'Priya Sharma', '+919999999999', 'F', 1, 0, '2026-01-01');"
        ).unwrap();
    }

    #[test]
    fn migration_0032_creates_abha_tables() {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        for tbl in ["abha_profiles", "abdm_dispensations"] {
            let n: i64 = c.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                params![tbl], |r| r.get(0),
            ).unwrap();
            assert_eq!(n, 1, "table {tbl} missing");
        }
    }

    #[test]
    fn upsert_then_query_profile() {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        seed_customer(&c);
        c.execute(
            "INSERT INTO abha_profiles (customer_id, abha_number, name, verified_at) \
             VALUES ('c1', '12-3456-7890-1234', 'Priya Sharma', '2026-04-29T10:00:00Z')",
            [],
        ).unwrap();
        let row: (String, String) = c.query_row(
            "SELECT abha_number, name FROM abha_profiles WHERE customer_id = 'c1'",
            [], |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(row.0, "12-3456-7890-1234");
        assert_eq!(row.1, "Priya Sharma");
    }

    #[test]
    fn dispensation_status_check_rejects_invalid() {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        let r = c.execute(
            "INSERT INTO abdm_dispensations (bill_id, abha_number, fhir_payload_json, status) \
             VALUES ('b1', '12-3456-7890-1234', '{}', 'invalid_status')",
            [],
        );
        assert!(r.is_err(), "status check should reject invalid values");
    }
}
