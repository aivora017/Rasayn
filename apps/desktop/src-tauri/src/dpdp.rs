// dpdp.rs — DPDP Act consent registry + data-subject-rights queue.
// Migration 0033. Pairs with @pharmacare/dpdp.

use crate::db::DbState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DpdpConsent {
    pub customer_id: String,
    pub purpose: String,
    pub granted: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub granted_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub withdrawn_at: Option<String>,
    pub evidence: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertConsentInput {
    pub customer_id: String,
    pub purpose: String,
    pub granted: bool,
    pub evidence: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DpdpDsrRequest {
    pub id: String,
    pub customer_id: String,
    pub kind: String,
    pub received_at: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fulfilled_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_payload_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handled_by_user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDsrInput {
    pub id: String,
    pub customer_id: String,
    pub kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDsrStatusInput {
    pub id: String,
    pub status: String,
    pub response_payload_path: Option<String>,
    pub handled_by_user_id: Option<String>,
}

fn now_iso() -> String {
    use chrono::Utc;
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

#[tauri::command]
pub fn dpdp_upsert_consent(
    input: UpsertConsentInput,
    state: State<'_, DbState>,
) -> Result<DpdpConsent, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    let granted_int: i64 = if input.granted { 1 } else { 0 };
    c.execute(
        "INSERT INTO dpdp_consents (customer_id, purpose, granted, granted_at, withdrawn_at, evidence) \
         VALUES (?1, ?2, ?3, CASE ?3 WHEN 1 THEN ?4 ELSE NULL END, CASE ?3 WHEN 0 THEN ?4 ELSE NULL END, ?5) \
         ON CONFLICT(customer_id, purpose) DO UPDATE SET \
            granted = excluded.granted, \
            granted_at = CASE excluded.granted WHEN 1 THEN excluded.granted_at ELSE dpdp_consents.granted_at END, \
            withdrawn_at = CASE excluded.granted WHEN 0 THEN excluded.withdrawn_at ELSE dpdp_consents.withdrawn_at END, \
            evidence = excluded.evidence",
        params![input.customer_id, input.purpose, granted_int, now, input.evidence],
    ).map_err(|e| e.to_string())?;
    c.query_row(
        "SELECT customer_id, purpose, granted, granted_at, withdrawn_at, evidence \
         FROM dpdp_consents WHERE customer_id = ?1 AND purpose = ?2",
        params![input.customer_id, input.purpose],
        |r| Ok(DpdpConsent {
            customer_id: r.get(0)?, purpose: r.get(1)?, granted: r.get(2)?,
            granted_at: r.get(3)?, withdrawn_at: r.get(4)?, evidence: r.get(5)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dpdp_list_consents(
    customer_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<DpdpConsent>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c.prepare(
        "SELECT customer_id, purpose, granted, granted_at, withdrawn_at, evidence \
         FROM dpdp_consents WHERE customer_id = ?1 ORDER BY purpose"
    ).map_err(|e| e.to_string())?;
    let rows: Vec<DpdpConsent> = stmt.query_map(params![customer_id], |r| {
        Ok(DpdpConsent {
            customer_id: r.get(0)?, purpose: r.get(1)?, granted: r.get(2)?,
            granted_at: r.get(3)?, withdrawn_at: r.get(4)?, evidence: r.get(5)?,
        })
    }).map_err(|e| e.to_string())?
       .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn dpdp_open_dsr(
    input: OpenDsrInput,
    state: State<'_, DbState>,
) -> Result<DpdpDsrRequest, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO dpdp_dsr_requests (id, customer_id, kind) VALUES (?1, ?2, ?3)",
        params![input.id, input.customer_id, input.kind],
    ).map_err(|e| e.to_string())?;
    c.query_row(
        "SELECT id, customer_id, kind, received_at, status, fulfilled_at, response_payload_path, handled_by_user_id \
         FROM dpdp_dsr_requests WHERE id = ?1",
        params![input.id],
        |r| Ok(DpdpDsrRequest {
            id: r.get(0)?, customer_id: r.get(1)?, kind: r.get(2)?,
            received_at: r.get(3)?, status: r.get(4)?, fulfilled_at: r.get(5)?,
            response_payload_path: r.get(6)?, handled_by_user_id: r.get(7)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dpdp_update_dsr_status(
    input: UpdateDsrStatusInput,
    state: State<'_, DbState>,
) -> Result<Option<DpdpDsrRequest>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    let fulfilled_at: Option<String> = if input.status == "fulfilled" { Some(now) } else { None };
    c.execute(
        "UPDATE dpdp_dsr_requests SET \
            status = ?1, \
            fulfilled_at = COALESCE(?2, fulfilled_at), \
            response_payload_path = COALESCE(?3, response_payload_path), \
            handled_by_user_id = COALESCE(?4, handled_by_user_id) \
         WHERE id = ?5",
        params![input.status, fulfilled_at, input.response_payload_path, input.handled_by_user_id, input.id],
    ).map_err(|e| e.to_string())?;
    c.query_row(
        "SELECT id, customer_id, kind, received_at, status, fulfilled_at, response_payload_path, handled_by_user_id \
         FROM dpdp_dsr_requests WHERE id = ?1",
        params![input.id],
        |r| Ok(DpdpDsrRequest {
            id: r.get(0)?, customer_id: r.get(1)?, kind: r.get(2)?,
            received_at: r.get(3)?, status: r.get(4)?, fulfilled_at: r.get(5)?,
            response_payload_path: r.get(6)?, handled_by_user_id: r.get(7)?,
        }),
    ).optional().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dpdp_list_dsr(
    open_only: Option<bool>,
    limit: Option<i64>,
    state: State<'_, DbState>,
) -> Result<Vec<DpdpDsrRequest>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(100).clamp(1, 500);
    let map = |r: &rusqlite::Row<'_>| -> rusqlite::Result<DpdpDsrRequest> {
        Ok(DpdpDsrRequest {
            id: r.get(0)?, customer_id: r.get(1)?, kind: r.get(2)?,
            received_at: r.get(3)?, status: r.get(4)?, fulfilled_at: r.get(5)?,
            response_payload_path: r.get(6)?, handled_by_user_id: r.get(7)?,
        })
    };
    let cols = "id, customer_id, kind, received_at, status, fulfilled_at, response_payload_path, handled_by_user_id";
    let rows: Vec<DpdpDsrRequest> = if open_only.unwrap_or(false) {
        c.prepare(&format!("SELECT {cols} FROM dpdp_dsr_requests WHERE status NOT IN ('fulfilled','rejected') ORDER BY received_at ASC LIMIT ?1"))
            .map_err(|e| e.to_string())?
            .query_map(params![lim], map).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    } else {
        c.prepare(&format!("SELECT {cols} FROM dpdp_dsr_requests ORDER BY received_at DESC LIMIT ?1"))
            .map_err(|e| e.to_string())?
            .query_map(params![lim], map).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    Ok(rows)
}
