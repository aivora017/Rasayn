//! S27.E telemetry PII redaction (ADR-0072 §3).
//!
//! Pulls in src/telemetry.rs via #[path] (same trick as
//! idempotency_unit_test.rs) so we can exercise the pure-string redactor
//! without spinning up a real Sentry transport. The Sentry-specific
//! `redact_event` is cfg-gated behind feature `telemetry-sentry` and is
//! NOT exercised here — these tests run on default builds (offline).

#[path = "../src/telemetry.rs"]
mod telemetry;

use serde_json::json;

#[test]
fn phone_number_in_tag_value_is_redacted() {
    // Simulates a Sentry event tag whose value carries a 10-digit phone.
    let mut tag_value = json!("call back at 9876543210 today");
    telemetry::redact_json(&mut tag_value);
    let s = tag_value.as_str().unwrap();
    assert!(s.contains("[REDACTED]"), "phone not redacted: {s}");
    assert!(!s.contains("9876543210"), "raw phone still present: {s}");
}

#[test]
fn gstin_in_extras_is_redacted() {
    // Simulates extras: { "shop_gstin": "27ABCDE1234F1Z5" }
    let mut extras = json!({ "shop_gstin": "27ABCDE1234F1Z5" });
    telemetry::redact_json(&mut extras);
    let v = extras.get("shop_gstin").unwrap().as_str().unwrap();
    assert_eq!(v, "[REDACTED]", "GSTIN not redacted: {v}");
}

#[test]
fn nested_customer_phone_key_redacts_value_wholesale() {
    // Even if the value were "n/a" (not regex-matchable), the KEY name
    // alone triggers wholesale redaction.
    let mut payload = json!({
        "ctx": {
            "customer_phone": "9999999999",
            "customer_address": "Plot 14, Kalyan",
            "rx_image_path": "C:/Rx/scan_2026.jpg",
            "prescription_text": "Rx: amoxil 500mg TDS x5d",
            "innocent_field": "DB locked"
        }
    });
    telemetry::redact_json(&mut payload);
    let ctx = payload.get("ctx").unwrap();
    assert_eq!(
        ctx.get("customer_phone").unwrap().as_str(),
        Some("[REDACTED]")
    );
    assert_eq!(
        ctx.get("customer_address").unwrap().as_str(),
        Some("[REDACTED]")
    );
    assert_eq!(
        ctx.get("rx_image_path").unwrap().as_str(),
        Some("[REDACTED]")
    );
    assert_eq!(
        ctx.get("prescription_text").unwrap().as_str(),
        Some("[REDACTED]")
    );
    // legitimate field untouched
    assert_eq!(
        ctx.get("innocent_field").unwrap().as_str(),
        Some("DB locked")
    );
}

#[test]
fn legitimate_error_message_passes_through_unchanged() {
    // Pure-string redactor on an error message containing no PII.
    let msg = "DB locked: SQLITE_BUSY at commands.rs:421";
    let out = telemetry::redact_string(msg);
    assert_eq!(out, msg, "non-PII message was modified: {out}");

    // Also via redact_json on a string value.
    let mut v = json!("DB locked: SQLITE_BUSY at commands.rs:421");
    telemetry::redact_json(&mut v);
    assert_eq!(v.as_str().unwrap(), msg);
}

#[test]
fn pan_and_email_also_redacted() {
    // Bonus belt-and-braces: PAN + email regex paths.
    let s = telemetry::redact_string("PAN ABCDE1234F email owner@vaidyanath.in");
    assert!(s.contains("[REDACTED]"));
    assert!(!s.contains("ABCDE1234F"), "PAN leaked: {s}");
    assert!(!s.contains("owner@vaidyanath.in"), "email leaked: {s}");
}
