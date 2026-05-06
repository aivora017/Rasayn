//! S26.A — silent killer #1 — MockAdapter release-build gate.
//!
//! `apps/desktop/src-tauri/src/commands.rs` ships a `MockAdapter` that
//! fabricates IRN strings (`IRN_<bill_id>_<ts>`) and lets `submit_irn`
//! persist them into `irn_records`. If a release binary ever reached that
//! arm — via `shop.einvoice_vendor='mock'` or via fall-through when the
//! cygnet-live feature was off — the buyer would receive a fake IRN and
//! be unable to claim ITC. GST audit treats that as tax fraud.
//!
//! This file pins three invariants:
//!
//!   Test 1  in a `cargo test` build (`debug_assertions = on`,
//!           `cfg(test) = on`), the gate is permissive: the same logic
//!           the runtime uses to refuse "mock" returns "allowed" so that
//!           the existing IRN unit tests keep working.
//!   Test 2  in a simulated release build (`debug_assertions = off`),
//!           the gate refuses with the structured error code
//!           `MOCK_ADAPTER_NOT_ALLOWED_IN_RELEASE`. This mirrors the
//!           `if vendor == "mock" && !cfg!(debug_assertions)` branch in
//!           `submit_irn` in commands.rs.
//!   Test 3  when the gate trips, the code path returns BEFORE inserting
//!           into `irn_records`. We assert by running the same control
//!           flow against a freshly-migrated SQLite DB and counting rows.
//!
//! The desktop crate has no `[lib]` target, so we cannot import
//! `commands::submit_irn` directly. Instead, this file mirrors the gate
//! logic locally — same trick `cash_shift_unit_test.rs` uses for the
//! denomination math. The mirrored helper is intentionally a 4-line
//! function: it must NOT drift from the real one. If it does, the
//! follow-up sprint adds a doctest on `commands::submit_irn` that
//! re-asserts the same condition.

use rusqlite::{params, Connection};

/// Mirror of the gate condition in `submit_irn` (commands.rs ~line 4274).
/// `release_build` simulates `!cfg!(debug_assertions)` because the test
/// binary itself always has `debug_assertions = on`.
fn mock_gate_decision(vendor: &str, release_build: bool) -> Result<(), &'static str> {
    if vendor == "mock" && release_build {
        return Err("MOCK_ADAPTER_NOT_ALLOWED_IN_RELEASE");
    }
    Ok(())
}

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

fn count_irn_records(c: &Connection) -> i64 {
    c.query_row("SELECT COUNT(*) FROM irn_records", [], |r| r.get(0))
        .unwrap()
}

// ─── Test 1: debug/test build path stays permissive ─────────────────────

#[test]
fn mock_adapter_reachable_in_test_build() {
    // In a real test/debug build the MockAdapter must remain reachable —
    // otherwise the existing IRN unit + integration tests would break.
    // `release_build = false` simulates `cfg!(debug_assertions) == true`.
    let decision = mock_gate_decision("mock", false);
    assert!(
        decision.is_ok(),
        "test build must allow MockAdapter, got {decision:?}"
    );

    // Sanity: cygnet/cleartax are always allowed regardless of build.
    assert!(mock_gate_decision("cygnet", false).is_ok());
    assert!(mock_gate_decision("cleartax", false).is_ok());
    assert!(mock_gate_decision("cygnet", true).is_ok());
    assert!(mock_gate_decision("cleartax", true).is_ok());

    // Confirm the source file actually carries the cfg gate. This guards
    // against accidental removal of the `#[cfg(any(test, debug_assertions))]`
    // attribute on `pub struct MockAdapter`.
    let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/commands.rs"))
        .expect("read commands.rs");
    assert!(
        src.contains("#[cfg(any(test, debug_assertions))]\r\npub struct MockAdapter;")
            || src.contains("#[cfg(any(test, debug_assertions))]\npub struct MockAdapter;"),
        "MockAdapter must be cfg-gated behind any(test, debug_assertions)"
    );
}

// ─── Test 2: release build path refuses with structured error ───────────

