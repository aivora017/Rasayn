//! Integration tests for the product_ingredients module.
//! Lives outside src/ to escape the Windows-mount truncation that ate the
//! original `#[cfg(test)] mod tests { ... }` block in product_ingredients.rs.

// We deliberately don't `use pharmacare_desktop::...` here because the
// target is a binary crate. These tests exercise the schema directly via
// rusqlite + the migration apply path that ships in the binary.

use rusqlite::{params, Connection};

/// Replicate apply_migrations from src/db.rs by reading every migration file
/// in lexical order. Keeps these tests independent of the binary's lib API.
fn apply_migrations_from_dir(c: &Connection) {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../packages/shared-db/migrations");
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .expect("migrations dir")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "sql"))
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let sql = std::fs::read_to_string(entry.path()).expect("read migration");
        c.execute_batch(&sql).unwrap_or_else(|e| {
            panic!("migration {} failed: {e}", entry.file_name().to_string_lossy())
        });
    }
}

fn seed_two_products(c: &Connection) {
    c.execute_batch(
        "INSERT INTO products (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise, created_at, is_active) \
         VALUES ('p_para', 'Paracetamol 500mg', 'GSK', '30049011', 12, 'OTC', 'tab', 10, 200, '2026-01-01', 1);
         INSERT INTO products (id, name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise, image_sha256, created_at, is_active) \
         VALUES ('p_amox', 'Amoxicillin 500mg', 'Cipla', '30041010', 12, 'H', 'cap', 10, 380, 'aa', '2026-01-01', 1);"
    ).unwrap();
}

#[test]
fn migration_0042_creates_table() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    let n: i64 = c.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='product_ingredients'",
        [], |r| r.get(0),
    ).unwrap();
    assert_eq!(n, 1);
}

#[test]
fn upsert_via_on_conflict_keeps_one_row() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_two_products(&c);
    c.execute(
        "INSERT INTO product_ingredients (id, product_id, ingredient_id, per_dose_mg, daily_mg) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(product_id, ingredient_id) DO UPDATE SET per_dose_mg = excluded.per_dose_mg",
        params!["pi1", "p_para", "paracetamol", 500.0, 4000.0],
    ).unwrap();
    c.execute(
        "INSERT INTO product_ingredients (id, product_id, ingredient_id, per_dose_mg, daily_mg) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(product_id, ingredient_id) DO UPDATE SET per_dose_mg = excluded.per_dose_mg",
        params!["pi2", "p_para", "paracetamol", 650.0, 4000.0],
    ).unwrap();
    let dose: f64 = c.query_row(
        "SELECT per_dose_mg FROM product_ingredients WHERE product_id='p_para' AND ingredient_id='paracetamol'",
        [], |r| r.get(0),
    ).unwrap();
    assert_eq!(dose, 650.0);
    let n: i64 = c.query_row("SELECT count(*) FROM product_ingredients WHERE product_id='p_para'", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
}

#[test]
fn list_filters_by_product_id() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_two_products(&c);
    c.execute_batch(
        "INSERT INTO product_ingredients (id, product_id, ingredient_id) VALUES ('pi_p1', 'p_para', 'paracetamol');
         INSERT INTO product_ingredients (id, product_id, ingredient_id) VALUES ('pi_a1', 'p_amox', 'amoxicillin');
         INSERT INTO product_ingredients (id, product_id, ingredient_id) VALUES ('pi_a2', 'p_amox', 'penicillin');"
    ).unwrap();
    let n_amox: i64 = c.query_row("SELECT count(*) FROM product_ingredients WHERE product_id='p_amox'", [], |r| r.get(0)).unwrap();
    assert_eq!(n_amox, 2);
}
