//! Unit tests for src/images.rs helpers and SQL paths (S24.1).
//!
//! Pairs with apps/desktop/src-tauri/tests/images_test.rs (schema CHECKs
//! and trigger gates). This file targets the helper-level surface:
//!   * sniff_mime — magic-byte sniff (ADR-0018, hard rule against
//!     trusting client-reported MIME). Replicated locally because it is
//!     a 4-line pure function with no external deps.
//!   * sha256 storage round-trip — we treat sha256_hex as a black-box
//!     (sha2 not in dev-deps), insert a known sha256 string into
//!     product_images and read it back to lock the schema-level contract
//!     (sha256 column persists exactly what `attach_product_image` writes).
//!   * get_product_image — verifies the SELECT returns NULL for an
//!     unknown product, matching the runtime command's None branch.

use rusqlite::{params, Connection};

// ─── sniff_mime replica (mirrors src/images.rs) ────────────────────────

const PNG_SIG: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SOI: &[u8] = &[0xff, 0xd8, 0xff];
const RIFF: &[u8] = &[0x52, 0x49, 0x46, 0x46];
const WEBP: &[u8] = &[0x57, 0x45, 0x42, 0x50];

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

#[test]
fn sniff_mime_recognises_png_signature() {
    let mut bytes = Vec::from(PNG_SIG);
    bytes.extend_from_slice(b"\x00\x00\x00\rIHDR..."); // any trailing bytes
    assert_eq!(sniff_mime(&bytes), Some("image/png"));
}

#[test]
fn sniff_mime_recognises_jpeg_soi() {
    let bytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];
    assert_eq!(sniff_mime(&bytes), Some("image/jpeg"));
}

#[test]
fn sniff_mime_recognises_webp_riff_envelope() {
    // Bytes 0..4 = "RIFF", 4..8 = filesize (any), 8..12 = "WEBP".
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&[0x24, 0x00, 0x00, 0x00]); // filesize placeholder
    bytes.extend_from_slice(b"WEBP");
    bytes.extend_from_slice(b"VP8 ..."); // any trailing
    assert_eq!(sniff_mime(&bytes), Some("image/webp"));
}

#[test]
fn sniff_mime_rejects_riff_that_is_not_webp() {
    // RIFF AVI/WAV containers must NOT be accepted as images.
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&[0x24, 0x00, 0x00, 0x00]);
    bytes.extend_from_slice(b"AVI "); // not WEBP
    bytes.extend_from_slice(b"more...");
    assert_eq!(
        sniff_mime(&bytes),
        None,
        "RIFF/AVI must be rejected; only RIFF/WEBP is allowed"
    );
}

#[test]
fn sniff_mime_rejects_unknown_bytes() {
    assert_eq!(sniff_mime(b""), None);
    assert_eq!(sniff_mime(b"GIF89a..."), None);
    assert_eq!(sniff_mime(b"\x00\x00\x00\x00"), None);
    // Truncated RIFF (less than 12 bytes) must not pass the WEBP check.
    let mut short = Vec::from(b"RIFF" as &[u8]);
    short.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // only 8 bytes total
    assert_eq!(sniff_mime(&short), None);
}

// ─── DB round-trip helpers ─────────────────────────────────────────────

fn apply_migrations_from_dir(c: &Connection) {
    let dir = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/shared-db/migrations"
    );
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "sql"))
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let sql = std::fs::read_to_string(entry.path()).unwrap();
        c.execute_batch(&sql)
            .unwrap_or_else(|e| panic!("migration {}: {e}", entry.file_name().to_string_lossy()));
    }
}

fn seed(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) \
           VALUES ('shop_main', 'Test', '27ABCDE1234F1Z5', '27', 'RL-1', 'Kalyan');
         INSERT INTO users (id, shop_id, name, role, pin_hash) \
           VALUES ('u_owner', 'shop_main', 'Owner', 'owner', 'h');
         INSERT INTO products (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise, created_at, is_active) \
           VALUES ('p_para', 'Paracetamol 500mg', 'GSK', '30049011', 12, 'OTC', 'tab', 10, 200, '2026-01-01', 1);"
    ).unwrap();
}

