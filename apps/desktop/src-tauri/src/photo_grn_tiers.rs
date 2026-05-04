//! photo_grn_tiers.rs — pluggable A→B→C orchestrator for X3 photo-of-paper-bill → GRN.
//!
//! ADR-0068 (extends ADR-0024). This module defines the stable trait + result
//! shape that survives from S23a forward. Real model wiring is deferred:
//!   - Tier-A (regex) — stub here in S23a; bridges to `photo_grn` in S24.
//!   - Tier-B (LayoutLMv3 / Donut) — stub; real impl in S25.
//!   - Tier-C (vision-LLM fallback) — stub; real impl in S25.
//!
//! Per playbook §12 hard rule: every AI feature must have a non-AI fallback.
//! The orchestrator therefore *never* panics and always returns an
//! `ExtractionResult`, even one with `tier_used = "none"` and empty `lines`.

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
        // TODO(s24): bridge to the existing `photo_grn` Tauri-side regex parser
        // (Marg / Tally export templates). For S23a we return Ok(vec![]) so the
        // orchestrator's fall-through path is exercised end-to-end.
        Ok(vec![])
    }
}

// ---------------- Tier B — layout-aware OCR (LayoutLMv3 / Donut) -----------

pub struct TierBExtractor;

impl PhotoGrnTier for TierBExtractor {
    fn name(&self) -> &'static str {
        "tier_b"
    }

    fn extract(&self, _image_path: &str) -> Result<Vec<ExtractedLine>, String> {
        Err("Tier-B model bundle not yet shipped (deferred to S25 per ADR-0068)".to_string())
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
    fn tier_a_returns_empty_ok_in_s23a() {
        let r = TierAExtractor.extract("nonexistent.jpg");
        assert!(r.is_ok());
        assert!(r.unwrap().is_empty());
    }

    #[test]
    fn tier_b_errors_with_deferral_message() {
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
}
