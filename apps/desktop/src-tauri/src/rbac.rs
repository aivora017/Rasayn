// rbac.rs — Tauri commands for @pharmacare/rbac (ADR-0038).
//
// Schema reference: migration 0025 — users (with mfa_enrolled, totp_secret_encrypted,
// webauthn_credential_id) + rbac_permission_overrides.
//
// IPC contract:
//   rbac_list_users        {shopId}                                   → UserRowDTO[]
//   rbac_set_role          {userId, role}                             → UserRowDTO
//   rbac_list_overrides    {userId}                                   → PermissionOverrideDTO[]
//   rbac_upsert_override   {input: PermissionOverrideDTO}             → PermissionOverrideDTO
//   rbac_delete_override   {userId, permission}                       → void

use crate::db::DbState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

const ALLOWED_ROLES: &[&str] = &["owner", "manager", "pharmacist", "technician", "cashier"];

// ─── DTOs ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserRowDto {
    pub id: String,
    pub shop_id: String,
    pub name: String,
    pub role: String,
    pub mfa_enrolled: bool,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOverrideDto {
    pub user_id: String,
    pub permission: String,
    pub granted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub granted_by_user_id: String,
    pub granted_at: String,
}

fn now_iso() -> String {
    use chrono::Utc;
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

// ─── Tauri commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn rbac_list_users(
    shop_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<UserRowDto>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c
        .prepare(
            "SELECT id, shop_id, name, role, mfa_enrolled, is_active \
             FROM users WHERE shop_id = ?1 ORDER BY \
               CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 \
                         WHEN 'pharmacist' THEN 2 WHEN 'technician' THEN 3 \
                         WHEN 'cashier' THEN 4 ELSE 5 END, name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![shop_id], |r| {
            Ok(UserRowDto {
                id: r.get(0)?,
                shop_id: r.get(1)?,
                name: r.get(2)?,
                role: r.get(3)?,
                mfa_enrolled: r.get::<_, i64>(4)? != 0,
                is_active: r.get::<_, i64>(5)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn rbac_set_role(
    user_id: String,
    role: String,
    state: State<'_, DbState>,
) -> Result<UserRowDto, String> {
    if !ALLOWED_ROLES.contains(&role.as_str()) {
        return Err(format!("INVALID_ROLE: {role}"));
    }
    let c = state.0.lock().map_err(|e| e.to_string())?;

    // Guard: cannot demote the last active owner — would lock the shop out.
    if role != "owner" {
        let (current_role, shop_id): (String, String) = c
            .query_row(
                "SELECT role, shop_id FROM users WHERE id = ?1",
                params![user_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| format!("USER_NOT_FOUND: {e}"))?;
        if current_role == "owner" {
            let other_owners: i64 = c
                .query_row(
                    "SELECT COUNT(*) FROM users \
                     WHERE shop_id = ?1 AND role = 'owner' AND is_active = 1 AND id != ?2",
                    params![shop_id, user_id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if other_owners == 0 {
                return Err("LAST_OWNER_GUARD: cannot demote the last active owner".into());
            }
        }
    }

    c.execute(
        "UPDATE users SET role = ?1 WHERE id = ?2",
        params![role, user_id],
    )
    .map_err(|e| e.to_string())?;

    c.query_row(
        "SELECT id, shop_id, name, role, mfa_enrolled, is_active \
         FROM users WHERE id = ?1",
        params![user_id],
        |r| {
            Ok(UserRowDto {
                id: r.get(0)?,
                shop_id: r.get(1)?,
                name: r.get(2)?,
                role: r.get(3)?,
                mfa_enrolled: r.get::<_, i64>(4)? != 0,
                is_active: r.get::<_, i64>(5)? != 0,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rbac_list_overrides(
    user_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<PermissionOverrideDto>, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = c
        .prepare(
            "SELECT user_id, permission, granted, reason, granted_by_user_id, granted_at \
             FROM rbac_permission_overrides WHERE user_id = ?1 ORDER BY permission",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![user_id], |r| {
            Ok(PermissionOverrideDto {
                user_id: r.get(0)?,
                permission: r.get(1)?,
                granted: r.get::<_, i64>(2)? != 0,
                reason: r.get(3)?,
                granted_by_user_id: r.get(4)?,
                granted_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn rbac_upsert_override(
    input: PermissionOverrideDto,
    state: State<'_, DbState>,
) -> Result<PermissionOverrideDto, String> {
    if input.permission.trim().is_empty() {
        return Err("permission cannot be empty".into());
    }
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let granted_at = if input.granted_at.is_empty() {
        now_iso()
    } else {
        input.granted_at.clone()
    };
    c.execute(
        "INSERT INTO rbac_permission_overrides \
            (user_id, permission, granted, reason, granted_by_user_id, granted_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
         ON CONFLICT(user_id, permission) DO UPDATE SET \
            granted = excluded.granted, \
            reason = excluded.reason, \
            granted_by_user_id = excluded.granted_by_user_id, \
            granted_at = excluded.granted_at",
        params![
            input.user_id,
            input.permission,
            if input.granted { 1 } else { 0 },
            input.reason,
            input.granted_by_user_id,
            granted_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(PermissionOverrideDto {
        granted_at,
        ..input
    })
}

#[tauri::command]
pub fn rbac_delete_override(
    user_id: String,
    permission: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute(
        "DELETE FROM rbac_permission_overrides WHERE user_id = ?1 AND permission = ?2",
        params![user_id, permission],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn seed(c: &Connection) {
        c.execute_batch(
            "CREATE TABLE shops (id TEXT PRIMARY KEY);
             CREATE TABLE users (
               id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, name TEXT NOT NULL,
               role TEXT NOT NULL CHECK (role IN ('owner','manager','pharmacist','technician','cashier')),
               pin_hash TEXT, is_active INTEGER NOT NULL DEFAULT 1,
               created_at TEXT NOT NULL,
               mfa_enrolled INTEGER NOT NULL DEFAULT 0,
               totp_secret_encrypted TEXT, webauthn_credential_id TEXT
             );
             CREATE TABLE rbac_permission_overrides (
               user_id TEXT NOT NULL, permission TEXT NOT NULL,
               granted INTEGER NOT NULL DEFAULT 1, reason TEXT,
               granted_by_user_id TEXT NOT NULL,
               granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
               PRIMARY KEY (user_id, permission)
             );
             INSERT INTO shops (id) VALUES ('shop1');
             INSERT INTO users (id, shop_id, name, role, pin_hash, is_active, created_at)
               VALUES ('u1', 'shop1', 'Sourav', 'owner', 'h', 1, '2026-01-01'),
                      ('u2', 'shop1', 'Cashier', 'cashier', 'h', 1, '2026-01-02');"
        ).unwrap();
    }

    #[test]
    fn allowed_roles_are_correct() {
        assert!(ALLOWED_ROLES.contains(&"owner"));
        assert!(ALLOWED_ROLES.contains(&"cashier"));
        assert!(!ALLOWED_ROLES.contains(&"superuser"));
    }

    #[test]
    fn upsert_override_inserts_then_updates() {
        let c = Connection::open_in_memory().unwrap();
        seed(&c);
        c.execute(
            "INSERT INTO rbac_permission_overrides (user_id, permission, granted, reason, granted_by_user_id, granted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(user_id, permission) DO UPDATE SET granted = excluded.granted, reason = excluded.reason",
            rusqlite::params!["u2", "rx_dispense", 1i64, "trained", "u1", "2026-04-29T10:00:00Z"],
        ).unwrap();
        c.execute(
            "INSERT INTO rbac_permission_overrides (user_id, permission, granted, reason, granted_by_user_id, granted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(user_id, permission) DO UPDATE SET granted = excluded.granted, reason = excluded.reason",
            rusqlite::params!["u2", "rx_dispense", 0i64, "revoked", "u1", "2026-04-29T11:00:00Z"],
        ).unwrap();
        let granted: i64 = c.query_row(
            "SELECT granted FROM rbac_permission_overrides WHERE user_id = ?1 AND permission = ?2",
            rusqlite::params!["u2", "rx_dispense"],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(granted, 0);
    }

    #[test]
    fn now_iso_is_valid_rfc3339() {
        let s = now_iso();
        assert!(chrono::DateTime::parse_from_rfc3339(&s).is_ok());
    }
}
