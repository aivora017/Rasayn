// photo_grn.rs — Tauri commands for X3 (photo-of-paper-bill → GRN draft).
// ADR-0024.
//
// Phase-1 implementation: takes a base64-encoded image + reportedMime + shopId,
// computes SHA-256 over the bytes, and returns an empty ParsedBill stub with
// requiresOperatorReview=true (matching @pharmacare/photo-grn Phase-1 stub).
//
// Real Tier-A (regex) / Tier-B (LayoutLMv3) / Tier-C (vision LLM) orchestrators
// land in subsequent phases. This command exists so the JS-side PhotoBillCapture
// can wire its file-picker to a Tauri call instead of mocking the OCR loop.

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoGrnInput {
    pub photo_bytes_b64: String,
    pub reported_mime: String,
    pub shop_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedBillHeader {
    pub invoice_no: Option<String>,
    pub invoice_date: Option<String>,
    pub total_paise: Option<i64>,
    pub supplier_hint: Option<String>,
    pub confidence: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedBillDto {
    pub tier: String,
    pub header: ParsedBillHeader,
    pub lines: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoGrnResultDto {
    pub bill: ParsedBillDto,
    pub winning_tier: String,
    pub tiers_attempted: Vec<String>,
    pub model_version: String,
    pub requires_operator_review: bool,
    pub cost_paise: i64,
    pub photo_sha256: String,
    pub bytes_len: usize,
}

#[tauri::command]
pub fn photo_grn_run(input: PhotoGrnInput) -> Result<PhotoGrnResultDto, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&input.photo_bytes_b64)
        .map_err(|e| format!("invalid base64: {e}"))?;

    if bytes.is_empty() {
        return Err("empty photo bytes".into());
    }
    if bytes.len() > 10 * 1024 * 1024 {
        return Err(format!("photo too large: {} bytes (max 10 MiB)", bytes.len()));
    }

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha = hex::encode(hasher.finalize());

    // Phase-1 stub: empty bill, requires operator review.
    Ok(PhotoGrnResultDto {
        bill: ParsedBillDto {
            tier: "A".into(),
            header: ParsedBillHeader {
                invoice_no: None,
                invoice_date: None,
                total_paise: None,
                supplier_hint: None,
                confidence: 0.0,
            },
            lines: Vec::new(),
        },
        winning_tier: "A".into(),
        tiers_attempted: vec!["A".into()],
        model_version: format!("stub-0.1.0-{}-{}", input.reported_mime, input.shop_id),
        requires_operator_review: true,
        cost_paise: 0,
        photo_sha256: sha,
        bytes_len: bytes.len(),
    })
}
