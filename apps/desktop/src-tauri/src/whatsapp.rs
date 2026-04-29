// whatsapp.rs — Tauri commands for the persistent WhatsApp outbound queue.
//
// Backed by table `whatsapp_outbox` (migration 0044). The actual sending is
// performed by JS-side workers that pull queued messages, render via the
// transport injected at runtime (Cloud API / Gupshup / MSG91), and push the
// status back via mark_sent / mark_failed.

use crate::db::DbState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppOutboxRow {
    pub id: String,
    pub to_phone: String,
    pub template_key: String,
    pub locale: String,
    pub values_json: String,
    pub rendered_body: String,
    pub status: String,
    pub attempts: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_attempt_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_attempt_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueInput {
    pub id: String,
    pub to_phone: String,
    pub template_key: String,
    pub locale: String,
    pub values_json: String,
    pub rendered_body: String,
}

fn now_iso() -> String {
    use chrono::Utc;
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

#[tauri::command]
pub fn whatsapp_enqueue(input: EnqueueInput, state: State<'_, DbState>) -> Result<WhatsAppOutboxRow, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    c.execute(
        "INSERT INTO whatsapp_outbox \
            (id, to_phone, template_key, locale, values_json, rendered_body, status, attempts, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', 0, ?7, ?7)",
        params![
            input.id, input.to_phone, input.template_key, input.locale,
            input.values_json, input.rendered_body, now,
        ],
    ).map_err(|e| e.to_string())?;

    fetch_one(&c, &input.id).map_err(|e| e.to_string())?
        .ok_or_else(|| "INSERT_LOST".into())
}

#[tauri::command]
pub fn whatsapp_list(
    status: Option<String>,
    limit: Option<i64>,
    state: State<'_, DbState>,
) -> Result<Vec<WhatsAppOutboxRow>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(50).clamp(1, 500);
    let (sql, used_status) = match status {
        Some(s) => ("SELECT * FROM whatsapp_outbox WHERE status = ?1 ORDER BY created_at DESC LIMIT ?2", Some(s)),
        None    => ("SELECT * FROM whatsapp_outbox ORDER BY created_at DESC LIMIT ?2", None),
    };
    let mut stmt = c.prepare(sql).map_err(|e| e.to_string())?;
    let map = |r: &rusqlite::Row<'_>| -> rusqlite::Result<WhatsAppOutboxRow> {
        Ok(WhatsAppOutboxRow {
            id: r.get("id")?,
            to_phone: r.get("to_phone")?,
            template_key: r.get("template_key")?,
            locale: r.get("locale")?,
            values_json: r.get("values_json")?,
            rendered_body: r.get("rendered_body")?,
            status: r.get("status")?,
            attempts: r.get("attempts")?,
            next_attempt_at: r.get("next_attempt_at")?,
            last_attempt_at: r.get("last_attempt_at")?,
            provider_message_id: r.get("provider_message_id")?,
            error_reason: r.get("error_reason")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
        })
    };
    let rows = if let Some(s) = used_status {
        stmt.query_map(params![s, lim], map).map_err(|e| e.to_string())?.collect::<Vec<_>>()
    } else {
        stmt.query_map(params![lim], map).map_err(|e| e.to_string())?.collect::<Vec<_>>()
    };
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn whatsapp_mark_sent(
    id: String,
    provider_message_id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    c.execute(
        "UPDATE whatsapp_outbox SET \
            status = 'sent', provider_message_id = ?1, \
            attempts = attempts + 1, last_attempt_at = ?2, updated_at = ?2 \
         WHERE id = ?3",
        params![provider_message_id, now, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn whatsapp_mark_failed(
    id: String,
    error_reason: String,
    next_attempt_at: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    c.execute(
        "UPDATE whatsapp_outbox SET \
            status = 'failed', error_reason = ?1, \
            attempts = attempts + 1, last_attempt_at = ?2, \
            next_attempt_at = ?3, updated_at = ?2 \
         WHERE id = ?4",
        params![error_reason, now, next_attempt_at, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn whatsapp_mark_delivered(
    id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    c.execute(
        "UPDATE whatsapp_outbox SET status = 'delivered', updated_at = ?1 WHERE id = ?2",
        params![now, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn fetch_one(c: &rusqlite::Connection, id: &str) -> rusqlite::Result<Option<WhatsAppOutboxRow>> {
    c.query_row(
        "SELECT id, to_phone, template_key, locale, values_json, rendered_body, \
                status, attempts, next_attempt_at, last_attempt_at, \
                provider_message_id, error_reason, created_at, updated_at \
         FROM whatsapp_outbox WHERE id = ?1",
        params![id],
        |r| {
            Ok(WhatsAppOutboxRow {
                id: r.get(0)?,
                to_phone: r.get(1)?,
                template_key: r.get(2)?,
                locale: r.get(3)?,
                values_json: r.get(4)?,
                rendered_body: r.get(5)?,
                status: r.get(6)?,
                attempts: r.get(7)?,
                next_attempt_at: r.get(8)?,
                last_attempt_at: r.get(9)?,
                provider_message_id: r.get(10)?,
                error_reason: r.get(11)?,
                created_at: r.get(12)?,
                updated_at: r.get(13)?,
            })
        },
    ).optional()
}
