// khata.rs — Tauri commands for @pharmacare/khata package.
//
// Customer credit ledger backed by SQLite (migration 0024 — khata_entries +
// khata_customer_limits). Append-only entries; balances + aging buckets
// are computed at query time. ADR-0040.
//
// IPC contract (apps/desktop/src/lib/ipc.ts):
//   khata_list_entries     {customerId}                       → KhataEntryDTO[]
//   khata_get_limit        {customerId}                       → KhataLimitDTO | null
//   khata_set_limit        {customerId, creditLimitPaise}     → KhataLimitDTO
//   khata_aging            {customerId}                       → KhataAgingDTO
//   khata_record_purchase  {customerId, billId, amountPaise,note?} → KhataEntryDTO
//   khata_record_payment   {customerId, amountPaise,note?}    → KhataEntryDTO

use crate::db::DbState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

// ─── DTOs ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KhataEntryDto {
    pub id: String,
    pub customer_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bill_id: Option<String>,
    pub debit_paise: i64,
    pub credit_paise: i64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub recorded_by_user_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KhataAgingDto {
    pub customer_id: String,
    pub current: i64,
    pub thirty: i64,
    pub sixty: i64,
    pub ninety_plus: i64,
    pub total_due_paise: i64,
    pub oldest_due_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KhataLimitDto {
    pub customer_id: String,
    pub credit_limit_paise: i64,
    pub current_due_paise: i64,
    pub default_risk_score: f64,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseInput {
    pub customer_id: String,
    pub bill_id: String,
    pub amount_paise: i64,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInput {
    pub customer_id: String,
    pub amount_paise: i64,
    pub note: Option<String>,
}

// ─── Helpers ─────────────────────────────────────────────────────────────

fn now_iso() -> String {
    use chrono::Utc;
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn rand_id_hex(bytes: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

fn resolve_actor(c: &Connection, customer_id: &str) -> Result<String, String> {
    // Resolve actor by joining customer→shop→users (owner).
    c.query_row(
        "SELECT u.id FROM users u \
         JOIN customers cu ON cu.shop_id = u.shop_id \
         WHERE cu.id = ?1 AND u.is_active = 1 AND u.role = 'owner' \
         ORDER BY u.created_at LIMIT 1",
        params![customer_id],
        |r| r.get(0),
    )
    .or_else(|_| {
        c.query_row(
            "SELECT id FROM users WHERE is_active = 1 ORDER BY created_at LIMIT 1",
            [],
            |r| r.get(0),
        )
    })
    .map_err(|e| format!("NO_ACTOR_USER: {e}"))
}

fn fetch_limit(c: &Connection, customer_id: &str) -> rusqlite::Result<Option<KhataLimitDto>> {
    c.query_row(
        "SELECT customer_id, credit_limit_paise, current_due_paise, default_risk_score, updated_at \
         FROM khata_customer_limits WHERE customer_id = ?1",
        params![customer_id],
        |r| {
            Ok(KhataLimitDto {
                customer_id: r.get(0)?,
                credit_limit_paise: r.get(1)?,
                current_due_paise: r.get(2)?,
                default_risk_score: r.get(3)?,
                updated_at: r.get(4)?,
            })
        },
    )
    .optional()
}

fn upsert_limit(c: &Connection, lim: &KhataLimitDto) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO khata_customer_limits \
            (customer_id, credit_limit_paise, current_due_paise, default_risk_score, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(customer_id) DO UPDATE SET \
            credit_limit_paise = excluded.credit_limit_paise, \
            current_due_paise  = excluded.current_due_paise, \
            default_risk_score = excluded.default_risk_score, \
            updated_at         = excluded.updated_at",
        params![
            lim.customer_id,
            lim.credit_limit_paise,
            lim.current_due_paise,
            lim.default_risk_score,
            lim.updated_at,
        ],
    )?;
    Ok(())
}

// ─── Tauri commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn khata_list_entries(
    customer_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<KhataEntryDto>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c
        .prepare(
            "SELECT id, customer_id, bill_id, debit_paise, credit_paise, created_at, note, recorded_by_user_id \
             FROM khata_entries WHERE customer_id = ?1 ORDER BY created_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map(params![customer_id], |r| {
            Ok(KhataEntryDto {
                id: r.get(0)?,
                customer_id: r.get(1)?,
                bill_id: r.get(2)?,
                debit_paise: r.get(3)?,
                credit_paise: r.get(4)?,
                created_at: r.get(5)?,
                note: r.get(6)?,
                recorded_by_user_id: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in iter {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn khata_get_limit(
    customer_id: String,
    state: State<'_, DbState>,
) -> Result<Option<KhataLimitDto>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    fetch_limit(&c, &customer_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn khata_set_limit(
    customer_id: String,
    credit_limit_paise: i64,
    state: State<'_, DbState>,
) -> Result<KhataLimitDto, String> {
    if credit_limit_paise < 0 {
        return Err("credit_limit_paise must be >= 0".into());
    }
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let existing = fetch_limit(&c, &customer_id).map_err(|e| e.to_string())?;
    let new = KhataLimitDto {
        customer_id: customer_id.clone(),
        credit_limit_paise,
        current_due_paise: existing.as_ref().map(|l| l.current_due_paise).unwrap_or(0),
        default_risk_score: existing.as_ref().map(|l| l.default_risk_score).unwrap_or(0.0),
        updated_at: now_iso(),
    };
    upsert_limit(&c, &new).map_err(|e| e.to_string())?;
    Ok(new)
}

/// Compute aging buckets (0–30 / 30–60 / 60–90 / 90+) on demand. FIFO-matches
/// credits against oldest debits, then buckets the residuals by age.
#[tauri::command]
pub fn khata_aging(
    customer_id: String,
    state: State<'_, DbState>,
) -> Result<KhataAgingDto, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c
        .prepare(
            "SELECT created_at, debit_paise, credit_paise FROM khata_entries \
             WHERE customer_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    #[derive(Clone)]
    struct Row {
        created_at: String,
        debit: i64,
    }
    let mut debits: Vec<Row> = Vec::new();
    let mut credit_pool: i64 = 0;
    let rows = stmt
        .query_map(params![customer_id], |r| {
            let ca: String = r.get(0)?;
            let d: i64 = r.get(1)?;
            let cr: i64 = r.get(2)?;
            Ok((ca, d, cr))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (ca, d, cr) = row.map_err(|e| e.to_string())?;
        if d > 0 {
            debits.push(Row { created_at: ca, debit: d });
        } else if cr > 0 {
            credit_pool = credit_pool.saturating_add(cr);
        }
    }
    // FIFO-match credits against oldest debits.
    for d in debits.iter_mut() {
        if credit_pool <= 0 {
            break;
        }
        if credit_pool >= d.debit {
            credit_pool -= d.debit;
            d.debit = 0;
        } else {
            d.debit -= credit_pool;
            credit_pool = 0;
        }
    }

    let now_ms = chrono::Utc::now().timestamp_millis();
    let mut current = 0i64;
    let mut thirty = 0i64;
    let mut sixty = 0i64;
    let mut ninety_plus = 0i64;
    let mut oldest: Option<String> = None;
    for d in debits.iter() {
        if d.debit <= 0 {
            continue;
        }
        if oldest.is_none() {
            oldest = Some(d.created_at.clone());
        } else if let Some(prev) = &oldest {
            if d.created_at < *prev {
                oldest = Some(d.created_at.clone());
            }
        }
        let age_days = age_in_days(&d.created_at, now_ms);
        if age_days < 30 {
            current += d.debit;
        } else if age_days < 60 {
            thirty += d.debit;
        } else if age_days < 90 {
            sixty += d.debit;
        } else {
            ninety_plus += d.debit;
        }
    }
    let total = current + thirty + sixty + ninety_plus;
    Ok(KhataAgingDto {
        customer_id,
        current,
        thirty,
        sixty,
        ninety_plus,
        total_due_paise: total,
        oldest_due_date: oldest,
    })
}

fn age_in_days(iso: &str, now_ms: i64) -> i64 {
    use chrono::DateTime;
    let t = DateTime::parse_from_rfc3339(iso)
        .map(|d| d.timestamp_millis())
        .unwrap_or(now_ms);
    let diff = now_ms - t;
    if diff <= 0 {
        0
    } else {
        diff / (24 * 60 * 60 * 1000)
    }
}

/// Validates credit-limit, inserts a debit entry, refreshes current_due cache.
#[tauri::command]
pub fn khata_record_purchase(
    customer_id: String,
    bill_id: String,
    amount_paise: i64,
    note: Option<String>,
    state: State<'_, DbState>,
) -> Result<KhataEntryDto, String> {
    if amount_paise <= 0 {
        return Err(format!("amount_paise must be > 0 (was {amount_paise})"));
    }
    let mut c = state.0.lock().map_err(|e| e.to_string())?;
    let actor = resolve_actor(&c, &customer_id)?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let limit_opt = fetch_limit(&tx, &customer_id).map_err(|e| e.to_string())?;
    let limit_paise = limit_opt.as_ref().map(|l| l.credit_limit_paise).unwrap_or(0);
    let current_due = limit_opt.as_ref().map(|l| l.current_due_paise).unwrap_or(0);
    let would_owe = current_due + amount_paise;
    if would_owe > limit_paise {
        return Err(format!(
            "CREDIT_LIMIT_EXCEEDED: customer {} would owe {} paise, limit is {} paise",
            customer_id, would_owe, limit_paise
        ));
    }

    let entry = KhataEntryDto {
        id: format!("kh_{}", rand_id_hex(12)),
        customer_id: customer_id.clone(),
        bill_id: Some(bill_id),
        debit_paise: amount_paise,
        credit_paise: 0,
        created_at: now_iso(),
        note,
        recorded_by_user_id: actor,
    };
    tx.execute(
        "INSERT INTO khata_entries \
            (id, customer_id, bill_id, debit_paise, credit_paise, created_at, note, recorded_by_user_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            entry.id,
            entry.customer_id,
            entry.bill_id,
            entry.debit_paise,
            entry.credit_paise,
            entry.created_at,
            entry.note,
            entry.recorded_by_user_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    let new_lim = KhataLimitDto {
        customer_id: customer_id.clone(),
        credit_limit_paise: limit_paise,
        current_due_paise: would_owe,
        default_risk_score: limit_opt.as_ref().map(|l| l.default_risk_score).unwrap_or(0.0),
        updated_at: now_iso(),
    };
    upsert_limit(&tx, &new_lim).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(entry)
}

/// Inserts a credit entry; refreshes current_due cache (cannot go negative).
#[tauri::command]
pub fn khata_record_payment(
    customer_id: String,
    amount_paise: i64,
    note: Option<String>,
    state: State<'_, DbState>,
) -> Result<KhataEntryDto, String> {
    if amount_paise <= 0 {
        return Err(format!("amount_paise must be > 0 (was {amount_paise})"));
    }
    let mut c = state.0.lock().map_err(|e| e.to_string())?;
    let actor = resolve_actor(&c, &customer_id)?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let limit_opt = fetch_limit(&tx, &customer_id).map_err(|e| e.to_string())?;
    let limit_paise = limit_opt.as_ref().map(|l| l.credit_limit_paise).unwrap_or(0);
    let current_due = limit_opt.as_ref().map(|l| l.current_due_paise).unwrap_or(0);
    let new_due = (current_due - amount_paise).max(0);

    let entry = KhataEntryDto {
        id: format!("kh_{}", rand_id_hex(12)),
        customer_id: customer_id.clone(),
        bill_id: None,
        debit_paise: 0,
        credit_paise: amount_paise,
        created_at: now_iso(),
        note,
        recorded_by_user_id: actor,
    };
    tx.execute(
        "INSERT INTO khata_entries \
            (id, customer_id, bill_id, debit_paise, credit_paise, created_at, note, recorded_by_user_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            entry.id,
            entry.customer_id,
            entry.bill_id,
            entry.debit_paise,
            entry.credit_paise,
            entry.created_at,
            entry.note,
            entry.recorded_by_user_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    let new_lim = KhataLimitDto {
        customer_id: customer_id.clone(),
        credit_limit_paise: limit_paise,
        current_due_paise: new_due,
        default_risk_score: limit_opt.as_ref().map(|l| l.default_risk_score).unwrap_or(0.0),
        updated_at: now_iso(),
    };
    upsert_limit(&tx, &new_lim).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(entry)
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn seed(c: &Connection) {
        c.execute_batch(
            "CREATE TABLE shops (id TEXT PRIMARY KEY, name TEXT);
             CREATE TABLE users (id TEXT PRIMARY KEY, shop_id TEXT, name TEXT, role TEXT, pin_hash TEXT, is_active INTEGER, created_at TEXT, mfa_enrolled INTEGER DEFAULT 0);
             CREATE TABLE customers (id TEXT PRIMARY KEY, shop_id TEXT, name TEXT);
             CREATE TABLE bills (id TEXT PRIMARY KEY);
             CREATE TABLE khata_customer_limits (
               customer_id TEXT PRIMARY KEY, credit_limit_paise INTEGER NOT NULL DEFAULT 0,
               current_due_paise INTEGER NOT NULL DEFAULT 0, default_risk_score REAL NOT NULL DEFAULT 0,
               updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE TABLE khata_entries (
               id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, bill_id TEXT,
               debit_paise INTEGER NOT NULL DEFAULT 0, credit_paise INTEGER NOT NULL DEFAULT 0,
               created_at TEXT NOT NULL DEFAULT (datetime('now')), note TEXT,
               recorded_by_user_id TEXT NOT NULL
             );
             INSERT INTO shops (id, name) VALUES ('shop1', 'Jagannath');
             INSERT INTO users (id, shop_id, name, role, pin_hash, is_active, created_at)
               VALUES ('u1', 'shop1', 'Sourav', 'owner', 'h', 1, '2026-01-01');
             INSERT INTO customers (id, shop_id, name) VALUES ('c1', 'shop1', 'Test Customer');"
        ).unwrap();
    }

    #[test]
    fn fetch_limit_returns_none_when_unset() {
        let c = Connection::open_in_memory().unwrap();
        seed(&c);
        assert!(fetch_limit(&c, "c1").unwrap().is_none());
    }

    #[test]
    fn upsert_then_fetch_roundtrips() {
        let c = Connection::open_in_memory().unwrap();
        seed(&c);
        let lim = KhataLimitDto {
            customer_id: "c1".into(),
            credit_limit_paise: 100_000,
            current_due_paise: 0,
            default_risk_score: 0.0,
            updated_at: "2026-04-29T10:00:00Z".into(),
        };
        upsert_limit(&c, &lim).unwrap();
        let got = fetch_limit(&c, "c1").unwrap().unwrap();
        assert_eq!(got.credit_limit_paise, 100_000);
        assert_eq!(got.current_due_paise, 0);
    }

    #[test]
    fn upsert_overwrites_existing() {
        let c = Connection::open_in_memory().unwrap();
        seed(&c);
        let mut lim = KhataLimitDto {
            customer_id: "c1".into(),
            credit_limit_paise: 100_000,
            current_due_paise: 0,
            default_risk_score: 0.0,
            updated_at: "2026-04-29T10:00:00Z".into(),
        };
        upsert_limit(&c, &lim).unwrap();
        lim.credit_limit_paise = 250_000;
        upsert_limit(&c, &lim).unwrap();
        let got = fetch_limit(&c, "c1").unwrap().unwrap();
        assert_eq!(got.credit_limit_paise, 250_000);
    }

    #[test]
    fn age_in_days_zero_for_future_dates() {
        let now = 1_700_000_000_000i64;
        let future = "2030-01-01T00:00:00Z";
        assert_eq!(age_in_days(future, now), 0);
    }

    #[test]
    fn age_in_days_computes_diff() {
        // 2026-04-29 vs 2026-04-01 = 28 days
        let now = chrono::DateTime::parse_from_rfc3339("2026-04-29T00:00:00Z")
            .unwrap()
            .timestamp_millis();
        let then = "2026-04-01T00:00:00Z";
        assert_eq!(age_in_days(then, now), 28);
    }
}
