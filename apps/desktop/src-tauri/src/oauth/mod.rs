// OAuth sidecar for Gmail (X1 moat). See ADR 0002.
//
// Flow: Installed-App + PKCE + loopback redirect. Refresh tokens live in the
// OS keyring; metadata (account email, scopes, granted_at) in oauth_accounts.
//
// Tauri commands:
//   gmail_connect(shop_id)    -> OAuthStatus
//   gmail_status(shop_id)     -> OAuthStatus
//   gmail_disconnect(shop_id) -> ()
//
// Design decisions tested in pkce.rs / loopback.rs / google.rs unit tests.

pub mod config;
pub mod gmail_api;
pub mod google;
pub mod keyring_store;
pub mod loopback;
pub mod pkce;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStatus {
    pub connected: bool,
    pub account_email: Option<String>,
    pub scopes: Vec<String>,
    pub granted_at: Option<String>,
}

pub const SERVICE_NAME: &str = "pharmacare-pro";
pub const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
pub const REVOKE_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
pub const DEFAULT_SCOPES: &[&str] = &[
    "https://www.googleapis.com/auth/gmail.readonly",
    "openid",
    "email",
];

// CLIENT_ID is resolved at call time via `oauth::config::client_id()`.
// Precedence: runtime env PHARMACARE_GOOGLE_CLIENT_ID → compile-time env
// PHARMACARE_GOOGLE_CLIENT_ID_COMPILE → REPLACE_ME fallback.
// See config.rs — do not add a module-level CLIENT_ID constant here.

// audit_log canonical shape is defined in migration 0001:
//   (actor_id, entity, entity_id, action, payload)
// We map oauth side-effects onto it so the audit stream stays unified.
fn audit(conn: &rusqlite::Connection, shop_id: &str, event: &str, detail: &str) {
    let _ = conn.execute(
        "INSERT INTO audit_log (actor_id, entity, entity_id, action, payload) \
         VALUES ('system', 'oauth:gmail', ?1, ?2, ?3)",
        params![shop_id, event, detail],
    );
}

