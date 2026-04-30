// cold_chain.rs — BLE-temp sensor logging + excursion alerts.
// Migration 0030. Pairs with @pharmacare/cold-chain (alert state machine).

use crate::db::DbState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColdChainSensor {
    pub id: String,
    pub shop_id: String,
    pub ble_mac: String,
    pub label: String,
    pub min_safe_c: f64,
    pub max_safe_c: f64,
    pub installed_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSensorInput {
    pub id: String,
    pub shop_id: String,
    pub ble_mac: String,
    pub label: String,
    pub min_safe_c: Option<f64>,
    pub max_safe_c: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColdChainReading {
    pub id: i64,
    pub sensor_id: String,
    pub temp_c: f64,
    pub recorded_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogReadingInput {
    pub sensor_id: String,
    pub temp_c: f64,
    pub recorded_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColdChainExcursion {
    pub id: i64,
    pub sensor_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batch_id: Option<String>,
    pub excursion_start: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excursion_end: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_temp_c: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_temp_c: Option<f64>,
    pub minutes_outside: i64,
    pub aefi_filed: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

fn now_iso() -> String {
    use chrono::Utc;
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

#[tauri::command]
pub fn cold_chain_upsert_sensor(
    input: UpsertSensorInput,
    state: State<'_, DbState>,
) -> Result<ColdChainSensor, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let min_c = input.min_safe_c.unwrap_or(2.0);
    let max_c = input.max_safe_c.unwrap_or(8.0);
    c.execute(
        "INSERT INTO cold_chain_sensors (id, shop_id, ble_mac, label, min_safe_c, max_safe_c) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
         ON CONFLICT(ble_mac) DO UPDATE SET \
            label = excluded.label, \
            min_safe_c = excluded.min_safe_c, \
            max_safe_c = excluded.max_safe_c",
        params![input.id, input.shop_id, input.ble_mac, input.label, min_c, max_c],
    ).map_err(|e| e.to_string())?;
    c.query_row(
        "SELECT id, shop_id, ble_mac, label, min_safe_c, max_safe_c, installed_at \
         FROM cold_chain_sensors WHERE ble_mac = ?1",
        params![input.ble_mac],
        |r| Ok(ColdChainSensor {
            id: r.get(0)?, shop_id: r.get(1)?, ble_mac: r.get(2)?, label: r.get(3)?,
            min_safe_c: r.get(4)?, max_safe_c: r.get(5)?, installed_at: r.get(6)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cold_chain_list_sensors(
    shop_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<ColdChainSensor>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c.prepare(
        "SELECT id, shop_id, ble_mac, label, min_safe_c, max_safe_c, installed_at \
         FROM cold_chain_sensors WHERE shop_id = ?1 ORDER BY installed_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows: Vec<ColdChainSensor> = stmt.query_map(params![shop_id], |r| {
        Ok(ColdChainSensor {
            id: r.get(0)?, shop_id: r.get(1)?, ble_mac: r.get(2)?, label: r.get(3)?,
            min_safe_c: r.get(4)?, max_safe_c: r.get(5)?, installed_at: r.get(6)?,
        })
    }).map_err(|e| e.to_string())?
       .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn cold_chain_log_reading(
    input: LogReadingInput,
    state: State<'_, DbState>,
) -> Result<i64, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let recorded = input.recorded_at.unwrap_or_else(now_iso);
    c.execute(
        "INSERT INTO cold_chain_readings (sensor_id, temp_c, recorded_at) VALUES (?1, ?2, ?3)",
        params![input.sensor_id, input.temp_c, recorded],
    ).map_err(|e| e.to_string())?;
    Ok(c.last_insert_rowid())
}

#[tauri::command]
pub fn cold_chain_list_excursions(
    sensor_id: Option<String>,
    open_only: Option<bool>,
    limit: Option<i64>,
    state: State<'_, DbState>,
) -> Result<Vec<ColdChainExcursion>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(100).clamp(1, 500);
    let only_open = open_only.unwrap_or(false);
    let map = |r: &rusqlite::Row<'_>| -> rusqlite::Result<ColdChainExcursion> {
        Ok(ColdChainExcursion {
            id: r.get(0)?, sensor_id: r.get(1)?, batch_id: r.get(2)?,
            excursion_start: r.get(3)?, excursion_end: r.get(4)?,
            min_temp_c: r.get(5)?, max_temp_c: r.get(6)?,
            minutes_outside: r.get(7)?, aefi_filed: r.get(8)?,
            notes: r.get(9)?,
        })
    };
    let cols = "id, sensor_id, batch_id, excursion_start, excursion_end, min_temp_c, max_temp_c, minutes_outside, aefi_filed, notes";
    let rows: Vec<ColdChainExcursion> = match (sensor_id, only_open) {
        (Some(s), true) => c.prepare(&format!("SELECT {cols} FROM cold_chain_excursions WHERE sensor_id = ?1 AND excursion_end IS NULL ORDER BY excursion_start DESC LIMIT ?2"))
            .map_err(|e| e.to_string())?
            .query_map(params![s, lim], map).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?,
        (Some(s), false) => c.prepare(&format!("SELECT {cols} FROM cold_chain_excursions WHERE sensor_id = ?1 ORDER BY excursion_start DESC LIMIT ?2"))
            .map_err(|e| e.to_string())?
            .query_map(params![s, lim], map).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?,
        (None, true) => c.prepare(&format!("SELECT {cols} FROM cold_chain_excursions WHERE excursion_end IS NULL ORDER BY excursion_start DESC LIMIT ?1"))
            .map_err(|e| e.to_string())?
            .query_map(params![lim], map).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?,
        (None, false) => c.prepare(&format!("SELECT {cols} FROM cold_chain_excursions ORDER BY excursion_start DESC LIMIT ?1"))
            .map_err(|e| e.to_string())?
            .query_map(params![lim], map).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?,
    };
    Ok(rows)
}

#[tauri::command]
pub fn cold_chain_close_excursion(
    excursion_id: i64,
    notes: Option<String>,
    aefi_filed: Option<bool>,
    state: State<'_, DbState>,
) -> Result<Option<ColdChainExcursion>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    let aefi = if aefi_filed.unwrap_or(false) { 1i64 } else { 0i64 };
    c.execute(
        "UPDATE cold_chain_excursions SET excursion_end = ?1, notes = COALESCE(?2, notes), aefi_filed = ?3 WHERE id = ?4",
        params![now, notes, aefi, excursion_id],
    ).map_err(|e| e.to_string())?;
    c.query_row(
        "SELECT id, sensor_id, batch_id, excursion_start, excursion_end, min_temp_c, max_temp_c, minutes_outside, aefi_filed, notes \
         FROM cold_chain_excursions WHERE id = ?1",
        params![excursion_id],
        |r| Ok(ColdChainExcursion {
            id: r.get(0)?, sensor_id: r.get(1)?, batch_id: r.get(2)?,
            excursion_start: r.get(3)?, excursion_end: r.get(4)?,
            min_temp_c: r.get(5)?, max_temp_c: r.get(6)?,
            minutes_outside: r.get(7)?, aefi_filed: r.get(8)?,
            notes: r.get(9)?,
        }),
    ).optional().map_err(|e| e.to_string())
}
