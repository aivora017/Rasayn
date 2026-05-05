#![allow(dead_code)]

//! photo_grn_tiers.rs — pluggable A→B→C orchestrator for X3 photo-of-paper-bill → GRN.
//!
//! ADR-0068 locked the trait + result shape; ADR-0069 (S24.3) extends it with
//! the LayoutLMv3 model bundle and a feature-flagged ONNX runtime path.
//!
//! Status of each tier as of S24.3:
//!   - Tier-A (regex) — still `Ok(vec![])`. The existing `photo_grn` module
//!     only exposes `photo_grn_run(PhotoGrnInput)` (a Tauri command taking
//!     base64 bytes + reportedMime + shopId), not a clean
//!     `(image_path) -> Vec<ExtractedLine>` function. Bridging requires
//!     either (a) lifting an internal regex extractor out of `photo_grn.rs`
//!     into a pub helper, or (b) routing through the Tauri command (which
//!     would force base64 round-tripping). Both are larger refactors than
//!     S24.3 scope; tracked as TODO(s24.4) below.
//!   - Tier-B (LayoutLMv3 ONNX) — feature-flagged behind `tier-b-onnx`.
//!     Without the flag: graceful `Err` naming the missing feature.
//!     With the flag but no `model.onnx`: graceful `Err` naming the
//!     missing bundle (per ADR-0069 fallback chain).
//!     With the flag and the bundle: loads via `ort::Session::builder()`
//!     to prove the load path compiles, then returns
//!     `Err("...post-processing TODO(S25)")`.
//!   - Tier-C (vision-LLM) — unchanged stub.
//!
//! Per Playbook v2.0 §12 hard rule: every AI feature must have a non-AI
//! fallback. The orchestrator therefore *never* panics and always returns
//! an `ExtractionResult`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExtractedLine {
    pub product_name: String,
    pub batch_no: Option<String>,
    pub qty: Option<i32>,
    pub mrp_paise: Option<i64>,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionResult {
    /// One of "tier_a" | "tier_b" | "tier_c" | "none".
    pub tier_used: String,
    pub lines: Vec<ExtractedLine>,
    /// Most-recent error from a failing tier; `None` only on success.
    pub error: Option<String>,
}

/// Stable extractor trait. Each tier implements this; the orchestrator
/// composes them in fixed A→B→C order.
pub trait PhotoGrnTier {
    fn name(&self) -> &'static str;
    fn extract(&self, image_path: &str) -> Result<Vec<ExtractedLine>, String>;
}

// ---------------- Tier A — on-device regex (existing photo_grn module) -----

pub struct TierAExtractor;

impl PhotoGrnTier for TierAExtractor {
    fn name(&self) -> &'static str {
        "tier_a"
    }

    fn extract(&self, _image_path: &str) -> Result<Vec<ExtractedLine>, String> {
        // TODO(s24.4): bridge to `crate::photo_grn`. Blocker: that module
        // exposes only `photo_grn_run(PhotoGrnInput) -> PhotoGrnResultDto`,
        // a Tauri command taking base64-encoded photo bytes + reportedMime
        // + shopId. There is no `(image_path: &str) -> Vec<ExtractedLine>`
        // entry point yet. Bridge options:
        //   1. Lift the internal regex extractor out into a pub helper
        //      (e.g. `pub fn extract_lines_from_text(&str) -> Vec<...>`)
        //      and add a small `image_to_text` OCR shim here.
        //   2. Route through `photo_grn_run` (forces base64 round-trip).
        // Option (1) is preferred but requires touching `photo_grn.rs`;
        // out of S24.3 scope. Until then we return Ok(vec![]) — the
        // orchestrator's soft-miss → Tier-B fall-through is what's
        // exercised end-to-end here.
        Ok(vec![])
    }
}

// ---------------- Tier B — layout-aware OCR (LayoutLMv3 ONNX) --------------

pub struct TierBExtractor;

/// Path to the Tier-B bundle, relative to the crate root. Kept as a
/// constant so the absent-bundle Err message can name the exact place
/// the operator must drop the signed file (per ADR-0069 README).
const TIER_B_MODEL_PATH: &str = "apps/desktop/src-tauri/models/photo_grn/tier_b/model.onnx";

