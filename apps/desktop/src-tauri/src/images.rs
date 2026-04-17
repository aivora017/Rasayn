// X2a mandatory SKU images — Rust commands + IPC.
//
// ADR: docs/adr/0018-x2-sku-images.md
// Playbook: §4 Three Moats → X2, §8 compliance guardrails
//
// Hard rules enforced:
//  * Hard Rule 1 (LAN-first): BLOB lives in SQLite; no filesystem side-effects.
//  * Hard Rule 5 (compliance automatic): Schedule H/H1/X gate lives in migration
//    0001 triggers + 0017 sync triggers; this module just drives them.
//  * Server-side MIME magic-byte sniff — never trust the client-reported MIME.
//  * Server-side SHA256 re-hash — never trust the client-supplied hash.
//  * 2 MiB hard cap — enforced both here (before DB hit) and at the CHECK constraint.

use crate::db::DbState;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

/// 2 MiB (matches SQLite CHECK + TS validator).
pub const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;

const PNG_SIG: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SOI: &[u8] = &[0xff, 0xd8, 0xff];
const RIFF: &[u8] = &[0x52, 0x49, 0x46, 0x46];
const WEBP: &[u8] = &[0x57, 0x45, 0x42, 0x50];

/// Sniff magic bytes. Returns the canonical MIME or None for unrecognised / disallowed.
fn sniff_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(PNG_SIG) {
        Some("image/png")
    } else if bytes.starts_with(JPEG_SOI) {
        Some("image/jpeg")
    } else if bytes.starts_with(RIFF) && bytes.len() >= 12 && &bytes[8..12] == WEBP {
        Some("image/webp")
    } else {
        None
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    let d = h.finalize();
    let mut out = String::with_capacity(64);
    for b in d.iter() {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

#[derive(Debug, Deserialize)]
pub struct AttachImageInput {
    #[serde(rename = "productId")]
    pub product_id: String,
    /// Base64 (standard, no URL-safe) of the raw image bytes.
    #[serde(rename = "bytesB64")]
    pub bytes_b64: String,
    /// Browser-reported MIME; advisory only. Server sniffs magic bytes.
    #[serde(rename = "reportedMime")]
    pub reported_mime: Option<String>,
    #[serde(rename = "actorUserId")]
    pub actor_user_id: String,
}

#[derive(Debug, Serialize)]
pub struct ImageMetadata {
    pub sha256: String,
    pub mime: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: i64,
    #[serde(rename = "productId")]
    pub product_id: String,
}

#[derive(Debug, Serialize)]
pub struct ProductImageRow {
    #[serde(rename = "productId")]
    pub product_id: String,
    pub sha256: String,
    pub mime: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: i64,
    #[serde(rename = "bytesB64")]
    pub bytes_b64: String,
    #[serde(rename = "uploadedBy")]
    pub uploaded_by: String,
    #[serde(rename = "uploadedAt")]
    pub uploaded_at: String,
}

#[derive(Debug, Serialize)]
pub struct MissingImageRow {
    #[serde(rename = "productId")]
    pub product_id: String,
    pub name: String,
    pub schedule: String,
    pub manufacturer: String,
    /// "blocker" for Schedule H/H1/X (billing is hard-blocked), "warning" otherwise.
    pub severity: String,
}

/// Attach (or replace) the canonical image for a product.
/// Server re-hashes + re-sniffs — client hash/MIME are advisory only.
#[tauri::command]
pub fn attach_product_image(
    state: State<'_, DbState>,
    input: AttachImageInput,
) -> Result<ImageMetadata, String> {
    let bytes = B64
        .decode(input.bytes_b64.as_bytes())
        .map_err(|e| format!("base64 decode failed: {e}"))?;
    if bytes.is_empty() {
        return Err("Image is empty".into());
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(format!(
            "Image is {} bytes; max {} (2 MiB)",
            bytes.len(),
            MAX_IMAGE_BYTES
        ));
    }
    let mime = sniff_mime(&bytes).ok_or_else(|| {
        "Image format not recognised. Allowed: PNG, JPEG, WebP".to_string()
    })?;
    if let Some(reported) = &input.reported_mime {
        if !reported.is_empty() && reported != mime {
            tracing::warn!(
                product = %input.product_id,
                reported = %reported,
                sniffed = %mime,
                "reported MIME disagrees with magic-byte sniff; trusting sniff"
            );
        }
    }
    let sha = sha256_hex(&bytes);
    let size = bytes.len() as i64;

    let mut conn = state.0.lock().map_err(|e| format!("db lock: {e}"))?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("begin tx: {e}"))?;

    // Existence + actor check — FK to products(id) + users(id) is enforced below,
    // but a friendly error beats a bare FK failure string in the UI.
    let product_exists: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM products WHERE id = ?1",
            [&input.product_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("product lookup: {e}"))?;
    if product_exists == 0 {
        return Err(format!("product {} not found", input.product_id));
    }
    let actor_exists: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM users WHERE id = ?1",
            [&input.actor_user_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("actor lookup: {e}"))?;
    if actor_exists == 0 {
        return Err(format!("actor user {} not found", input.actor_user_id));
    }

    // Prior hash (if any) so we can decide attach vs replace for the audit row.
    let prior_sha: Option<String> = tx
        .query_row(
            "SELECT sha256 FROM product_images WHERE product_id = ?1",
            [&input.product_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("prior-image lookup: {e}"))?;

    tx.execute(
        "INSERT INTO product_images (product_id, sha256, mime, size_bytes, bytes, uploaded_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(product_id) DO UPDATE SET
           sha256 = excluded.sha256,
           mime = excluded.mime,
           size_bytes = excluded.size_bytes,
           bytes = excluded.bytes,
           uploaded_by = excluded.uploaded_by,
           uploaded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![input.product_id, sha, mime, size, bytes, input.actor_user_id],
    )
    .map_err(|e| format!("upsert product_image: {e}"))?;

    let action = if prior_sha.is_some() { "replace" } else { "attach" };
    tx.execute(
        "INSERT INTO product_image_audit (product_id, action, prior_sha256, new_sha256, actor_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![input.product_id, action, prior_sha, &sha, input.actor_user_id],
    )
    .map_err(|e| format!("audit insert: {e}"))?;

    tx.commit().map_err(|e| format!("commit: {e}"))?;

    Ok(ImageMetadata {
        sha256: sha,
        mime: mime.to_string(),
        size_bytes: size,
        product_id: input.product_id,
    })
}

/// Fetch the canonical image for a product. Returns None if no image attached.
#[tauri::command]
pub fn get_product_image(
    state: State<'_, DbState>,
    product_id: String,
) -> Result<Option<ProductImageRow>, String> {
    let conn = state.0.lock().map_err(|e| format!("db lock: {e}"))?;
    let row = conn
        .query_row(
            "SELECT product_id, sha256, mime, size_bytes, bytes, uploaded_by, uploaded_at
             FROM product_images WHERE product_id = ?1",
            [&product_id],
            |r| {
                let bytes: Vec<u8> = r.get(4)?;
                Ok(ProductImageRow {
                    product_id: r.get(0)?,
                    sha256: r.get(1)?,
                    mime: r.get(2)?,
                    size_bytes: r.get(3)?,
                    bytes_b64: B64.encode(&bytes),
                    uploaded_by: r.get(5)?,
                    uploaded_at: r.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("fetch image: {e}"))?;
    Ok(row)
}

/// Delete the canonical image for a product (permitted only for OTC/G — the
/// Schedule H/H1/X gate in migration 0001 triggers blocks the resulting
/// NULL image_sha256 on those schedules).
#[tauri::command]
pub fn delete_product_image(
    state: State<'_, DbState>,
    product_id: String,
    actor_user_id: String,
) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| format!("db lock: {e}"))?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("begin tx: {e}"))?;

    let prior_sha: Option<String> = tx
        .query_row(
            "SELECT sha256 FROM product_images WHERE product_id = ?1",
            [&product_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("prior-image lookup: {e}"))?;

    let Some(prior) = prior_sha else {
        return Err(format!("no image to delete for product {}", product_id));
    };

    tx.execute(
        "DELETE FROM product_images WHERE product_id = ?1",
        [&product_id],
    )
    .map_err(|e| {
        // The Schedule H/H1/X gate trigger fires AFTER the sync trigger NULLs
        // products.image_sha256; translate into a friendlier message.
        let msg = format!("{e}");
        if msg.contains("Schedule H/H1/X product requires image_sha256") {
            "Cannot delete image for Schedule H/H1/X product (X2 moat compliance gate)"
                .to_string()
        } else {
            format!("delete image: {msg}")
        }
    })?;

    tx.execute(
        "INSERT INTO product_image_audit (product_id, action, prior_sha256, new_sha256, actor_user_id)
         VALUES (?1, 'delete', ?2, NULL, ?3)",
        params![product_id, prior, actor_user_id],
    )
    .map_err(|e| format!("audit insert: {e}"))?;

    tx.commit().map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

/// List active products with no attached image.
/// Schedule H/H1/X surface first ("blocker" severity) — those are the ones
/// that break billing. OTC/G follow as "warning".
#[tauri::command]
pub fn list_products_missing_image(
    state: State<'_, DbState>,
) -> Result<Vec<MissingImageRow>, String> {
    let conn = state.0.lock().map_err(|e| format!("db lock: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, p.schedule, p.manufacturer
             FROM products p
             LEFT JOIN product_images pi ON pi.product_id = p.id
             WHERE p.is_active = 1
               AND pi.product_id IS NULL
             ORDER BY
               CASE p.schedule
                 WHEN 'X'  THEN 0
                 WHEN 'H1' THEN 1
                 WHEN 'H'  THEN 2
                 ELSE 3
               END,
               p.name",
        )
        .map_err(|e| format!("prepare: {e}"))?;

    let rows = stmt
        .query_map([], |r| {
            let schedule: String = r.get(2)?;
            let severity = match schedule.as_str() {
                "H" | "H1" | "X" => "blocker",
                _ => "warning",
            }
            .to_string();
            Ok(MissingImageRow {
                product_id: r.get(0)?,
                name: r.get(1)?,
                schedule,
                manufacturer: r.get(3)?,
                severity,
            })
        })
        .map_err(|e| format!("query: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect: {e}"))?;

    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniff_png() {
        let mut b = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        b.extend_from_slice(&[0; 32]);
        assert_eq!(sniff_mime(&b), Some("image/png"));
    }

    #[test]
    fn sniff_jpeg() {
        let mut b = vec![0xff, 0xd8, 0xff, 0xe0];
        b.extend_from_slice(&[0; 32]);
        assert_eq!(sniff_mime(&b), Some("image/jpeg"));
    }

    #[test]
    fn sniff_webp() {
        let mut b = vec![
            0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ];
        b.extend_from_slice(&[0; 20]);
        assert_eq!(sniff_mime(&b), Some("image/webp"));
    }

    #[test]
    fn sniff_rejects_gif() {
        let b = vec![0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
        assert_eq!(sniff_mime(&b), None);
    }

    #[test]
    fn sniff_rejects_empty_and_short() {
        assert_eq!(sniff_mime(&[]), None);
        assert_eq!(sniff_mime(&[0x89, 0x50]), None);
    }

    #[test]
    fn sha_known_values() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn max_bytes_is_2mib() {
        assert_eq!(MAX_IMAGE_BYTES, 2_097_152);
    }
}
