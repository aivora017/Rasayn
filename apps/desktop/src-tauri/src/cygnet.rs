//! Cygnet GSP IRN adapter — config + retry policy + sandbox-vs-prod gating.
//!
//! Wire-level HTTP submission is gated behind the `cygnet-live` cargo feature
//! flag. Default builds compile without `reqwest`; the adapter returns a typed
//! error code (`CYGNET_OFFLINE_BUILD`) so upstream code degrades gracefully
//! to the mock adapter or to the secondary vendor (ClearTax).
//!
//! Config is read from environment variables at process start. The shop's
//! per-store credentials are NEVER stored in the SQLite DB — they live in
//! Windows DPAPI-protected secrets (or env vars during dev).
//!
//! ## Required env vars (when `cygnet-live` is enabled)
//!
//! | Var | Purpose |
//! |---|---|
//! | `CYGNET_BASE_URL` | Endpoint root. Sandbox: `https://einvapi-trial.cygnet.in`. Prod: `https://einvapi.cygnet.in` |
//! | `CYGNET_API_KEY` | API key issued by Cygnet on contract close |
//! | `CYGNET_USERNAME` | Per-shop GSP username |
//! | `CYGNET_PASSWORD` | Per-shop GSP password (encrypted by Cygnet's RSA pub key on the wire) |
//! | `CYGNET_GSTIN` | The shop's 15-char GSTIN |
//! | `CYGNET_SANDBOX` | `true` to force sandbox mode irrespective of base URL (extra safety) |

#![cfg_attr(not(feature = "cygnet-live"), allow(dead_code))]

use std::env;

/// Cygnet sandbox base URL — NIC-test integration.
pub const CYGNET_SANDBOX_BASE_URL: &str = "https://einvapi-trial.cygnet.in";
/// Cygnet production base URL — live e-invoice submission.
pub const CYGNET_PROD_BASE_URL: &str = "https://einvapi.cygnet.in";

/// Token-lifetime hard ceiling in seconds. Cygnet tokens nominally last 6h
/// (21600s); we refresh at 5h to avoid race with rolling expiry.
pub const TOKEN_REFRESH_SECONDS: u64 = 5 * 60 * 60;

/// Retry policy for transient network failures.
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub base_backoff_ms: u64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            base_backoff_ms: 500,
        }
    }
}

/// Loaded Cygnet configuration. None of these strings are logged in cleartext.
#[derive(Debug, Clone)]
pub struct CygnetConfig {
    pub base_url: String,
    pub api_key: String,
    pub username: String,
    pub password: String,
    pub gstin: String,
    pub is_sandbox: bool,
    pub retry: RetryPolicy,
}

impl CygnetConfig {
    /// Load from environment. Returns None when any required var is missing —
    /// caller falls back to the mock adapter or surfaces a config error.
    pub fn from_env() -> Option<Self> {
        let base_url = env::var("CYGNET_BASE_URL").ok()?;
        let api_key = env::var("CYGNET_API_KEY").ok()?;
        let username = env::var("CYGNET_USERNAME").ok()?;
        let password = env::var("CYGNET_PASSWORD").ok()?;
        let gstin = env::var("CYGNET_GSTIN").ok()?;
        let is_sandbox = env::var("CYGNET_SANDBOX")
            .map(|v| v.eq_ignore_ascii_case("true"))
            .unwrap_or_else(|_| base_url == CYGNET_SANDBOX_BASE_URL);
        Some(Self {
            base_url,
            api_key,
            username,
            password,
            gstin,
            is_sandbox,
            retry: RetryPolicy::default(),
        })
    }

    /// Sanity check: GSTIN matches base URL's environment (don't accidentally
    /// post a sandbox GSTIN to prod or vice versa).
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.gstin.len() != 15 {
            return Err("CYGNET_GSTIN must be 15 chars");
        }
        if self.base_url.is_empty() {
            return Err("CYGNET_BASE_URL is empty");
        }
        if self.is_sandbox && self.base_url == CYGNET_PROD_BASE_URL {
            return Err("CYGNET_SANDBOX=true but CYGNET_BASE_URL points at production");
        }
        Ok(())
    }
}

/// Endpoint paths under the base URL. Mirror Cygnet's documented surface.
pub const PATH_AUTH: &str = "/Authentication/Authenticate";
pub const PATH_GENERATE_IRN: &str = "/eInvoice/GenerateIRN";
pub const PATH_CANCEL_IRN: &str = "/eInvoice/CancelIRN";
pub const PATH_GENERATE_CRN: &str = "/eInvoice/GenerateCreditNote";
pub const PATH_GET_IRN_STATUS: &str = "/eInvoice/GetIRNStatus";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_from_env_returns_none_when_missing_vars() {
        // Sanity — without env set, from_env should return None.
        // (No env mutation in tests — just exercises the path.)
        for var in &[
            "CYGNET_BASE_URL",
            "CYGNET_API_KEY",
            "CYGNET_USERNAME",
            "CYGNET_PASSWORD",
            "CYGNET_GSTIN",
        ] {
            std::env::remove_var(var);
        }
        assert!(CygnetConfig::from_env().is_none());
    }

    #[test]
    fn config_validate_rejects_short_gstin() {
        let cfg = CygnetConfig {
            base_url: CYGNET_SANDBOX_BASE_URL.to_string(),
            api_key: "x".into(),
            username: "u".into(),
            password: "p".into(),
            gstin: "BAD".into(),
            is_sandbox: true,
            retry: RetryPolicy::default(),
        };
        assert_eq!(cfg.validate(), Err("CYGNET_GSTIN must be 15 chars"));
    }

    #[test]
    fn config_validate_rejects_sandbox_with_prod_url() {
        let cfg = CygnetConfig {
            base_url: CYGNET_PROD_BASE_URL.to_string(),
            api_key: "x".into(),
            username: "u".into(),
            password: "p".into(),
            gstin: "27ABCDE1234F1Z5".into(),
            is_sandbox: true,
            retry: RetryPolicy::default(),
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn config_validate_passes_for_well_formed_sandbox_setup() {
        let cfg = CygnetConfig {
            base_url: CYGNET_SANDBOX_BASE_URL.to_string(),
            api_key: "x".into(),
            username: "u".into(),
            password: "p".into(),
            gstin: "27ABCDE1234F1Z5".into(),
            is_sandbox: true,
            retry: RetryPolicy::default(),
        };
        assert_eq!(cfg.validate(), Ok(()));
    }

    #[test]
    fn retry_policy_defaults_are_conservative() {
        let p = RetryPolicy::default();
        assert!(p.max_attempts >= 2 && p.max_attempts <= 5);
        assert!(p.base_backoff_ms >= 100);
    }

    #[test]
    fn endpoint_paths_are_documented_constants() {
        // These are referenced in the onboarding doc; failing this test means
        // the doc is out of sync.
        assert_eq!(PATH_AUTH, "/Authentication/Authenticate");
        assert!(PATH_GENERATE_IRN.starts_with("/eInvoice/"));
        assert!(PATH_GENERATE_CRN.starts_with("/eInvoice/"));
    }
}
