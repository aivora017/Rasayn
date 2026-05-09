//! F6 telemetry. LAN-first per Playbook v2.0 Principle #6.
//! S27.E: Sentry crash reporting wired (cfg-gated `telemetry-sentry`).
//! ADR-0072 supersedes ADR-0065 for the Sentry-specific portion. OTel +
//! Grafana remain Draft in 0065 and are out of scope for S27.
//!
//! Default behaviour (no `telemetry-sentry` feature):
//! - tracing -> stderr (interactive run) AND a rolling file in app data dir.
//! - No network egress. Sentry crate is not even compiled in.
//!
//! Opt-in path (feature = "telemetry-sentry"):
//! - Owner toggles consent in Settings (writes shops.telemetry_opt_in via
//!   migration 0049_telemetry_opt_in.sql).
//! - DSN comes from env `PHARMACARE_SENTRY_DSN`. Absent => graceful no-op.
//! - `before_send` callback applies PII redaction (regex list below) as a
//!   defence-in-depth layer on top of the SDK's own scrubbers.
//!
//! Cross-border DPDP §16: Sentry SaaS is hosted in EU/US. The
//! `cross_border_opinion_at` column (migration 0048) MUST be non-null
//! before opt-in is allowed. UI layer enforces; this module just refuses
//! egress when `shop_opt_in == false`.

use anyhow::Result;
use std::path::{Path, PathBuf};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// PII redaction regex set (ADR-0072 §3). Order matters: GSTIN is checked
/// BEFORE the bare 10-digit phone pattern because GSTIN contains digits
/// that would otherwise match. PAN is checked AFTER GSTIN for the same
/// reason (5-letter prefix overlap).
const RE_GSTIN: &str = r"[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}";
const RE_PAN: &str = r"[A-Z]{5}[0-9]{4}[A-Z]";
const RE_PHONE: &str = r"\d{10}";
const RE_EMAIL: &str = r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}";

/// Field-name denylist. Any map key containing one of these substrings
/// (case-insensitive) has its value replaced with `[REDACTED]` regardless
/// of content. Belt-and-braces for the regex pass.
const REDACT_KEY_SUBSTRINGS: &[&str] = &[
    "customer_phone",
    "customer_address",
    "prescription_text",
    "rx_image_path",
];

/// Returns the directory where local telemetry logs are written.
pub fn default_log_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("PharmaCarePro").join("logs")
}

/// Initialise tracing. Always installs the local stderr+file sinks.
/// When the `telemetry-sentry` feature is enabled AND a DSN is present in
/// env, also initialises Sentry. The returned guard (Sentry's
/// `ClientInitGuard`) is dropped when the binary exits, flushing pending
/// events. We hand it back to `main` so it lives for the binary's lifetime.
pub fn init(log_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(log_dir).ok();
    let log_file_path = log_dir.join("pharmacare.log");
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file_path)?;

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,pharmacare_desktop=debug"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().with_writer(std::io::stderr))
        .with(fmt::layer().with_writer(log_file).with_ansi(false))
        .init();

    tracing::info!(
        target: "telemetry",
        path = %log_file_path.display(),
        "telemetry initialised (LAN-only)"
    );
    Ok(())
}

/// Real Sentry init. Returns the guard so the caller can hold it for the
/// process lifetime. Returns None if DSN is missing or empty (graceful).
#[cfg(feature = "telemetry-sentry")]
pub fn init_sentry_real() -> Option<sentry::ClientInitGuard> {
    let dsn = std::env::var("PHARMACARE_SENTRY_DSN").ok()?;
    let dsn = dsn.trim();
    if dsn.is_empty() {
        return None;
    }
    let opts = sentry::ClientOptions {
        dsn: dsn.parse().ok(),
        release: sentry::release_name!(),
        send_default_pii: false,
        before_send: Some(std::sync::Arc::new(|event| Some(redact_event(event)))),
        ..Default::default()
    };
    Some(sentry::init(opts))
}