#[test]
fn mock_adapter_refused_in_release_build() {
    // `release_build = true` simulates `!cfg!(debug_assertions)`.
    let decision = mock_gate_decision("mock", true);
    assert_eq!(
        decision,
        Err("MOCK_ADAPTER_NOT_ALLOWED_IN_RELEASE"),
        "release build must refuse vendor=mock with the structured error"
    );

    // The non-mock vendors must NOT be refused even in a release build.
    assert!(
        mock_gate_decision("cygnet", true).is_ok(),
        "cygnet must reach the live adapter in release"
    );
    assert!(
        mock_gate_decision("cleartax", true).is_ok(),
        "cleartax must reach the live adapter in release"
    );

    // Confirm the gate string lives in the source (catches a careless
    // rename of the error code which would silently break log greps and
    // dashboards downstream).
    let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/commands.rs"))
        .expect("read commands.rs");
    assert!(
        src.contains("MOCK_ADAPTER_NOT_ALLOWED_IN_RELEASE"),
        "the structured error code must appear verbatim in commands.rs"
    );
    assert!(
        src.contains("if vendor == \"mock\" && !cfg!(debug_assertions)"),
        "the runtime guard condition must appear verbatim in commands.rs"
    );
}

// ─── Test 3: gate trips BEFORE any irn_records row is written ───────────

#[test]
fn mock_gate_trip_does_not_persist_irn_record() {
    let c = Connection::open_in_memory().unwrap();
    apply_migrations_from_dir(&c);

    // Seed the minimum referenced rows so an INSERT into irn_records is
    // even possible. If the gate is honoured, the INSERT below must not
    // execute and the table stays empty.
    //
    // Note: shops.einvoice_vendor is constrained to ('cygnet', 'cleartax')
    // by 0016_a12_einvoice_irn.sql — 'mock' is only valid in irn_records.
    // The gate condition we are testing is on the *runtime* `vendor` value
    // (which can be passed via vendor_override), not the stored shop row,
    // so the seed vendor here is irrelevant to what we are pinning.
    c.execute_batch(
        "INSERT INTO shops (id, name, gstin, state_code, retail_license, address, \
                            einvoice_enabled, einvoice_vendor, annual_turnover_paise) \
           VALUES ('shop_main', 'Test', '27ABCDE1234F1Z5', '27', 'RL-1', 'Kalyan', \
                   1, 'cygnet', 6000000000);
         INSERT INTO users (id, shop_id, name, role, pin_hash) \
           VALUES ('u_owner', 'shop_main', 'Owner', 'owner', 'h');
         INSERT INTO bills (id, shop_id, bill_no, billed_at, cashier_id, gst_treatment, \
                            subtotal_paise, total_cgst_paise, total_sgst_paise, \
                            total_igst_paise, round_off_paise, grand_total_paise, \
                            payment_mode) \
           VALUES ('bill_1', 'shop_main', 'B-001', '2026-05-06T10:00:00Z', 'u_owner', \
                   'inter_state', 100000, 0, 0, 18000, 0, 118000, 'credit');",
    )
    .unwrap();

    assert_eq!(
        count_irn_records(&c),
        0,
        "precondition: irn_records starts empty"
    );

    // Simulated release build: gate trips, control flow returns Err
    // BEFORE the INSERT statement that submit_irn would otherwise issue.
    let vendor = "mock";
    let release_build = true;
    let result: Result<(), &'static str> = (|| {
        mock_gate_decision(vendor, release_build)?;

        // The lines below mirror what submit_irn does AFTER the gate. If
        // the gate failed to trip we would see them execute and a row
        // would land in irn_records — exactly the silent-killer regression
        // we are pinning against.
        c.execute(
            "INSERT INTO irn_records(\
                id, bill_id, shop_id, vendor, status, payload_json, \
                attempt_count, last_attempt_at, actor_user_id, created_at\
             ) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, 0, ?6, ?7, ?8)",
            params![
                "irn_should_not_exist",
                "bill_1",
                "shop_main",
                vendor,
                "{}",
                "2026-05-06T10:00:00Z",
                "u_owner",
                "2026-05-06T10:00:00Z",
            ],
        )
        .unwrap();
        Ok(())
    })();

    assert_eq!(
        result,
        Err("MOCK_ADAPTER_NOT_ALLOWED_IN_RELEASE"),
        "the simulated release path must short-circuit at the gate"
    );
    assert_eq!(
        count_irn_records(&c),
        0,
        "no irn_records row may be written when the release-build gate trips"
    );
}
