//! Integration tests for product_images + product_image_audit (migration 0017).
//! Pairs with apps/desktop/src-tauri/src/images.rs.

use rusqlite::{params, Connection};

fn apply_migrations_from_dir(c: &Connection) {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../packages/shared-db/migrations");
    let mut entries: Vec<_> = std::fs::read_dir(dir).unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "sql"))
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let sql = std::fs::read_to_string(entry.path()).unwrap();
        c.execute_batch(&sql).unwrap_or_else(|e| panic!("migration {}: {e}", entry.file_name().to_string_lossy()));
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

#[test]
fn mime_check_blocks_gif() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    let bad = c.execute(
        "INSERT INTO product_images (product_id, sha256, mime, size_bytes, bytes, uploaded_by) \
         VALUES ('p_para', ?1, 'image/gif', 1024, X'00', 'u_owner')",
        params![format!("{:0>64}", "deadbeef")],
    );
    assert!(bad.is_err(), "image/gif should be rejected by CHECK");
}

#[test]
fn size_check_rejects_above_2mib() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    let bad = c.execute(
        "INSERT INTO product_images (product_id, sha256, mime, size_bytes, bytes, uploaded_by) \
         VALUES ('p_para', ?1, 'image/png', 2097153, X'00', 'u_owner')",
        params![format!("{:0>64}", "ab")],
    );
    assert!(bad.is_err(), "size_bytes > 2 MiB should be rejected");
}

#[test]
fn sha256_index_finds_dupes_fast() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    let sha = format!("{:0>64}", "cafebabe");
    c.execute(
        "INSERT INTO product_images (product_id, sha256, mime, size_bytes, bytes, uploaded_by) \
         VALUES ('p_para', ?1, 'image/png', 1024, X'00', 'u_owner')",
        params![&sha],
    ).unwrap();
    let n: i64 = c.query_row("SELECT count(*) FROM product_images WHERE sha256 = ?1", params![&sha], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
}

#[test]
fn audit_log_action_check_blocks_invalid() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    let bad = c.execute(
        "INSERT INTO product_image_audit (product_id, action, actor_user_id) \
         VALUES ('p_para', 'spank', 'u_owner')",
        [],
    );
    assert!(bad.is_err(), "action other than attach/replace/delete should be rejected");
}