// SHA-256 of b"abc" as hex (known fixture). Used as opaque storage value;
// we are not re-computing sha256 here (sha2 is not in dev-deps).
const SHA256_OF_ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

#[test]
fn product_images_round_trip_preserves_sha256_and_mime() {
    // Mirrors the `attach_product_image` -> `get_product_image` happy path
    // at the schema layer: insert a row and verify every column we emit
    // through ImageMetadata round-trips byte-for-byte.
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    // PNG signature + 1 byte of payload — enough for the size_bytes field.
    let payload: Vec<u8> = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xab];
    assert_eq!(sniff_mime(&payload), Some("image/png"));

    c.execute(
        "INSERT INTO product_images \
            (product_id, sha256, mime, size_bytes, bytes, uploaded_by) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            "p_para",
            SHA256_OF_ABC,
            "image/png",
            payload.len() as i64,
            payload,
            "u_owner"
        ],
    )
    .unwrap();

    let (sha, mime, size): (String, String, i64) = c
        .query_row(
            "SELECT sha256, mime, size_bytes FROM product_images WHERE product_id = ?1",
            params!["p_para"],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(sha, SHA256_OF_ABC, "sha256 column must persist verbatim");
    assert_eq!(mime, "image/png");
    assert_eq!(size, 9);
}

#[test]
fn get_product_image_returns_nothing_for_missing_product() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM product_images WHERE product_id = ?1",
            params!["p_para"],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 0, "no image attached yet — get_product_image must yield None");
}

#[test]
fn product_images_pk_blocks_two_rows_per_product() {
    // attach_product_image uses ON CONFLICT(product_id) DO UPDATE; the
    // PRIMARY KEY on product_id is what makes that an upsert. Pin it.
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    let payload: Vec<u8> = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff];
    c.execute(
        "INSERT INTO product_images \
            (product_id, sha256, mime, size_bytes, bytes, uploaded_by) \
         VALUES (?1, ?2, 'image/png', ?3, ?4, 'u_owner')",
        params!["p_para", SHA256_OF_ABC, payload.len() as i64, payload.clone()],
    )
    .unwrap();

    // Plain INSERT (no ON CONFLICT) for the same product_id must fail.
    let dup = c.execute(
        "INSERT INTO product_images \
            (product_id, sha256, mime, size_bytes, bytes, uploaded_by) \
         VALUES (?1, ?2, 'image/png', ?3, ?4, 'u_owner')",
        params!["p_para", "f".repeat(64), payload.len() as i64, payload],
    );
    assert!(
        dup.is_err(),
        "second image for same product without ON CONFLICT must hit PK"
    );
}

#[test]
fn audit_log_records_attach_action() {
    // attach_product_image inserts a product_image_audit row with action
    // 'attach' on first save. Pin the schema's allowed-action set.
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    c.execute(
        "INSERT INTO product_image_audit (product_id, action, prior_sha256, new_sha256, actor_user_id) \
         VALUES (?1, 'attach', NULL, ?2, 'u_owner')",
        params!["p_para", SHA256_OF_ABC],
    )
    .unwrap();
    c.execute(
        "INSERT INTO product_image_audit (product_id, action, prior_sha256, new_sha256, actor_user_id) \
         VALUES (?1, 'replace', ?2, ?3, 'u_owner')",
        params!["p_para", SHA256_OF_ABC, "e".repeat(64)],
    )
    .unwrap();
    c.execute(
        "INSERT INTO product_image_audit (product_id, action, prior_sha256, new_sha256, actor_user_id) \
         VALUES (?1, 'delete', ?2, NULL, 'u_owner')",
        params!["p_para", "e".repeat(64)],
    )
    .unwrap();

    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM product_image_audit WHERE product_id = 'p_para'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        n, 3,
        "attach/replace/delete must all be accepted by the audit CHECK"
    );
}
