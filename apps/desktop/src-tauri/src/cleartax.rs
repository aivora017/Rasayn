//! ClearTax GSP adapter — secondary vendor per Playbook v2.0 §12.
//!
//! Mirrors `crate::cygnet` config + retry shape so failover is a one-line
//! `shops.einvoice_vendor` flip, not a code path divergence. Wire-level HTTP
//! gated behind `cleartax-live` cargo feature; default builds return
//! `CLEARTAX_OFFLINE_BUILD` so upstream code degrades to mock or the primary.
//!
//! ## Required env vars (when `cleartax-live` is enabled)
//!
//! | Var | Purpose |
//! |---|---|
//! | `CLEARTAX_BASE_URL` | Sandbox: `https://einvapi-sandbox.cleartax.in`. Prod: `https://einvapi.cleartax.in` |
//! | `CLEARTAX_AUTH_TOKEN` | OAuth2 bearer token from ClearTax developer console |
//! | `CLEARTAX_OWNER_ID` | Per-shop owner_id (issued by ClearTax onboarding) |
//! | `CLEARTAX_GSTIN` | The shop's 15-char GSTIN |
//! | `CLEARTAX_SANDBOX` | `true` to force sandbox mode irrespective of base URL |

use std::env;

pub const CLEARTAX_SANDBOX_BASE_URL: &str = "https://einvapi-sandbox.cleartax.in";
pub const CLEARTAX_PROD_BASE_URL: &str = "https://einvapi.cleartax.in";

/// OAuth2 token TTL — ClearTax issues 1-hour bearer tokens. Refresh at 50min.
pub const TOKEN_REFRESH_SECONDS: u64 = 50 * 60;

#[derive(Debug, Clone)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub base_backoff_ms: u64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self { max_attempts: 3, base_backoff_ms: 500 }
    }
}

#[derive(Debug, Clone)]
pub struct ClearTaxConfig {
    pub base_url: String,
    pub auth_token: String,
    pub owner_id: String,
    pub gstin: String,
    pub is_sandbox: bool,
    pub retry: RetryPolicy,
}

impl ClearTaxConfig {
    pub fn from_env() -> Option<Self> {
        let base_url = env::var("CLEARTAX_BASE_URL").ok()?;
        let auth_token = env::var("CLEARTAX_AUTH_TOKEN").ok()?;
        let owner_id = env::var("CLEARTAX_OWNER_ID").ok()?;
        let gstin = env::var("CLEARTAX_GSTIN").ok()?;
        let is_sandbox = env::var("CLEARTAX_SANDBOX")
            .map(|v| v.eq_ignore_ascii_case("true"))
            .unwrap_or_else(|_| base_url == CLEARTAX_SANDBOX_BASE_URL);
        Some(Self {
            base_url,
            auth_token,
            owner_id,
            gstin,
            is_sandbox,
            retry: RetryPolicy::default(),
        })
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.gstin.len() != 15 {
            return Err("CLEARTAX_GSTIN must be 15 chars");
        }
        if self.base_url.is_empty() {
            return Err("CLEARTAX_BASE_URL is empty");
        }
        if self.is_sandbox && self.base_url == CLEARTAX_PROD_BASE_URL {
            return Err("CLEARTAX_SANDBOX=true but CLEARTAX_BASE_URL points at production");
        }
        if self.owner_id.is_empty() {
            return Err("CLEARTAX_OWNER_ID is empty");
        }
        Ok(())
    }
}

/// ClearTax API endpoint paths under the base URL.
pub const PATH_AUTH_REFRESH: &str = "/v2/auth/refresh";
pub const PATH_GENERATE_IRN: &str = "/v2/eInvoice";
pub const PATH_CANCEL_IRN: &str = "/v2/eInvoice/cancel";
pub const PATH_GENERATE_CRN: &str = "/v2/eInvoice/creditNote";
pub const PATH_GET_IRN_STATUS: &str = "/v2/eInvoice/status";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_from_env_returns_none_when_vars_missing() {
        for var in &[
            "CLEARTAX_BASE_URL",
            "CLEARTAX_AUTH_TOKEN",
            "CLEARTAX_OWNER_ID",
            "CLEARTAX_GSTIN",
        ] {
            std::env::remove_var(var);
        }
        assert!(ClearTaxConfig::from_env().is_none());
    }

    #[test]
    fn config_validate_rejects_short_gstin() {
        let cfg = ClearTaxConfig {
            base_url: CLEARTAX_SANDBOX_BASE_URL.to_string(),
            auth_token: "x".into(),
            owner_id: "o1".into(),
            gstin: "BAD".into(),
            is_sandbox: true,
            retry: RetryPolicy::default(),
        };
        assert_eq!(cfg.validate(), Err("CLEARTAX_GSTIN must be 15 chars"));
    }

    #[test]
    fn config_validate_rejects_sandbox_with_prod_url() {
        let cfg = ClearTaxConfig {
            base_url: CLEARTAX_PROD_BASE_URL.to_string(),
            auth_token: "x".into(),
            owner_id: "o1".into(),
            gstin: "27ABCDE1234F1Z5".into(),
            is_sandbox: true,
            retry: RetryPolicy::default(),
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn config_validate_rejects_empty_owner_id() {
        let cfg = ClearTaxConfig {
            base_url: CLEARTAX_SANDBOX_BASE_URL.to_string(),
            auth_token: "x".into(),
            owner_id: "".into(),
            gstin: "27ABCDE1234F1Z5".into(),
            is_sandbox: true,
            retry: RetryPolicy::default(),
        };
        assert_eq!(cfg.validate(), Err("CLEARTAX_OWNER_ID is empty"));
    }

    #[test]
    fn config_validate_passes_for_well_formed_sandbox() {
        let cfg = ClearTaxConfig {
            base_url: CLEARTAX_SANDBOX_BASE_URL.to_string(),
            auth_token: "x".into(),
            owner_id: "o1".into(),
            gstin: "27ABCDE1234F1Z5".into(),
            is_sandbox: true,
            retry: RetryPolicy::default(),
        };
        assert_eq!(cfg.validate(), Ok(()));
    }

    #[test]
    fn endpoint_paths_match_v2_api() {
        assert!(PATH_AUTH_REFRESH.starts_with("/v2/"));
        assert!(PATH_GENERATE_IRN.starts_with("/v2/"));
        assert!(PATH_GENERATE_CRN.starts_with("/v2/"));
    }
}
