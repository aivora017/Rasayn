//! crypto_store.rs — per-shop DEK lifecycle for at-rest encryption.
//!
//! S26.E (silent killer #5) — replaces the throw-everywhere stub in
//! `@pharmacare/crypto` with a real implementation. Threat model and
//! rotation policy live in ADR-0071.
//!
//! Lifecycle:
//!  1. On first call per `(shop_id, key_id="primary")`, generate a fresh
//!     32-byte DEK from `OsRng`, wrap it under the shop's KEK (read from
//!     the OS keyring), and persist the wrapped DEK to `kek_wrapped_dek`.
//!  2. On subsequent calls, return the cached unwrapped DEK from in-memory
//!     state — the keyring round-trip is paid once per process.
//!  3. Rows with `status = 'revoked'` are filtered out at lookup time.
//!
//! Backup recovery: the KEK can be rederived from the shop owner's master
//! password via `@pharmacare/crypto::deriveKekFromPassword`. Lost
//! password = lost data (acceptable per pilot — see ADR-0071).
//!
//! Hard rule: the desktop binary MUST cargo-build cleanly even when the
//! `kek_wrapped_dek` table is empty (test environments, fresh installs
//! before the keyring is seeded). Errors fall back to a tracing::warn!
//! and a stable error string so callers can surface a friendly UI.

use crate::db::DbState;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use keyring::Entry;
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, OptionalExtension};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

/// Same service name as the Gmail keyring entries. Entries are scoped per
/// `(service, account)` so the namespacing is unambiguous.
pub const KEYRING_SERVICE: &str = "pharmacare-pro";

/// Keyring account format for KEK lookup.
fn kek_account_for(shop_id: &str) -> String {
    format!("kek:{}", shop_id)
}

/// Default key id used by the runtime; rotation produces "primary-2026-q3"
/// etc. and flips the prior row to status='rotated'.
pub const PRIMARY_KEY_ID: &str = "primary";

/// In-memory cache of unwrapped DEKs per (shop_id, key_id). Wiped on
/// process exit; never written to disk.
#[derive(Default)]
pub struct CryptoStore {
    cache: Mutex<HashMap<(String, String), Vec<u8>>>,
}

impl CryptoStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Test-only: drop every cached DEK so the next lookup re-reads from DB.
    #[allow(dead_code)]
    pub fn reset(&self) {
        if let Ok(mut g) = self.cache.lock() {
            g.clear();
        }
    }
}

/// Read the KEK for a shop from the OS keyring. Returns Ok(None) when the
/// keyring slot is empty — caller decides whether to derive it from the
/// owner's master password (pilot fallback) or refuse the operation.
pub fn load_kek(shop_id: &str) -> Result<Option<Vec<u8>>, String> {
    let entry = Entry::new(KEYRING_SERVICE, &kek_account_for(shop_id))
        .map_err(|e| format!("keyring open: {e}"))?;
    match entry.get_password() {
        Ok(b64) => {
            use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
            let bytes = B64
                .decode(b64.as_bytes())
                .map_err(|e| format!("kek base64 decode: {e}"))?;
            if bytes.len() != 32 {
                return Err(format!(
                    "kek wrong size for shop {}: got {} bytes (want 32)",
                    shop_id,
                    bytes.len()
                ));
            }
            Ok(Some(bytes))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring read: {e}")),
    }
}

/// Persist a fresh KEK for a shop. Test/setup-only path; the production
/// flow seeds this during license activation. Stored as base64 because
/// some keyring backends (Linux Secret Service variants) reject raw bytes.
#[allow(dead_code)]
pub fn save_kek(shop_id: &str, kek: &[u8]) -> Result<(), String> {
    if kek.len() != 32 {
        return Err(format!("kek must be 32 bytes (got {})", kek.len()));
    }
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let entry = Entry::new(KEYRING_SERVICE, &kek_account_for(shop_id))
        .map_err(|e| format!("keyring open: {e}"))?;
    entry
        .set_password(&B64.encode(kek))
        .map_err(|e| format!("keyring write: {e}"))
}

/// Wrap a DEK under the KEK using AES-256-GCM. Output layout matches the
/// TS `serializeBlob`: [version=1 : u8] [nonce : 12] [ct+tag : N].
pub fn wrap_dek(kek: &[u8], dek: &[u8]) -> Result<Vec<u8>, String> {
    if kek.len() != 32 {
        return Err("kek must be 32 bytes".to_string());
    }
    let key = Key::<Aes256Gcm>::from_slice(kek);
    let cipher = Aes256Gcm::new(key);
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, dek)
        .map_err(|e| format!("wrap_dek: {e}"))?;
    let mut out = Vec::with_capacity(1 + 12 + ct.len());
    out.push(1u8);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// Unwrap a DEK previously wrapped by `wrap_dek`. Returns the raw 32-byte
/// DEK on success; an opaque error on auth-tag mismatch or version skew.
pub fn unwrap_dek(kek: &[u8], wrapped: &[u8]) -> Result<Vec<u8>, String> {
    if kek.len() != 32 {
        return Err("kek must be 32 bytes".to_string());
    }
    if wrapped.len() < 1 + 12 + 16 {
        return Err("wrapped dek too short".to_string());
    }
    if wrapped[0] != 1 {
        return Err(format!("unsupported wrapped-dek version {}", wrapped[0]));
    }
    let key = Key::<Aes256Gcm>::from_slice(kek);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&wrapped[1..13]);
    let pt = cipher
        .decrypt(nonce, &wrapped[13..])
        .map_err(|e| format!("unwrap_dek: {e}"))?;
    if pt.len() != 32 {
        return Err(format!("unwrapped dek wrong size: {}", pt.len()));
    }
    Ok(pt)
}

