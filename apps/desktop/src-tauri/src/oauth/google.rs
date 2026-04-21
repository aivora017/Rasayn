// Google token endpoint helpers: exchange code, refresh, revoke.
//
// Uses reqwest (blocking) to keep the sidecar synchronous — we're never
// processing more than one OAuth flow at a time. For production, swap to
// reqwest::Client (async) if we add concurrent mailbox polling.

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)] // expires_in / token_type deserialized for future refresh-scheduling & audit
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    pub expires_in: i64,
    pub scope: String,
    pub token_type: String,
    #[serde(default)]
    pub id_token: Option<String>,
}

#[derive(Serialize)]
#[allow(dead_code)] // wire struct — kept for documentation; actual calls use form-urlencoded
struct AuthCodeExchange<'a> {
    client_id: &'a str,
    code: &'a str,
    code_verifier: &'a str,
    redirect_uri: &'a str,
    grant_type: &'a str,
}

#[derive(Serialize)]
#[allow(dead_code)]
struct RefreshExchange<'a> {
    client_id: &'a str,
    refresh_token: &'a str,
    grant_type: &'a str,
}

/// Build the consent URL for the authorization step.
pub fn build_auth_url(
    client_id: &str,
    redirect_uri: &str,
    scopes: &[&str],
    challenge: &str,
    state: &str,
) -> String {
    let scope_joined = scopes.join(" ");
    format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent&state={}",
        super::AUTH_ENDPOINT,
        urlencode(client_id),
        urlencode(redirect_uri),
        urlencode(&scope_joined),
        urlencode(challenge),
        urlencode(state),
    )
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_url_contains_params() {
        let u = build_auth_url(
            "client.apps.googleusercontent.com",
            "http://127.0.0.1:54321/callback",
            &["https://www.googleapis.com/auth/gmail.readonly", "openid"],
            "CHAL",
            "st8",
        );
        assert!(u.contains("client_id=client.apps.googleusercontent.com"));
        assert!(u.contains("code_challenge=CHAL"));
        assert!(u.contains("code_challenge_method=S256"));
        assert!(u.contains("access_type=offline"));
        assert!(u.contains("prompt=consent"));
        assert!(u.contains("state=st8"));
    }

    #[test]
    fn urlencode_escapes() {
        assert_eq!(urlencode("a b/c"), "a%20b%2Fc");
        assert_eq!(urlencode("abc-._~"), "abc-._~");
    }
}

pub fn exchange_code(
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenResponse, String> {
    let params = [
        ("client_id", client_id),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
    ];
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(super::TOKEN_ENDPOINT)
        .form(&params)
        .send()
        .map_err(|e| format!("token exchange: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        let body = resp.text().unwrap_or_default();
        return Err(format!("token exchange {s}: {body}"));
    }
    resp.json::<TokenResponse>()
        .map_err(|e| format!("token parse: {e}"))
}

pub fn refresh_access_token(client_id: &str, refresh_token: &str) -> Result<TokenResponse, String> {
    let params = [
        ("client_id", client_id),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(super::TOKEN_ENDPOINT)
        .form(&params)
        .send()
        .map_err(|e| format!("refresh: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        let body = resp.text().unwrap_or_default();
        return Err(format!("refresh {s}: {body}"));
    }
    resp.json::<TokenResponse>()
        .map_err(|e| format!("refresh parse: {e}"))
}

pub fn revoke(token: &str) -> Result<(), String> {
    let client = reqwest::blocking::Client::new();
    let _ = client
        .post(super::REVOKE_ENDPOINT)
        .form(&[("token", token)])
        .send()
        .map_err(|e| format!("revoke: {e}"))?;
    Ok(())
}

/// Extract `email` claim from a JWT id_token payload **without verifying
/// the signature**. We trust the token only to label the connected
/// account for the UI.
///
/// S10 (docs/reviews/security-2026-04-18.md) — the `_unverified` suffix
/// is mandatory: this function must never be used to make authorisation
/// decisions. If you need the email for auth, verify the id_token against
/// Google's JWKS first.
pub fn extract_email_from_id_token_unverified(id_token: Option<&str>) -> Option<String> {
    let t = id_token?;
    let parts: Vec<&str> = t.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    let payload = URL_SAFE_NO_PAD.decode(parts[1]).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&payload).ok()?;
    v.get("email")
        .and_then(|e| e.as_str())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod more_tests {
    use super::*;
    #[test]
    fn extract_email_from_crafted_jwt() {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"RS256"}"#);
        let payload = URL_SAFE_NO_PAD.encode(br#"{"email":"owner@example.com","iss":"google"}"#);
        let jwt = format!("{header}.{payload}.sig");
        assert_eq!(
            extract_email_from_id_token_unverified(Some(&jwt)).as_deref(),
            Some("owner@example.com")
        );
    }
    #[test]
    fn extract_email_handles_none() {
        assert_eq!(extract_email_from_id_token_unverified(None), None);
    }

    // --- S10 rename regression lock ---------------------------------------
    //
    // Force reviewers of any future refactor to keep the `_unverified`
    // suffix: if the fn is ever renamed back to `extract_email_from_id_token`
    // (without the disclaimer), this test loses its reference and fails
    // to compile. The test also exercises the garbage-tolerant path: a
    // JWT with a payload that is base64-valid but not JSON must not panic.
    #[test]
    fn s10_unverified_fn_is_total_on_garbage_payload() {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"RS256"}"#);
        // Not JSON.
        let payload = URL_SAFE_NO_PAD.encode(b"not-json-at-all");
        let jwt = format!("{header}.{payload}.sig");
        assert_eq!(extract_email_from_id_token_unverified(Some(&jwt)), None);
    }
}
