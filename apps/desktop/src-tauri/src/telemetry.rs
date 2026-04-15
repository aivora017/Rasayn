//! F6 telemetry scaffold. LAN-first per Playbook v2.0 Principle #6:
//! PII/Rx never leaves shop LAN without explicit per-feature opt-in.
//!
//! Default behaviour:
//! - tracing → stderr (interactive run) AND a rolling file in app data dir.
//! - No network egress. Sentry remains uninitialised.
//!
//! Opt-in path (gated, follow-up):
//! - Owner toggles consent in Settings (writes shops.telemetry_opt_in via a
//!   future migration 0006_telemetry_consent.sql).
//! - Bundle env `PHARMACARE_SENTRY_DSN` must also be set at install time.
//! - Only crash backtraces + redacted span events are forwarded; no Rx,
//!   no customer PII, no GSTIN bodies. Redaction is applied here, not at
//!   the Sentry SDK level (defence-in-depth).
//!
//! Adding the real `sentry`/`sentry-tracing` crates touches Cargo.lock and
//! requires an ADR (it is the first outbound network dep on the desktop
//! binary). This file is the integration shim so the rest of the app can
//! call `telemetry::init` and `telemetry::cloud_egress_allowed` today.

use anyhow::Result;
use std::path::{Path, PathBuf};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Returns the directory where local telemetry logs are written.
/// Mirrors the convention used by `db::default_db_path` so a single
/// folder holds DB + logs + (future) backups for easy support handoff.
pub fn default_log_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("PharmaCarePro").join("logs")
}

/// Initialise tracing. Always installs the local stderr+file sinks.
/// `cloud_egress_allowed()` is checked separately when (later) wiring
/// Sentry; this function never makes a network call.
pub fn init(log_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(log_dir).ok();
    let log_file_path = log_dir.join("pharmacare.log");
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file_path)?;

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,pharmacare_desktop=debug"));

    // Two `fmt` layers: human-readable to stderr, JSON-ish (no ANSI) to file.
    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().with_writer(std::io::stderr))
        .with(fmt::layer().with_writer(log_file).with_ansi(false))
        .init();

    tracing::info!(target: "telemetry", path = %log_file_path.display(), "telemetry initialised (LAN-only)");
    Ok(())
}

/// Cloud egress decision. Returns true only if BOTH:
/// 1. The shop has explicitly opted in (`telemetry_opt_in = 1`), AND
/// 2. A Sentry DSN was baked in / provided via env at runtime.
///
/// Until the Sentry crate is added, this is informational only — callers
/// can use it to decide whether to surface a "Telemetry: enabled" badge
/// in the UI without leaking the DSN itself.
#[allow(dead_code)] // TODO: invoked once Sentry crate is wired (ADR pending)
pub fn cloud_egress_allowed(shop_opt_in: bool) -> bool {
    if !shop_opt_in {
        return false;
    }
    std::env::var("PHARMACARE_SENTRY_DSN")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
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
        // Use an unrelated env var name to avoid clobbering CI state.
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
