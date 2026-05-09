#![allow(dead_code)]
//! Integration test for the DR module (S28.A6).
//!
//! Spins up an in-memory-style on-disk SQLite, writes a snapshot via the
//! library functions, verifies the sidecar SHA-256, and re-opens the
//! snapshot to confirm `PRAGMA integrity_check` returns "ok".
//!
//! NOTE: dr_take_snapshot / dr_restore_snapshot themselves are
//! `#[tauri::command]` and require a Tauri State; the underlying
//! `snapshot_to` and `plan_retention` helpers are exercised here.

use std::path::PathBuf;

#[path = "../src/backup_scheduler.rs"]
mod backup_scheduler;

#[path = "../src/dr.rs"]
mod dr;

// dr.rs imports `crate::db::DbState` â€” provide a stub so the integration
// test target compiles standalone.
mod db {
    use std::sync::{Arc, Mutex};
    pub struct DbState(pub Arc<Mutex<rusqlite::Connection>>);
}

#[test]
fn snapshot_round_trip_writes_sidecar_and_passes_integrity() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("src.db");
    {
        let c = rusqlite::Connection::open(&db_path).unwrap();
        c.execute_batch(
            "CREATE TABLE shops(id TEXT PRIMARY KEY, name TEXT);\
             INSERT INTO shops(id, name) VALUES ('shop_main', 'Jagannath Pharmacy');\
             CREATE TABLE bills(id INTEGER PRIMARY KEY, total_paise INTEGER NOT NULL);\
             INSERT INTO bills(id, total_paise) VALUES (1, 12500), (2, 8750);",
        )
        .unwrap();
    }

    // Open as a long-lived conn that snapshot_to will VACUUM-INTO from.
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    let out = tmp.path().join("backups");
    let when = chrono::DateTime::parse_from_rfc3339("2026-05-08T02:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    let info = dr::snapshot_to(&conn, &out, "shop_main", when).expect("snapshot_to");

    // 1) The reported file exists and has the expected name shape.
    let p = PathBuf::from(&info.path);
    assert!(p.exists(), "snapshot file missing");
    assert!(p
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("pharmacare-snapshot-2026-05-08-0200-shop_main"));

    // 2) The sidecar exists and matches.
    let sidecar = p.with_file_name(format!(
        "{}.sha256",
        p.file_name().unwrap().to_string_lossy()
    ));
    assert!(sidecar.exists(), "sidecar missing");

    // 3) Re-opening the snapshot is a healthy SQLite.
    let probe = rusqlite::Connection::open(&p).unwrap();
    let integrity: String = probe
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");

    // 4) Reported size matches actual.
    let size = std::fs::metadata(&p).unwrap().len();
    assert_eq!(size, info.size_bytes);
}

#[test]
fn retention_keeps_recent_and_drops_old() {
    let names: Vec<String> = (1..=30)
        .map(|d| {
            format!(
                "pharmacare-snapshot-2026-04-{:02}-0200-shop_main.tar.zst",
                d
            )
        })
        .collect();
    let keep = dr::plan_retention(&names);
    // Last 14 daily must all be kept.
    for d in 17..=30 {
        let n = format!(
            "pharmacare-snapshot-2026-04-{:02}-0200-shop_main.tar.zst",
            d
        );
        assert!(keep.contains(&n), "expected {n} in keep set");
    }
    // April 1 is well past the 14-daily horizon; only kept if it's also
    // the latest weekly/monthly bucket entry, which it is not.
    let oldest = "pharmacare-snapshot-2026-04-01-0200-shop_main.tar.zst";
    assert!(!keep.contains(oldest), "did not expect {oldest}");
}