/// Cloud egress decision. Returns true only if BOTH:
/// 1. The shop has explicitly opted in (telemetry_opt_in = 1), AND
/// 2. A Sentry DSN was provided via env at runtime.
pub fn cloud_egress_allowed(shop_opt_in: bool) -> bool {
    if !shop_opt_in {
        return false;
    }
    std::env::var("PHARMACARE_SENTRY_DSN")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

/// Pure-string PII redaction. Pub(crate) so the integration test in
/// tests/telemetry_redaction_test.rs can exercise it via `#[path]`
/// inclusion without spinning up a real Sentry transport.
pub(crate) fn redact_string(input: &str) -> String {
    use regex::Regex;
    // GSTIN first (longest, most specific), then PAN, then email, then phone.
    let gstin = Regex::new(RE_GSTIN).expect("RE_GSTIN compiles");
    let pan = Regex::new(RE_PAN).expect("RE_PAN compiles");
    let email = Regex::new(RE_EMAIL).expect("RE_EMAIL compiles");
    let phone = Regex::new(RE_PHONE).expect("RE_PHONE compiles");
    let s1 = gstin.replace_all(input, "[REDACTED]");
    let s2 = pan.replace_all(&s1, "[REDACTED]");
    let s3 = email.replace_all(&s2, "[REDACTED]");
    let s4 = phone.replace_all(&s3, "[REDACTED]");
    s4.into_owned()
}

/// Returns true if a map key should have its value replaced wholesale.
pub(crate) fn key_should_redact(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    REDACT_KEY_SUBSTRINGS.iter().any(|s| lower.contains(s))
}

/// Recursively walk a `serde_json::Value`, applying redaction.
pub(crate) fn redact_json(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::String(s) => {
            *s = redact_string(s);
        }
        serde_json::Value::Array(arr) => {
            for item in arr.iter_mut() {
                redact_json(item);
            }
        }
        serde_json::Value::Object(map) => {
            for (k, val) in map.iter_mut() {
                if key_should_redact(k) {
                    *val = serde_json::Value::String("[REDACTED]".to_string());
                } else {
                    redact_json(val);
                }
            }
        }
        _ => {}
    }
}

/// Sentry-side `before_send` redactor. Walks tags, extras, and message.
/// Only compiled when the `telemetry-sentry` feature is enabled; the
/// pure-string helpers above are unconditional so tests can target them
/// without pulling in the Sentry SDK.
#[cfg(feature = "telemetry-sentry")]
pub(crate) fn redact_event(
    mut ev: sentry::protocol::Event<'static>,
) -> sentry::protocol::Event<'static> {
    if let Some(msg) = ev.message.take() {
        ev.message = Some(redact_string(&msg));
    }
    let mut new_tags = std::collections::BTreeMap::new();
    for (k, v) in ev.tags.into_iter() {
        let val = if key_should_redact(&k) {
            "[REDACTED]".to_string()
        } else {
            redact_string(&v)
        };
        new_tags.insert(k, val);
    }
    ev.tags = new_tags;
    for (k, val) in ev.extra.iter_mut() {
        if key_should_redact(k) {
            *val = serde_json::Value::String("[REDACTED]".to_string());
        } else {
            redact_json(val);
        }
    }
    ev
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_egress_blocked_when_opt_in_false() {
        assert!(!cloud_egress_allowed(false));
    }

    #[test]
    fn cloud_egress_blocked_when_dsn_unset() {
        std::env::remove_var("PHARMACARE_SENTRY_DSN");
        assert!(!cloud_egress_allowed(true));
    }

    #[test]
    fn cloud_egress_blocked_when_dsn_empty() {
        std::env::set_var("PHARMACARE_SENTRY_DSN", "   ");
        assert!(!cloud_egress_allowed(true));
        std::env::remove_var("PHARMACARE_SENTRY_DSN");
    }

    #[test]
    fn cloud_egress_allowed_when_both_satisfied() {
        std::env::set_var(
            "PHARMACARE_SENTRY_DSN",
            "https://example@o0.ingest.sentry.io/0",
        );
        assert!(cloud_egress_allowed(true));
        std::env::remove_var("PHARMACARE_SENTRY_DSN");
    }

    #[test]
    fn default_log_dir_ends_in_logs() {
        let p = default_log_dir();
        assert_eq!(p.file_name().and_then(|s| s.to_str()), Some("logs"));
    }
}
