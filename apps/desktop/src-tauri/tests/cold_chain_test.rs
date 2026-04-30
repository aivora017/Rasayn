//! Integration tests for cold_chain — schema + reading log + excursion close.

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

fn seed_shop(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address, created_at)
           VALUES ('shop_a', 'A', '27AAAAA0000A1Z5', '27', 'MH-1', 'Kalyan', '2026-01-01');"
    ).unwrap();
}

#[test]
fn migration_creates_cold_chain_tables() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    for tbl in ["cold_chain_sensors", "cold_chain_readings", "cold_chain_excursions", "cold_chain_batch_links"] {
        let n: i64 = c.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
            params![tbl], |r| r.get(0),
        ).unwrap();
        assert_eq!(n, 1, "table {tbl} missing");
    }
}

#[test]
fn upsert_sensor_then_log_reading() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop(&c);
    c.execute(
        "INSERT INTO cold_chain_sensors (id, shop_id, ble_mac, label, min_safe_c, max_safe_c) \
         VALUES ('s1', 'shop_a', 'aa:bb:cc:dd:ee:01', 'Vaccine Fridge 1', 2.0, 8.0)",
        [],
    ).unwrap();
    c.execute(
        "INSERT INTO cold_chain_readings (sensor_id, temp_c, recorded_at) VALUES ('s1', 4.5, '2026-04-29T10:00:00Z')",
        [],
    ).unwrap();
    let n: i64 = c.query_row("SELECT count(*) FROM cold_chain_readings WHERE sensor_id='s1'", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
}

#[test]
fn unique_ble_mac_blocks_duplicate_sensor() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop(&c);
    c.execute(
        "INSERT INTO cold_chain_sensors (id, shop_id, ble_mac, label, min_safe_c, max_safe_c) \
         VALUES ('s1', 'shop_a', 'aa:bb:cc:dd:ee:01', 'F1', 2.0, 8.0)",
        [],
    ).unwrap();
    let r = c.execute(
        "INSERT INTO cold_chain_sensors (id, shop_id, ble_mac, label, min_safe_c, max_safe_c) \
         VALUES ('s2', 'shop_a', 'aa:bb:cc:dd:ee:01', 'F2', 2.0, 8.0)",
        [],
    );
    assert!(r.is_err(), "duplicate ble_mac must violate UNIQUE");
}

#[test]
fn excursion_open_then_close() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop(&c);
    c.execute(
        "INSERT INTO cold_chain_sensors (id, shop_id, ble_mac, label, min_safe_c, max_safe_c) \
         VALUES ('s1', 'shop_a', 'aa:bb:cc:dd:ee:01', 'F1', 2.0, 8.0)",
        [],
    ).unwrap();
    c.execute(
        "INSERT INTO cold_chain_excursions (sensor_id, excursion_start, max_temp_c, minutes_outside) \
         VALUES ('s1', '2026-04-29T10:00:00Z', 12.5, 30)",
        [],
    ).unwrap();
    let id: i64 = c.query_row("SELECT id FROM cold_chain_excursions WHERE sensor_id='s1'", [], |r| r.get(0)).unwrap();
    c.execute(
        "UPDATE cold_chain_excursions SET excursion_end = '2026-04-29T10:30:00Z', aefi_filed = 0 WHERE id = ?1",
        params![id],
    ).unwrap();
    let end: Option<String> = c.query_row("SELECT excursion_end FROM cold_chain_excursions WHERE id = ?1", params![id], |r| r.get(0)).unwrap();
    assert!(end.is_some());
}
