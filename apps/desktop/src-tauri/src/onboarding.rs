// onboarding.rs — Tauri-side helpers for the OnboardingWizard (S28-B3).
//
// The wizard does its own rich validation in TS (so the user gets fast
// inline error feedback), but anything that touches the filesystem
// (license-PDF attestation) or that the cloud licence-mint side will
// later cross-check (retail-licence format) lives here. Both are HARD
// REQUIREMENTS of the Drugs & Cosmetics Rules 1945 + DPDP Act 2023 §8
// audit trail.
//
// Migration 0052 adds `retail_license_pdf_path` and `schedule_h_license_no`
// to the shops table. The DPO / grievance fields are migration 0048.

use crate::db::DbState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

/// Maximum bytes we accept for a retail-licence PDF attestation. Larger
/// PDFs almost certainly indicate a scanned multi-page that should be
/// down-sampled first; the wizard surfaces this as a recoverable error.
const MAX_PDF_BYTES: u64 = 10 * 1024 * 1024;

/// State-prefixed retail-licence regex documentation source:
/// Maharashtra FDA "Form 20 & 21" licence numbers are issued by the
/// Joint Commissioner / Drug Controller and follow the convention
/// `<STATE>-DRG-<digits>` where STATE is the 2-letter state code (MH, KA,
/// GJ, TN, ...). A small fraction of older numbers omit the "DRG-" prefix
/// and use just digits — we accept both forms, but the regex MUST start
/// with a 2-letter state prefix to satisfy the audit's "issuer-traceable"
/// requirement.
///
/// Reference: Maharashtra FDA licence-search portal layout, observed
/// 2026-04 during the Vaidyanath onboarding research pass; cross-checked
/// against Karnataka and Tamil Nadu licence numbers.
const RETAIL_LICENSE_RE: &str = r"^[A-Z]{2}-(?:(?:DRG|FORM\s*20|FORM\s*21|DL)-)?[A-Z0-9]{4,15}$";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RetailLicenseValidation {
    pub ok: bool,
    pub reason: Option<String>,
    /// Echoed back so the UI can show the canonical (uppercased) form.
    pub normalized: Option<String>,
}

/// Lightweight regex-free check. We keep this in pure Rust rather than
/// pulling in the `regex` crate solely for one validation; the rules are
/// simple enough to express by hand.
fn retail_license_valid(input: &str) -> bool {
    let s = input.trim();
    if s.len() < 5 || s.len() > 32 {
        return false;
    }
    let bytes = s.as_bytes();
    // First two chars must be uppercase letters.
    if !bytes[0].is_ascii_uppercase() || !bytes[1].is_ascii_uppercase() {
        return false;
    }
    // Third char must be a hyphen.
    if bytes[2] != b'-' {
        return false;
    }
    // Remaining chars: uppercase letters, digits, hyphens, spaces only.
    let tail = &s[3..];
    if tail.is_empty() {
        return false;
    }
    for c in tail.chars() {
        if !(c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-' || c == ' ') {
            return false;
        }
    }
    // Must contain at least 4 alphanumerics in the tail.
    let alphanum = tail.chars().filter(|c| c.is_ascii_alphanumeric()).count();
    alphanum >= 4
}

/// Validate the retail-licence number format (Drugs & Cosmetics Form 20 / 21).
/// This is a hard gate on the wizard "Save shop" button.
#[tauri::command]
pub fn validate_retail_license_format(license_no: String) -> RetailLicenseValidation {
    let trimmed = license_no.trim();
    if trimmed.is_empty() {
        return RetailLicenseValidation {
            ok: false,
            reason: Some("Retail licence number is required".into()),
            normalized: None,
        };
    }
    let normalized = trimmed.to_uppercase();
    if retail_license_valid(&normalized) {
        RetailLicenseValidation {
            ok: true,
            reason: None,
            normalized: Some(normalized),
        }
    } else {
        RetailLicenseValidation {
            ok: false,
            reason: Some(
                "Format must be STATE-CODE prefixed alphanumeric, e.g. MH-DRG-12345 (see regex doc)"
                    .into(),
            ),
            normalized: Some(normalized),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AttachLicenseResult {
    pub ok: bool,
    pub stored_path: Option<String>,
    pub size_bytes: Option<u64>,
    pub reason: Option<String>,
}

/// Persist a retail-licence PDF path into `shops.retail_license_pdf_path`.
/// We DO NOT copy the file ourselves — the founder's runbook stores PDFs
/// inside the same backup-folder root as the SQLite file, so a
/// re-image of the device pulls the PDF along. We only verify the file
/// exists, has a `.pdf` extension, and is under MAX_PDF_BYTES.
#[tauri::command]
pub fn attach_retail_license_pdf(
    state: State<DbState>,
    shop_id: String,
    path: String,
) -> Result<AttachLicenseResult, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(AttachLicenseResult {
            ok: false,
            stored_path: None,
            size_bytes: None,
            reason: Some("File not found".into()),
        });
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    if ext.as_deref() != Some("pdf") {
        return Ok(AttachLicenseResult {
            ok: false,
            stored_path: None,
            size_bytes: None,
            reason: Some("Only .pdf files are accepted".into()),
        });
    }
    let size = std::fs::metadata(p).map_err(|e| e.to_string())?.len();
    if size > MAX_PDF_BYTES {
        return Ok(AttachLicenseResult {
            ok: false,
            stored_path: None,
            size_bytes: Some(size),
            reason: Some(format!("PDF is {} bytes; max {}", size, MAX_PDF_BYTES)),
        });
    }
    let stored = path.clone();
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE shops SET retail_license_pdf_path = ?1 WHERE id = ?2",
        params![stored, shop_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(AttachLicenseResult {
        ok: true,
        stored_path: Some(stored),
        size_bytes: Some(size),
        reason: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn license_format_accepts_canonical_mh_drg() {
        let r = validate_retail_license_format("MH-DRG-12345".into());
        assert!(r.ok, "expected MH-DRG-12345 to be valid: {:?}", r.reason);
    }

    #[test]
    fn license_format_accepts_lowercase_input_via_normalization() {
        let r = validate_retail_license_format("ka-drg-9999".into());
        assert!(r.ok);
        assert_eq!(r.normalized.as_deref(), Some("KA-DRG-9999"));
    }

    #[test]
    fn license_format_rejects_no_state_prefix() {
        let r = validate_retail_license_format("DRG-12345".into());
        assert!(!r.ok);
    }

    #[test]
    fn license_format_rejects_too_short() {
        let r = validate_retail_license_format("MH".into());
        assert!(!r.ok);
    }

    #[test]
    fn license_format_rejects_special_chars() {
        let r = validate_retail_license_format("MH/DRG/12345".into());
        assert!(!r.ok);
    }

    #[test]
    fn license_format_rejects_empty() {
        let r = validate_retail_license_format("   ".into());
        assert!(!r.ok);
    }

    #[test]
    fn regex_doc_constant_is_present() {
        // The regex string is reference documentation only; we don't compile
        // it at runtime. Smoke check that it lives in source for audit.
        assert!(RETAIL_LICENSE_RE.starts_with("^[A-Z]{2}"));
    }
}
