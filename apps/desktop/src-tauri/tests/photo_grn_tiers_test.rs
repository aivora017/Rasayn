//! Integration tests for the photo_grn_tiers orchestrator (ADR-0068).
//!
//! These tests are pure-Rust logic — no migrations needed because the
//! orchestrator does not touch the database. The desktop crate has no
//! `[lib]` target (binary-only), so we include the source file directly
//! via `#[path = ...]`. This is the same trick used by upstream cargo
//! examples for binary-only crates with integration tests.

#[path = "../src/photo_grn_tiers.rs"]
mod photo_grn_tiers;

use photo_grn_tiers::{extract_with_fallback, ExtractedLine, ExtractionResult};

#[test]
fn orchestrator_falls_through_to_b_when_a_returns_zero_lines() {
    // Tier-A returns Ok(vec![]) (S23a stub) — orchestrator must NOT pick it.
    // Tier-B and Tier-C both error in S23a, so we end at "none".
    // The contract under test: tier_used is anything but "tier_a", and the
    // line list is empty.
    let result = extract_with_fallback("does-not-matter.jpg");
    assert_ne!(
        result.tier_used, "tier_a",
        "Tier-A returned an empty Ok in S23a; orchestrator must fall through, got tier_used={}",
        result.tier_used
    );
    assert!(
        matches!(result.tier_used.as_str(), "tier_b" | "tier_c" | "none"),
        "unexpected tier_used: {}",
        result.tier_used
    );
    assert!(
        result.lines.is_empty(),
        "no tier produces lines in S23a; got {} line(s)",
        result.lines.len()
    );
}

#[test]
fn orchestrator_returns_none_when_all_tiers_fail() {
    // All three S23a stubs miss (A -> empty Ok, B -> Err, C -> Err).
    // Orchestrator must surface tier_used = "none" with the most-recent
    // error message captured in `error`.
    let result = extract_with_fallback("does-not-matter.jpg");
    assert_eq!(
        result.tier_used, "none",
        "expected tier_used=\"none\", got {:?}",
        result.tier_used
    );
    assert!(
        result.error.is_some(),
        "tier_used=\"none\" must carry an error message"
    );
    let msg = result.error.unwrap();
    // Last error attempted is Tier-C; sanity-check the deferral wording.
    assert!(
        msg.contains("Tier-C") || msg.contains("Tier-B"),
        "error should reference a deferred tier, got: {}",
        msg
    );
}

#[test]
fn extraction_result_carries_tier_used_field() {
    // Smoke test the data shape — instantiate ExtractionResult + ExtractedLine
    // directly so future field rearrangements break the build instead of
    // silently breaking serde wire-format.
    let line = ExtractedLine {
        product_name: "Paracetamol 500mg".to_string(),
        batch_no: Some("PCM2412".to_string()),
        qty: Some(10),
        mrp_paise: Some(1500),
        confidence: 0.92,
    };
    let result = ExtractionResult {
        tier_used: "tier_a".to_string(),
        lines: vec![line.clone()],
        error: None,
    };

    // Field types compile (this whole assertion list is the test).
    assert_eq!(result.tier_used, "tier_a");
    assert_eq!(result.lines.len(), 1);
    assert!(result.error.is_none());
    assert_eq!(result.lines[0], line);
    assert_eq!(result.lines[0].product_name, "Paracetamol 500mg");
    assert_eq!(result.lines[0].batch_no.as_deref(), Some("PCM2412"));
    assert_eq!(result.lines[0].qty, Some(10));
    assert_eq!(result.lines[0].mrp_paise, Some(1500));
    assert!((result.lines[0].confidence - 0.92).abs() < 1e-6);
}