impl PhotoGrnTier for TierBExtractor {
    fn name(&self) -> &'static str {
        "tier_b"
    }

    #[cfg(not(feature = "tier-b-onnx"))]
    fn extract(&self, _image_path: &str) -> Result<Vec<ExtractedLine>, String> {
        Err("Tier-B compiled without ONNX feature flag (rebuild with --features tier-b-onnx and install model bundle per ADR-0069)".to_string())
    }

    #[cfg(feature = "tier-b-onnx")]
    fn extract(&self, _image_path: &str) -> Result<Vec<ExtractedLine>, String> {
        use std::path::Path;

        if !Path::new(TIER_B_MODEL_PATH).exists() {
            return Err(format!(
                "Tier-B model bundle absent at {} — install signed bundle per ADR-0069",
                TIER_B_MODEL_PATH
            ));
        }

        // Bundle present — prove the load path compiles. Real
        // token-classification post-processing lands in S25 once the
        // golden set + tokenizer.json are committed.
        let _session = ort::Session::builder()
            .map_err(|e| format!("Tier-B ort builder init failed: {e}"))?
            .commit_from_file(TIER_B_MODEL_PATH)
            .map_err(|e| format!("Tier-B ort load failed at {TIER_B_MODEL_PATH}: {e}"))?;

        Err("Tier-B inference loaded but post-processing TODO(S25)".to_string())
    }
}

// ---------------- Tier C — vision-LLM fallback ----------------------------

pub struct TierCExtractor;

impl PhotoGrnTier for TierCExtractor {
    fn name(&self) -> &'static str {
        "tier_c"
    }

    fn extract(&self, _image_path: &str) -> Result<Vec<ExtractedLine>, String> {
        Err("Tier-C vision-LLM not yet wired (deferred to S25 per ADR-0068)".to_string())
    }
}

// ---------------- Orchestrator --------------------------------------------

/// Run A → B → C until one tier returns at least one usable line.
///
/// Acceptance per ADR-0068 §Decision: a tier "succeeds" when it returns
/// `Ok` with `len() >= 1`. Empty `Ok(vec![])` is treated as a soft miss
/// and we fall through to the next tier (this is what makes the
/// non-AI fallback robust — Tier-A returning zero hits is not an error).
///
/// Confidence thresholding (≥0.6 average) is enforced in S25 once Tier-B/C
/// produce real confidence scores; the trait already carries the field so
/// no signature change is needed.
pub fn extract_with_fallback(image_path: &str) -> ExtractionResult {
    let tiers: Vec<Box<dyn PhotoGrnTier>> = vec![
        Box::new(TierAExtractor),
        Box::new(TierBExtractor),
        Box::new(TierCExtractor),
    ];

    let mut last_err: Option<String> = None;

    for tier in tiers.iter() {
        match tier.extract(image_path) {
            Ok(lines) if !lines.is_empty() => {
                return ExtractionResult {
                    tier_used: tier.name().to_string(),
                    lines,
                    error: None,
                };
            }
            Ok(_) => {
                // Soft miss — record nothing, try next tier.
                continue;
            }
            Err(e) => {
                last_err = Some(e);
                continue;
            }
        }
    }

    ExtractionResult {
        tier_used: "none".to_string(),
        lines: vec![],
        error: last_err.or_else(|| Some("all tiers returned zero lines".to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_a_returns_empty_ok_in_s24_3() {
        // Tier-A bridge still blocked (see TODO in extract); Ok(vec![])
        // is the documented soft-miss behaviour the orchestrator relies on.
        let r = TierAExtractor.extract("nonexistent.jpg");
        assert!(r.is_ok());
        assert!(r.unwrap().is_empty());
    }

    #[test]
    fn tier_b_errors_naming_the_tier() {
        // Either "compiled without ONNX feature flag" (default build) or
        // "model bundle absent" (feature-on, no .onnx). Both must contain
        // "Tier-B" so downstream UI/log scrapers can route the message.
        let r = TierBExtractor.extract("nonexistent.jpg");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("Tier-B"));
    }

    #[test]
    fn tier_c_errors_with_deferral_message() {
        let r = TierCExtractor.extract("nonexistent.jpg");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("Tier-C"));
    }

    /// Inline smoke test (ADR-0069 §Test strategy). Lives here because
    /// the desktop crate has no `[lib]` target and we want this covered
    /// by `cargo test` without a second `#[path = ...]` shim.
    #[test]
    fn tier_b_graceful_err_on_missing_bundle() {
        let r = TierBExtractor.extract("/nonexistent/path.jpg");
        assert!(
            r.is_err(),
            "Tier-B must Err when bundle absent (Playbook §12 fallback)"
        );
        let msg = r.unwrap_err();
        assert!(msg.contains("Tier-B"), "Err must name the tier; got: {msg}");
    }

    #[cfg(feature = "tier-b-onnx")]
    #[test]
    fn tier_b_with_feature_still_errs_without_bundle() {
        // The repo dev tree intentionally omits model.onnx. Even with
        // the feature flag on, the absent-bundle path must Err
        // gracefully — that is the ADR-0069 fallback contract.
        let r = TierBExtractor.extract("/nonexistent/path.jpg");
        assert!(r.is_err(), "Even with feature on, missing .onnx → Err");
        assert!(r.unwrap_err().contains("bundle absent"));
    }
}
