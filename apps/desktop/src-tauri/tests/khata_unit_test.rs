//! Unit tests for src/khata.rs helpers and SQL paths (S24.1).
//!
//! Pairs with apps/desktop/src-tauri/tests/khata_test.rs (schema-level
//! constraints). This file targets the per-helper logic — fetch_limit /
//! upsert_limit / age_in_days / resolve_actor — by replicating the SQL
//! the runtime helpers issue against the same migration-built schema.
//! The runtime module pulls `crate::db::DbState` + tauri::State, so it
//! can't be #[path] included; the SQL is the testable surface.

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

fn seed(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) \
           VALUES ('shop_main', 'Test', '27ABCDE1234F1Z5', '27', 'RL-1', 'Kalyan');
         INSERT INTO users (id, shop_id, name, role, pin_hash) \
           VALUES ('u_owner', 'shop_main', 'Owner', 'owner', 'h');
         INSERT INTO customers (id, shop_id, name) \
           VALUES ('c1', 'shop_main', 'Asha Patil');",
    )
    .unwrap();
}

// ─── fetch_limit / upsert_limit (mirrors khata.rs helpers) ─────────────

fn fetch_limit(c: &Connection, customer_id: &str) -> Option<(i64, i64, f64)> {
    c.query_row(
        "SELECT credit_limit_paise, current_due_paise, default_risk_score \
         FROM khata_customer_limits WHERE customer_id = ?1",
        params![customer_id],
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, f64>(2)?,
            ))
        },
    )
    .ok()
}

fn upsert_limit(
    c: &Connection,
    customer_id: &str,
    credit_limit_paise: i64,
    current_due_paise: i64,
    default_risk_score: f64,
    updated_at: &str,
) {
    c.execute(
        "INSERT INTO khata_customer_limits \
            (customer_id, credit_limit_paise, current_due_paise, default_risk_score, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(customer_id) DO UPDATE SET \
            credit_limit_paise = excluded.credit_limit_paise, \
            current_due_paise  = excluded.current_due_paise, \
            default_risk_score = excluded.default_risk_score, \
            updated_at         = excluded.updated_at",
        params![
            customer_id,
            credit_limit_paise,
            current_due_paise,
            default_risk_score,
            updated_at,
        ],
    )
    .unwrap();
}

#[test]
fn fetch_limit_returns_none_for_unknown_customer() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);
    assert!(
        fetch_limit(&c, "no_such_customer").is_none(),
        "unknown customer must yield None"
    );
}

#[test]
fn upsert_limit_inserts_then_updates_same_row() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    // INSERT path.
    upsert_limit(&c, "c1", 100_000, 0, 0.10, "2026-05-01T00:00:00Z");
    let row1 = fetch_limit(&c, "c1").expect("row inserted");
    assert_eq!(row1.0, 100_000);
    assert_eq!(row1.1, 0);
    assert!((row1.2 - 0.10).abs() < 1e-9);

    // UPDATE path — same PK, mutated values.
    upsert_limit(&c, "c1", 200_000, 35_000, 0.42, "2026-05-02T00:00:00Z");
    let row2 = fetch_limit(&c, "c1").expect("row still present");
    assert_eq!(row2.0, 200_000, "credit_limit_paise must be updated");
    assert_eq!(row2.1, 35_000, "current_due_paise must be updated");
    assert!((row2.2 - 0.42).abs() < 1e-9);

    // Single-row invariant on customer_id PK.
    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM khata_customer_limits WHERE customer_id='c1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1, "ON CONFLICT must NOT create a duplicate row");
}

// ─── age_in_days (mirrors khata::age_in_days) ──────────────────────────
//
// The runtime helper uses chrono::DateTime::parse_from_rfc3339; chrono is
// not in dev-dependencies, and we can't pull it in (S24.1 forbids new deps).
// SQLite's julianday() gives identical day-resolution results, so we drive
// the same algorithm through a SELECT against the open in-memory DB.

fn age_in_days_via_sql(c: &Connection, iso: &str, now_iso: &str) -> i64 {
    let raw_days: f64 = c
        .query_row(
            "SELECT julianday(?1) - julianday(?2)",
            params![now_iso, iso],
            |r| r.get(0),
        )
        .unwrap();
    if raw_days <= 0.0 {
        0
    } else {
        raw_days.floor() as i64
    }
}

#[test]
fn age_in_days_matches_runtime_buckets() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);

    let now = "2026-05-05T12:00:00Z";
    // Same instant → 0.
    assert_eq!(age_in_days_via_sql(&c, now, now), 0);
    // 30 full days back → 30.
    assert_eq!(
        age_in_days_via_sql(&c, "2026-04-05T12:00:00Z", now),
        30,
        "30-day-old debit must land in the 30-bucket"
    );
    // 89 days back → 89 (still in 60–90 bucket).
    assert_eq!(age_in_days_via_sql(&c, "2026-02-05T12:00:00Z", now), 89);
    // 100 days back → 100 (90+ bucket).
    assert_eq!(age_in_days_via_sql(&c, "2026-01-25T12:00:00Z", now), 100);
}

#[test]
fn age_in_days_clamps_future_dates_to_zero() {
    // Mirrors `if diff <= 0 { 0 }` in khata::age_in_days — a clock-skewed
    // future-dated entry must NOT register as a negative-aged debit.
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);

    let now = "2026-05-05T12:00:00Z";
    let future = "2027-01-01T00:00:00Z";
    assert_eq!(age_in_days_via_sql(&c, future, now), 0);
}

// ─── resolve_actor (owner-by-customer-shop join) ────────────────────────

#[test]
fn resolve_actor_resolves_owner_via_customer_shop_join() {
    // Mirrors the first SELECT in khata::resolve_actor — pick the active
    // owner of the shop the customer belongs to.
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    let actor: String = c
        .query_row(
            "SELECT u.id FROM users u \
             JOIN customers cu ON cu.shop_id = u.shop_id \
             WHERE cu.id = ?1 AND u.is_active = 1 AND u.role = 'owner' \
             ORDER BY u.created_at LIMIT 1",
            params!["c1"],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(actor, "u_owner");
}

#[test]
fn resolve_actor_yields_no_row_when_customer_unknown() {
    // The runtime function falls back to "any active user", but the
    // primary join must miss for an unknown customer — that's the
    // first-step contract we're pinning here.
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed(&c);

    let res: Result<String, _> = c.query_row(
        "SELECT u.id FROM users u \
         JOIN customers cu ON cu.shop_id = u.shop_id \
         WHERE cu.id = ?1 AND u.is_active = 1 AND u.role = 'owner' \
         ORDER BY u.created_at LIMIT 1",
        params!["c_does_not_exist"],
        |r| r.get(0),
    );
    assert!(
        res.is_err(),
        "primary owner-via-shop join must miss for unknown customer"
    );
}
