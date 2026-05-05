//! Unit tests for src/cash_shift.rs helpers and SQL paths (S24.1).
//!
//! Pairs with apps/desktop/src-tauri/tests/cash_shift_test.rs (which covers
//! the schema constraints). This file targets the helper logic — denomination
//! totalling, find-open-shift query, and Z-report aggregation — by replicating
//! the pure helpers locally and exercising the SQL paths via the same
//! migration-built schema the runtime uses. The desktop crate is binary-only
//! and most cash_shift internals (`crate::db::DbState`) can't be #[path]
//! included without their tauri/State chain, so we mirror the algorithms.

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

fn seed_shop_and_user(c: &Connection) {
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address) \
           VALUES ('shop_main', 'Test Pharmacy', '27ABCDE1234F1Z5', '27', 'RL-123', 'Kalyan');
         INSERT INTO users (id, shop_id, name, role, pin_hash) \
           VALUES ('u_owner', 'shop_main', 'Owner', 'owner', 'hashed');",
    )
    .unwrap();
}

// ─── Denomination math (mirrors DenominationCountDto::total_paise) ──────

#[derive(Default)]
struct Denoms {
    d2000: i64,
    d500: i64,
    d200: i64,
    d100: i64,
    d50: i64,
    d20: i64,
    d10: i64,
    c5: i64,
    c2: i64,
    c1: i64,
}

fn total_paise(d: &Denoms) -> Result<i64, String> {
    let parts: [(i64, i64); 10] = [
        (d.d2000, 200_000),
        (d.d500, 50_000),
        (d.d200, 20_000),
        (d.d100, 10_000),
        (d.d50, 5_000),
        (d.d20, 2_000),
        (d.d10, 1_000),
        (d.c5, 500),
        (d.c2, 200),
        (d.c1, 100),
    ];
    let mut total: i64 = 0;
    for (count, face) in parts {
        if count < 0 {
            return Err(format!("INVALID_DENOMINATION_COUNT: {}", count));
        }
        total = total
            .checked_add(count.checked_mul(face).ok_or("DENOM_OVERFLOW")?)
            .ok_or("DENOM_TOTAL_OVERFLOW")?;
    }
    Ok(total)
}

#[test]
fn denomination_total_paise_for_known_drawer() {
    // 2 × ₹2000 + 5 × ₹500 + 10 × ₹100 + 4 × ₹1
    //   = 400000 + 250000 + 100000 + 400 = 750400 paise
    let d = Denoms {
        d2000: 2,
        d500: 5,
        d100: 10,
        c1: 4,
        ..Denoms::default()
    };
    assert_eq!(total_paise(&d).unwrap(), 750_400);
}

#[test]
fn denomination_total_paise_zero_drawer() {
    let d = Denoms::default();
    assert_eq!(total_paise(&d).unwrap(), 0);
}

#[test]
fn denomination_total_paise_rejects_negative_count() {
    let d = Denoms {
        d100: -1,
        ..Denoms::default()
    };
    let err = total_paise(&d).unwrap_err();
    assert!(
        err.contains("INVALID_DENOMINATION_COUNT"),
        "negative count must error, got: {err}"
    );
}

// ─── find_open_shift SQL path ───────────────────────────────────────────

fn find_open_shift_id(c: &Connection, shop_id: &str) -> Option<String> {
    c.query_row(
        "SELECT id FROM cash_shifts \
         WHERE shop_id = ?1 AND closed_at IS NULL \
         ORDER BY opened_at DESC LIMIT 1",
        params![shop_id],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

#[test]
fn find_open_shift_returns_none_when_empty() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_user(&c);

    assert!(find_open_shift_id(&c, "shop_main").is_none());
}

#[test]
fn find_open_shift_returns_latest_of_multiple_open_rows() {
    // Defence-in-depth: even if the partial-unique-on-open invariant were
    // somehow bypassed (e.g., legacy data import), find_open_shift's
    // ORDER BY opened_at DESC LIMIT 1 must surface the *latest* one so the
    // UI never shows a stale shift.
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_user(&c);

    c.execute_batch(
        "INSERT INTO cash_shifts (id, shop_id, opened_by_user_id, opened_at, opening_balance_paise, opening_denominations_json, closed_at) VALUES \
            ('s_old',    'shop_main', 'u_owner', '2026-04-29T09:00:00Z', 100000, '{}', '2026-04-29T21:00:00Z'),
            ('s_latest', 'shop_main', 'u_owner', '2026-04-30T09:00:00Z', 100000, '{}', NULL),
            ('s_older',  'shop_main', 'u_owner', '2026-04-15T09:00:00Z', 100000, '{}', NULL);"
    ).unwrap();

    let id = find_open_shift_id(&c, "shop_main").expect("an open shift exists");
    assert_eq!(
        id, "s_latest",
        "find_open_shift must return the most-recently-opened OPEN shift"
    );
}

// ─── Z-report aggregation paths ────────────────────────────────────────

fn seed_bills_and_payments(c: &Connection) {
    // Two bills inside the period; one voided (must be excluded).
    c.execute_batch(
        "INSERT INTO bills (id, shop_id, bill_no, billed_at, cashier_id, gst_treatment, \
            subtotal_paise, total_discount_paise, total_cgst_paise, total_sgst_paise, \
            total_igst_paise, total_cess_paise, round_off_paise, grand_total_paise, \
            payment_mode, is_voided) VALUES \
            ('b1', 'shop_main', 'INV-1', '2026-04-30T10:00:00Z', 'u_owner', 'intra_state', \
             100000, 0, 6000, 6000, 0, 0, 0, 100000, 'cash', 0),
            ('b2', 'shop_main', 'INV-2', '2026-04-30T11:00:00Z', 'u_owner', 'intra_state', \
             50000, 1000, 3000, 3000, 0, 0, 0, 50000, 'upi', 0),
            ('b_void', 'shop_main', 'INV-V', '2026-04-30T12:00:00Z', 'u_owner', 'intra_state', \
             99900, 0, 0, 0, 0, 0, 0, 99900, 'cash', 1);
         INSERT INTO payments (id, bill_id, mode, amount_paise) VALUES \
            ('p1', 'b1', 'cash', 100000),
            ('p2', 'b2', 'upi',  50000),
            ('p_void', 'b_void', 'cash', 99900);",
    )
    .unwrap();
}

#[test]
fn z_report_excludes_voided_bills_from_sales() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_user(&c);
    seed_bills_and_payments(&c);

    let (cnt, total): (i64, i64) = c
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(grand_total_paise), 0) \
             FROM bills \
             WHERE shop_id = ?1 AND is_voided = 0 \
               AND billed_at >= ?2 AND billed_at < ?3",
            params!["shop_main", "2026-04-30T09:00:00Z", "2026-04-30T23:59:59Z"],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(cnt, 2, "voided bill must be excluded from Z-report count");
    assert_eq!(
        total, 150000,
        "voided bill's grand_total must not appear in sales total"
    );
}

