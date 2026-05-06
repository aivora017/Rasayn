//! Integration tests for formulary_loader.rs (S26.D DDI/allergy hydration).
//! Pairs with apps/desktop/src-tauri/src/formulary_loader.rs and migration 0046.

use rusqlite::{params, Connection};

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

fn seed_shop_and_customer(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) \
           VALUES ('shop_main', 'Test', '27ABCDE1234F1Z5', '27', 'RL-1', 'Kalyan');\
         INSERT INTO customers (id, shop_id, name) \
           VALUES ('c_known', 'shop_main', 'Known Patient');",
    )
    .unwrap();
}

#[test]
fn ddi_pairs_seeded_after_migration_0046() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    let n: i64 = c
        .query_row("SELECT count(*) FROM ddi_pairs", [], |r| r.get(0))
        .unwrap();
    assert!(n >= 50, "expected at least 50 DDI pairs from 0046, got {n}");

    // Spot-check: warfarin + aspirin must be present and severity='block'.
    let sev: String = c
        .query_row(
            "SELECT severity FROM ddi_pairs
             WHERE ingredient_a = 'ing_aspirin' AND ingredient_b = 'ing_warfarin'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(sev, "block");
}

#[test]
fn customer_allergies_returns_empty_for_unknown_customer() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_customer(&c);

    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM customer_allergies WHERE customer_id = ?1",
            params!["c_does_not_exist"],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 0);
}

#[test]
fn customer_allergies_returns_recorded_rows_when_present() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_customer(&c);

    c.execute(
        "INSERT INTO customer_allergies (customer_id, ingredient_id, severity) \
         VALUES ('c_known', 'ing_amoxicillin', 'warn')",
        [],
    )
    .unwrap();

    let mut stmt = c
        .prepare(
            "SELECT ca.customer_id, ca.ingredient_id, fi.inn, ca.severity
             FROM customer_allergies ca
             JOIN formulary_ingredients fi ON fi.id = ca.ingredient_id
             WHERE ca.customer_id = ?1",
        )
        .unwrap();
    let rows: Vec<(String, String, String, String)> = stmt
        .query_map(params!["c_known"], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].2, "amoxicillin");
    assert_eq!(rows[0].3, "warn");
}

#[test]
fn dose_ranges_returns_some_for_paracetamol() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);

    // Adult dose row for paracetamol from 0046.
    let (daily_max, per_dose): (f64, f64) = c
        .query_row(
            "SELECT daily_max_mg, per_dose_max_mg
             FROM dose_ranges
             WHERE ingredient_id = 'ing_paracetamol' AND age_min_years = 18",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(daily_max as i64, 4000);
    assert_eq!(per_dose as i64, 1000);
}