/// Insert a fresh wrapped DEK row for a shop. Status defaults to 'active'.
pub fn insert_wrapped_dek(
    conn: &rusqlite::Connection,
    shop_id: &str,
    key_id: &str,
    wrapped: &[u8],
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO kek_wrapped_dek (shop_id, key_id, wrapped_dek, algo, status, created_at)
         VALUES (?1, ?2, ?3, 'aes-256-gcm', 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        params![shop_id, key_id, wrapped],
    )
    .map_err(|e| format!("insert wrapped_dek: {e}"))?;
    Ok(())
}

/// Look up the active wrapped DEK for `(shop_id, key_id)`. Revoked rows
/// are filtered out — a revoked DEK is dead even if it's the only row.
pub fn lookup_wrapped_dek(
    conn: &rusqlite::Connection,
    shop_id: &str,
    key_id: &str,
) -> Result<Option<Vec<u8>>, String> {
    conn.query_row(
        "SELECT wrapped_dek FROM kek_wrapped_dek
         WHERE shop_id = ?1 AND key_id = ?2 AND status != 'revoked'",
        params![shop_id, key_id],
        |r| r.get::<_, Vec<u8>>(0),
    )
    .optional()
    .map_err(|e| format!("lookup wrapped_dek: {e}"))
}

/// Tauri command: get-or-create the primary DEK for a shop. Returns the
/// raw DEK so JS-side callers can pass it straight to `decryptAesGcm` /
/// `encryptAesGcm`. The cached entry is keyed by `(shop_id, "primary")`.
///
/// Failure modes:
///  * keyring missing the KEK   → returns "kek not seeded" (caller should
///                                 redirect the operator to the master-password
///                                 setup screen).
///  * DB row corrupted or wrong-version → propagates the unwrap error string.
#[tauri::command]
pub fn crypto_get_or_create_dek(
    state: State<'_, DbState>,
    store: State<'_, CryptoStore>,
    shop_id: String,
) -> Result<Vec<u8>, String> {
    // 1. Cache hit?
    let cache_key = (shop_id.clone(), PRIMARY_KEY_ID.to_string());
    if let Ok(g) = store.cache.lock() {
        if let Some(dek) = g.get(&cache_key) {
            return Ok(dek.clone());
        }
    }

    // 2. KEK present?
    let kek = match load_kek(&shop_id)? {
        Some(k) => k,
        None => {
            return Err(format!(
                "kek not seeded for shop {} — owner must set master password first",
                shop_id
            ))
        }
    };

    // 3. DB row present?
    let conn = state.0.lock().map_err(|e| format!("db lock: {e}"))?;
    let existing = lookup_wrapped_dek(&conn, &shop_id, PRIMARY_KEY_ID)?;
    let dek = match existing {
        Some(wrapped) => unwrap_dek(&kek, &wrapped)?,
        None => {
            // First-time path: generate, wrap, persist.
            let mut fresh = vec![0u8; 32];
            OsRng.fill_bytes(&mut fresh);
            let wrapped = wrap_dek(&kek, &fresh)?;
            insert_wrapped_dek(&conn, &shop_id, PRIMARY_KEY_ID, &wrapped)?;
            tracing::info!(
                shop = %shop_id,
                "crypto_store: minted fresh primary DEK"
            );
            fresh
        }
    };
    drop(conn);

    // 4. Cache + return.
    if let Ok(mut g) = store.cache.lock() {
        g.insert(cache_key, dek.clone());
    }
    Ok(dek)
}

/// Tauri command: drop the cached DEK for a shop. Forces the next
/// `crypto_get_or_create_dek` to round-trip through the keyring +
/// the DB row again. Used by the `Re-key` admin action and tests.
#[tauri::command]
#[allow(dead_code)]
pub fn crypto_reset_cache(store: State<'_, CryptoStore>) -> Result<(), String> {
    store.reset();
    Ok(())
}