#[tauri::command]
pub async fn gmail_connect(
    shop_id: String,
    state: State<'_, DbState>,
) -> Result<OAuthStatus, String> {
    if !config::is_configured() {
        return Err("OAuth client ID not configured. See ADR 0002 §Operational notes.".into());
    }
    let cid = config::client_id();
    // 1. PKCE
    let (verifier, challenge) = pkce::generate();
    // 2. Bind loopback on ephemeral port
    let lb = loopback::bind_ephemeral().map_err(|e| format!("bind: {e}"))?;
    let redirect = format!("http://127.0.0.1:{}/callback", lb.port);
    // 3. Open browser to consent URL
    let state_token = format!(
        "{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let auth_url =
        google::build_auth_url(&cid, &redirect, DEFAULT_SCOPES, &challenge, &state_token);
    opener::open(&auth_url).map_err(|e| format!("open browser: {e}"))?;
    // 4. Wait for callback (blocking, 5-min timeout)
    let code = tokio::task::spawn_blocking(move || loopback::await_code(lb, 300))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("loopback: {e}"))?;
    // 5. Exchange code for tokens
    let tr = tokio::task::spawn_blocking({
        let verifier = verifier.clone();
        let redirect = redirect.clone();
        let cid = cid.clone();
        move || google::exchange_code(&cid, &code, &verifier, &redirect)
    })
    .await
    .map_err(|e| e.to_string())??;
    // 6. Persist refresh token in keyring (required for offline access)
    let refresh = tr.refresh_token.clone().ok_or_else(|| {
        "no refresh token returned (account may have prior consent — revoke and retry)".to_string()
    })?;
    keyring_store::save_refresh(&shop_id, &refresh)?;
    // 7. Persist metadata
    let email = google::extract_email_from_id_token(tr.id_token.as_deref()).unwrap_or_default();
    let scopes = tr.scope.clone();
    {
        let c = state.0.lock().map_err(|e| e.to_string())?;
        c.execute(
            "INSERT INTO oauth_accounts (shop_id, provider, account_email, scopes)
             VALUES (?1, 'gmail', ?2, ?3)
             ON CONFLICT(shop_id, provider) DO UPDATE SET
               account_email = excluded.account_email,
               scopes = excluded.scopes,
               granted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               last_error = NULL",
            params![shop_id, email, scopes],
        )
        .map_err(|e| e.to_string())?;
        audit(
            &c,
            &shop_id,
            "gmail_connect",
            &format!(r#"{{"email":"{}"}}"#, email),
        );
    }
    Ok(OAuthStatus {
        connected: true,
        account_email: Some(email),
        scopes: scopes.split_whitespace().map(|s| s.to_string()).collect(),
        granted_at: None,
    })
}

#[tauri::command]
pub fn gmail_status(shop_id: String, state: State<'_, DbState>) -> Result<OAuthStatus, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    let row = c
        .query_row(
            "SELECT account_email, scopes, granted_at FROM oauth_accounts
         WHERE shop_id = ?1 AND provider = 'gmail'",
            params![shop_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .ok();
    let has_refresh = keyring_store::has_refresh(&shop_id).unwrap_or(false);
    match row {
        Some((email, scopes, granted_at)) => Ok(OAuthStatus {
            connected: has_refresh,
            account_email: Some(email),
            scopes: scopes.split_whitespace().map(|s| s.to_string()).collect(),
            granted_at: Some(granted_at),
        }),
        None => Ok(OAuthStatus {
            connected: false,
            account_email: None,
            scopes: DEFAULT_SCOPES.iter().map(|s| s.to_string()).collect(),
            granted_at: None,
        }),
    }
}

#[tauri::command]
pub async fn gmail_disconnect(shop_id: String, state: State<'_, DbState>) -> Result<(), String> {
    let token = keyring_store::load_refresh(&shop_id)?;
    if let Some(t) = token {
        let _ = tokio::task::spawn_blocking(move || google::revoke(&t)).await;
    }
    keyring_store::delete_refresh(&shop_id)?;
    let c = state.0.lock().map_err(|e| e.to_string())?;
    c.execute(
        "DELETE FROM oauth_accounts WHERE shop_id = ?1 AND provider = 'gmail'",
        params![shop_id],
    )
    .map_err(|e| e.to_string())?;
    audit(&c, &shop_id, "gmail_disconnect", "{}");
    Ok(())
}

/// Resolve a live access token for `shop_id` by reading the keyringed refresh
/// token and calling Google's token endpoint. Returns (access_token, expires_in).
fn access_token_for(shop_id: &str) -> Result<String, String> {
    if !config::is_configured() {
        return Err("OAuth client ID not configured. See ADR 0002.".into());
    }
    let refresh = keyring_store::load_refresh(shop_id)?
        .ok_or_else(|| "not connected — run Gmail connect first".to_string())?;
    let tr = google::refresh_access_token(&config::client_id(), &refresh)?;
    Ok(tr.access_token)
}

#[tauri::command]
pub async fn gmail_list_messages(
    shop_id: String,
    query: String,
    max: u32,
    state: State<'_, DbState>,
) -> Result<Vec<gmail_api::GmailMessageSummary>, String> {
    let shop_id_for_log = shop_id.clone();
    let result = tokio::task::spawn_blocking(move || {
        let token = access_token_for(&shop_id)?;
        let q = if query.trim().is_empty() {
            "has:attachment newer_than:30d".to_string()
        } else {
            query
        };
        gmail_api::list_messages(&token, &q, max)
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Ok(c) = state.0.lock() {
        match &result {
            Ok(v) => audit(
                &c,
                &shop_id_for_log,
                "gmail_list_messages",
                &format!(r#"{{"count":{}}}"#, v.len()),
            ),
            Err(e) => audit(
                &c,
                &shop_id_for_log,
                "gmail_list_messages_error",
                &format!(r#"{{"err":{}}}"#, serde_json::Value::String(e.clone())),
            ),
        }
    }
    result
}

#[tauri::command]
pub async fn gmail_fetch_attachment(
    shop_id: String,
    message_id: String,
    attachment_id: String,
    filename: String,
    mime_type: String,
    state: State<'_, DbState>,
) -> Result<gmail_api::GmailAttachmentPayload, String> {
    let shop_id_for_log = shop_id.clone();
    let mid = message_id.clone();
    let result = tokio::task::spawn_blocking(move || {
        let token = access_token_for(&shop_id)?;
        gmail_api::fetch_attachment(&token, &message_id, &attachment_id, &filename, &mime_type)
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Ok(c) = state.0.lock() {
        match &result {
            Ok(p) => audit(
                &c,
                &shop_id_for_log,
                "gmail_fetch_attachment",
                &format!(r#"{{"msg":"{}","size":{}}}"#, mid, p.size),
            ),
            Err(e) => audit(
                &c,
                &shop_id_for_log,
                "gmail_fetch_attachment_error",
                &format!(
                    r#"{{"msg":"{}","err":{}}}"#,
                    mid,
                    serde_json::Value::String(e.clone())
                ),
            ),
        }
    }
    result
}
