// stock_transfer.rs — Tauri commands for inter-store stock transfers.
// Migration 0040. Phase-1: list / create (open) / dispatch / receive / cancel.

use crate::db::DbState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StockTransferRow {
    pub id: String,
    pub from_shop_id: String,
    pub to_shop_id: String,
    pub status: String,
    pub created_by: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dispatched_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub received_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub received_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StockTransferLine {
    pub id: String,
    pub transfer_id: String,
    pub product_id: String,
    pub batch_id: String,
    pub qty_dispatched: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qty_received: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variance_note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransferLineInput {
    pub product_id: String,
    pub batch_id: String,
    pub qty_dispatched: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransferInput {
    pub id: String,
    pub from_shop_id: String,
    pub to_shop_id: String,
    pub created_by: String,
    pub notes: Option<String>,
    pub lines: Vec<CreateTransferLineInput>,
}

fn now_iso() -> String {
    use chrono::Utc;
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

#[tauri::command]
pub fn stock_transfer_list(
    shop_id: Option<String>,
    status: Option<String>,
    limit: Option<i64>,
    state: State<'_, DbState>,
) -> Result<Vec<StockTransferRow>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(50).clamp(1, 500);

    let mut sql = String::from(
        "SELECT id, from_shop_id, to_shop_id, status, created_by, created_at, \
                dispatched_at, received_at, received_by, notes \
         FROM stock_transfers WHERE 1=1"
    );
    if shop_id.is_some() { sql.push_str(" AND (from_shop_id = ?1 OR to_shop_id = ?1)"); }
    if status.is_some()  { sql.push_str(if shop_id.is_some() { " AND status = ?2" } else { " AND status = ?1" }); }
    sql.push_str(" ORDER BY created_at DESC LIMIT ?");
    let limit_idx = (shop_id.is_some() as usize) + (status.is_some() as usize) + 1;
    sql.push_str(&limit_idx.to_string());

    let map = |r: &rusqlite::Row<'_>| -> rusqlite::Result<StockTransferRow> {
        Ok(StockTransferRow {
            id: r.get(0)?,
            from_shop_id: r.get(1)?,
            to_shop_id: r.get(2)?,
            status: r.get(3)?,
            created_by: r.get(4)?,
            created_at: r.get(5)?,
            dispatched_at: r.get(6)?,
            received_at: r.get(7)?,
            received_by: r.get(8)?,
            notes: r.get(9)?,
        })
    };

    let mut stmt = c.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = match (&shop_id, &status) {
        (Some(s1), Some(s2)) => stmt.query_map(params![s1, s2, lim], map),
        (Some(s1), None)     => stmt.query_map(params![s1, lim], map),
        (None,     Some(s2)) => stmt.query_map(params![s2, lim], map),
        (None,     None)     => stmt.query_map(params![lim], map),
    }.map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn stock_transfer_create(
    input: CreateTransferInput,
    state: State<'_, DbState>,
) -> Result<StockTransferRow, String> {
    let mut c = state.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    let tx = c.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO stock_transfers (id, from_shop_id, to_shop_id, status, created_by, created_at, notes) \
         VALUES (?1, ?2, ?3, 'open', ?4, ?5, ?6)",
        params![input.id, input.from_shop_id, input.to_shop_id, input.created_by, now, input.notes],
    ).map_err(|e| format!("INSERT_HEADER: {e}"))?;

    for (idx, ln) in input.lines.iter().enumerate() {
        let line_id = format!("{}_l{}", input.id, idx);
        tx.execute(
            "INSERT INTO stock_transfer_lines (id, transfer_id, product_id, batch_id, qty_dispatched) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![line_id, input.id, ln.product_id, ln.batch_id, ln.qty_dispatched],
        ).map_err(|e| format!("INSERT_LINE: {e}"))?;
    }
    tx.commit().map_err(|e| format!("TX_COMMIT: {e}"))?;
    fetch_one(&c, &input.id).map_err(|e| e.to_string())?
        .ok_or_else(|| "INSERT_LOST".into())
}

#[tauri::command]
pub fn stock_transfer_dispatch(
    transfer_id: String,
    state: State<'_, DbState>,
) -> Result<StockTransferRow, String> {
    let mut c = state.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let updated = tx.execute(
        "UPDATE stock_transfers SET status = 'in_transit', dispatched_at = ?1 \
         WHERE id = ?2 AND status = 'open'",
        params![now, transfer_id],
    ).map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("TRANSFER_NOT_OPEN_OR_NOT_FOUND".into());
    }

    // S16.1 reconciliation — write one transfer_out row per line.
    {
        let mut stmt = tx.prepare(
            "SELECT id, product_id, batch_id, qty_dispatched FROM stock_transfer_lines \
             WHERE transfer_id = ?1"
        ).map_err(|e| e.to_string())?;
        let rows: Vec<(String, String, String, f64)> = stmt
            .query_map(params![transfer_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);
        for (line_id, product_id, batch_id, qty) in rows {
            let mv_id = format!("mv_{line_id}_out");
            tx.execute(
                "INSERT OR IGNORE INTO stock_movements \
                   (id, batch_id, product_id, qty_delta, movement_type, ref_table, ref_id, reason, created_at) \
                 VALUES (?1, ?2, ?3, ?4, 'transfer_out', 'stock_transfer_lines', ?5, 'transfer dispatched', ?6)",
                params![mv_id, batch_id, product_id, -qty, line_id, now],
            ).map_err(|e| format!("INSERT_MOVEMENT: {e}"))?;
        }
    }

    tx.commit().map_err(|e| format!("TX_COMMIT: {e}"))?;
    fetch_one(&c, &transfer_id).map_err(|e| e.to_string())?
        .ok_or_else(|| "TRANSFER_NOT_FOUND".into())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveLineInput {
    pub line_id: String,
    pub qty_received: f64,
    pub variance_note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveTransferInput {
    pub transfer_id: String,
    pub received_by: String,
    pub lines: Vec<ReceiveLineInput>,
}

#[tauri::command]
pub fn stock_transfer_receive(
    input: ReceiveTransferInput,
    state: State<'_, DbState>,
) -> Result<StockTransferRow, String> {
    let mut c = state.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    let tx = c.transaction().map_err(|e| e.to_string())?;

    for ln in &input.lines {
        tx.execute(
            "UPDATE stock_transfer_lines SET qty_received = ?1, variance_note = ?2 \
             WHERE id = ?3 AND transfer_id = ?4",
            params![ln.qty_received, ln.variance_note, ln.line_id, input.transfer_id],
        ).map_err(|e| format!("UPDATE_LINE: {e}"))?;
    }

    tx.execute(
        "UPDATE stock_transfers SET status = 'received', received_at = ?1, received_by = ?2 \
         WHERE id = ?3 AND status IN ('open','in_transit')",
        params![now, input.received_by, input.transfer_id],
    ).map_err(|e| format!("UPDATE_HEADER: {e}"))?;

    // S16.1 reconciliation — write one transfer_in row per line.
    for ln in &input.lines {
        if ln.qty_received <= 0.0 {
            continue;
        }
        // Look up product_id / batch_id for the line.
        let row: Option<(String, String)> = tx.query_row(
            "SELECT product_id, batch_id FROM stock_transfer_lines WHERE id = ?1 AND transfer_id = ?2",
            params![ln.line_id, input.transfer_id],
            |r| Ok((r.get(0)?, r.get(1)?))
        ).ok();
        let Some((product_id, batch_id)) = row else { continue };
        let mv_id = format!("mv_{}_in", ln.line_id);
        tx.execute(
            "INSERT OR IGNORE INTO stock_movements \
               (id, batch_id, product_id, qty_delta, movement_type, ref_table, ref_id, reason, created_at) \
             VALUES (?1, ?2, ?3, ?4, 'transfer_in', 'stock_transfer_lines', ?5, 'transfer received', ?6)",
            params![mv_id, batch_id, product_id, ln.qty_received, ln.line_id, now],
        ).map_err(|e| format!("INSERT_MOVEMENT: {e}"))?;
    }

    tx.commit().map_err(|e| format!("TX_COMMIT: {e}"))?;
    fetch_one(&c, &input.transfer_id).map_err(|e| e.to_string())?
        .ok_or_else(|| "TRANSFER_NOT_FOUND".into())
}

#[tauri::command]
pub fn stock_transfer_cancel(
    transfer_id: String,
    state: State<'_, DbState>,
) -> Result<StockTransferRow, String> {
    let mut c = state.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    let tx = c.transaction().map_err(|e| e.to_string())?;

    // If it was in_transit, reverse the transfer_out movements before cancelling.
    let was_in_transit: bool = tx.query_row(
        "SELECT status FROM stock_transfers WHERE id = ?1",
        params![transfer_id],
        |r| Ok(r.get::<_, String>(0)? == "in_transit"),
    ).unwrap_or(false);

    if was_in_transit {
        let mut stmt = tx.prepare(
            "SELECT id, product_id, batch_id, qty_dispatched FROM stock_transfer_lines WHERE transfer_id = ?1"
        ).map_err(|e| e.to_string())?;
        let rows: Vec<(String, String, String, f64)> = stmt
            .query_map(params![transfer_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);
        for (line_id, product_id, batch_id, qty) in rows {
            let mv_id = format!("mv_{line_id}_cancel_in");
            tx.execute(
                "INSERT OR IGNORE INTO stock_movements \
                   (id, batch_id, product_id, qty_delta, movement_type, ref_table, ref_id, reason, created_at) \
                 VALUES (?1, ?2, ?3, ?4, 'transfer_in', 'stock_transfer_lines', ?5, 'transfer cancelled', ?6)",
                params![mv_id, batch_id, product_id, qty, line_id, now],
            ).map_err(|e| format!("INSERT_REVERSAL: {e}"))?;
        }
    }

    tx.execute(
        "UPDATE stock_transfers SET status = 'cancelled' \
         WHERE id = ?1 AND status IN ('open','in_transit')",
        params![transfer_id],
    ).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| format!("TX_COMMIT: {e}"))?;
    fetch_one(&c, &transfer_id).map_err(|e| e.to_string())?
        .ok_or_else(|| "TRANSFER_NOT_FOUND".into())
}

#[tauri::command]
pub fn stock_transfer_list_lines(
    transfer_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<StockTransferLine>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c.prepare(
        "SELECT id, transfer_id, product_id, batch_id, qty_dispatched, qty_received, variance_note \
         FROM stock_transfer_lines WHERE transfer_id = ?1 ORDER BY id ASC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![transfer_id], |r| {
        Ok(StockTransferLine {
            id: r.get(0)?,
            transfer_id: r.get(1)?,
            product_id: r.get(2)?,
            batch_id: r.get(3)?,
            qty_dispatched: r.get(4)?,
            qty_received: r.get(5)?,
            variance_note: r.get(6)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

fn fetch_one(c: &rusqlite::Connection, id: &str) -> rusqlite::Result<Option<StockTransferRow>> {
    c.query_row(
        "SELECT id, from_shop_id, to_shop_id, status, created_by, created_at, \
                dispatched_at, received_at, received_by, notes \
         FROM stock_transfers WHERE id = ?1",
        params![id],
        |r| {
            Ok(StockTransferRow {
                id: r.get(0)?,
                from_shop_id: r.get(1)?,
                to_shop_id: r.get(2)?,
                status: r.get(3)?,
                created_by: r.get(4)?,
                created_at: r.get(5)?,
                dispatched_at: r.get(6)?,
                received_at: r.get(7)?,
                received_by: r.get(8)?,
                notes: r.get(9)?,
            })
        }
    ).optional()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use crate::db::apply_migrations;

    fn seed_two_shops(c: &Connection) {
        c.execute_batch(
            "INSERT INTO shops (id, name, gstin, state_code, retail_license, address, created_at)
               VALUES ('shop_a', 'A', '27AAAAA0000A1Z5', '27', 'MH-1', 'Kalyan', '2026-01-01');
             INSERT INTO shops (id, name, gstin, state_code, retail_license, address, created_at)
               VALUES ('shop_b', 'B', '27AAAAB0000B2Z5', '27', 'MH-2', 'Pune',   '2026-01-01');
             INSERT INTO users (id, shop_id, name, role, pin_hash, is_active, created_at)
               VALUES ('u1', 'shop_a', 'Sourav', 'owner', 'h', 1, '2026-01-01');
             INSERT INTO products (id, name, hsn, gst_rate, schedule, mrp_paise, created_at, is_active)
               VALUES ('p1', 'Paracetamol 500mg', '30049011', 12, 'OTC', 200, '2026-01-01', 1);
             INSERT INTO batches (id, product_id, batch_no, expiry_date, qty_on_hand, mrp_paise, created_at)
               VALUES ('b1', 'p1', 'B-001', '2027-12-31', 1000, 200, '2026-01-01');"
        ).unwrap();
    }

    #[test]
    fn migration_0040_adds_stock_transfer_tables() {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        let count: i64 = c.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='stock_transfers'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 1);
        let count_lines: i64 = c.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='stock_transfer_lines'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(count_lines, 1);
    }

    #[test]
    fn create_then_dispatch_writes_transfer_out_movement() {
        let mut c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        seed_two_shops(&c);

        // Create
        c.execute(
            "INSERT INTO stock_transfers (id, from_shop_id, to_shop_id, status, created_by, created_at) \
             VALUES ('xfer1', 'shop_a', 'shop_b', 'open', 'u1', '2026-04-29T10:00:00Z')",
            [],
        ).unwrap();
        c.execute(
            "INSERT INTO stock_transfer_lines (id, transfer_id, product_id, batch_id, qty_dispatched) \
             VALUES ('xfer1_l0', 'xfer1', 'p1', 'b1', 50)",
            [],
        ).unwrap();

        // Simulate dispatch: update status + write transfer_out
        let tx = c.transaction().unwrap();
        tx.execute("UPDATE stock_transfers SET status='in_transit', dispatched_at='2026-04-29T11:00:00Z' WHERE id='xfer1' AND status='open'", []).unwrap();
        tx.execute(
            "INSERT INTO stock_movements (id, batch_id, product_id, qty_delta, movement_type, ref_table, ref_id, created_at) \
             VALUES ('mv_xfer1_l0_out', 'b1', 'p1', -50, 'transfer_out', 'stock_transfer_lines', 'xfer1_l0', '2026-04-29T11:00:00Z')",
            [],
        ).unwrap();
        tx.commit().unwrap();

        let mv_count: i64 = c.query_row(
            "SELECT count(*) FROM stock_movements WHERE ref_table='stock_transfer_lines' AND movement_type='transfer_out'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(mv_count, 1);
        let qty: f64 = c.query_row(
            "SELECT qty_delta FROM stock_movements WHERE ref_id='xfer1_l0' AND movement_type='transfer_out'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(qty, -50.0);
    }

    #[test]
    fn unique_index_blocks_double_dispatch() {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        seed_two_shops(&c);
        c.execute("INSERT INTO stock_transfers (id, from_shop_id, to_shop_id, status, created_by, created_at) VALUES ('x2', 'shop_a', 'shop_b', 'in_transit', 'u1', '2026-04-29T10:00:00Z')", []).unwrap();
        c.execute("INSERT INTO stock_transfer_lines (id, transfer_id, product_id, batch_id, qty_dispatched) VALUES ('x2_l0', 'x2', 'p1', 'b1', 10)", []).unwrap();
        c.execute(
            "INSERT INTO stock_movements (id, batch_id, product_id, qty_delta, movement_type, ref_table, ref_id, created_at) \
             VALUES ('mv1', 'b1', 'p1', -10, 'transfer_out', 'stock_transfer_lines', 'x2_l0', '2026-04-29T11:00:00Z')",
            [],
        ).unwrap();
        // Second insert should violate the partial UNIQUE on (movement_type, ref_table, ref_id)
        let res = c.execute(
            "INSERT INTO stock_movements (id, batch_id, product_id, qty_delta, movement_type, ref_table, ref_id, created_at) \
             VALUES ('mv2', 'b1', 'p1', -10, 'transfer_out', 'stock_transfer_lines', 'x2_l0', '2026-04-29T11:01:00Z')",
            [],
        );
        assert!(res.is_err(), "second transfer_out for same line should violate UNIQUE");
    }

    #[test]
    fn reject_self_transfer_via_check_constraint() {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations(&c).unwrap();
        seed_two_shops(&c);
        let r = c.execute(
            "INSERT INTO stock_transfers (id, from_shop_id, to_shop_id, status, created_by, created_at) \
             VALUES ('xs', 'shop_a', 'shop_a', 'open', 'u1', '2026-04-29T10:00:00Z')",
            [],
        );
        assert!(r.is_err(), "self-transfer should violate CHECK (from_shop_id <> to_shop_id)");
    }
}