#[test]
fn z_report_tender_breakdown_groups_payments_by_mode() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_user(&c);
    seed_bills_and_payments(&c);

    let mut stmt = c
        .prepare(
            "SELECT p.mode, COALESCE(SUM(p.amount_paise), 0) \
             FROM payments p \
             JOIN bills b ON b.id = p.bill_id \
             WHERE b.shop_id = ?1 AND b.is_voided = 0 \
               AND b.billed_at >= ?2 AND b.billed_at < ?3 \
             GROUP BY p.mode \
             ORDER BY p.mode",
        )
        .unwrap();
    let rows: Vec<(String, i64)> = stmt
        .query_map(
            params!["shop_main", "2026-04-30T09:00:00Z", "2026-04-30T23:59:59Z"],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
        )
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        rows,
        vec![("cash".to_string(), 100000), ("upi".to_string(), 50000)]
    );
}

#[test]
fn z_report_no_bills_in_window_yields_zero_totals() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);
    seed_shop_and_user(&c);
    seed_bills_and_payments(&c);

    let (cnt, total): (i64, i64) = c
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(grand_total_paise), 0) \
             FROM bills \
             WHERE shop_id = ?1 AND is_voided = 0 \
               AND billed_at >= ?2 AND billed_at < ?3",
            params!["shop_main", "2099-01-01T00:00:00Z", "2099-12-31T23:59:59Z"],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(cnt, 0);
    assert_eq!(total, 0);
}

// ─── Variance threshold logic (mirrors cash_shift_close) ────────────────

const VARIANCE_NOISE_PAISE: i64 = 50;
const VARIANCE_APPROVAL_THRESHOLD_PAISE: i64 = 50_000;

fn final_variance_after_noise(raw: i64) -> i64 {
    if raw.abs() <= VARIANCE_NOISE_PAISE {
        0
    } else {
        raw
    }
}

#[test]
fn variance_under_noise_floor_is_silenced_to_zero() {
    assert_eq!(final_variance_after_noise(0), 0);
    assert_eq!(final_variance_after_noise(50), 0);
    assert_eq!(final_variance_after_noise(-50), 0);
    assert_eq!(final_variance_after_noise(51), 51);
    assert_eq!(final_variance_after_noise(-51), -51);
}

#[test]
fn variance_above_approval_threshold_requires_approval() {
    // Mirrors the guard inside cash_shift_close.
    let needs_approval = |variance: i64, approver: Option<&str>| -> Result<(), String> {
        if variance.abs() > VARIANCE_APPROVAL_THRESHOLD_PAISE && approver.is_none() {
            return Err(format!(
                "VARIANCE_REQUIRES_APPROVAL: {} paise (threshold {})",
                variance, VARIANCE_APPROVAL_THRESHOLD_PAISE
            ));
        }
        Ok(())
    };
    assert!(
        needs_approval(50_000, None).is_ok(),
        "exactly at threshold = ok"
    );
    assert!(
        needs_approval(50_001, None)
            .unwrap_err()
            .contains("VARIANCE_REQUIRES_APPROVAL"),
        "₹500.01 over expected must require manager approval"
    );
    assert!(
        needs_approval(50_001, Some("u_owner")).is_ok(),
        "approver supplied -> close proceeds"
    );
    assert!(
        needs_approval(-60_000, None)
            .unwrap_err()
            .contains("VARIANCE_REQUIRES_APPROVAL"),
        "negative variance > threshold must also require approval"
    );
}
