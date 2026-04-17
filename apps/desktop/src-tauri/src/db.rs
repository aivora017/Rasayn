// Shared DB runtime. Owns a Mutex<Connection> via tauri::State.

use anyhow::Result;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

pub fn default_db_path() -> PathBuf {
    // Windows: %APPDATA%\PharmaCarePro\pharmacare.db
    // macOS:   ~/Library/Application Support/PharmaCarePro/pharmacare.db
    // Linux:   ~/.local/share/PharmaCarePro/pharmacare.db
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("PharmaCarePro");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("pharmacare.db")
}

pub fn open_local(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
    )?;
    Ok(conn)
}

pub const MIGRATION_0001: &str =
    include_str!("../../../../packages/shared-db/migrations/0001_init.sql");
pub const MIGRATION_0002: &str =
    include_str!("../../../../packages/shared-db/migrations/0002_fts5_products.sql");
pub const MIGRATION_0003: &str =
    include_str!("../../../../packages/shared-db/migrations/0003_grns_header.sql");
pub const MIGRATION_0004: &str =
    include_str!("../../../../packages/shared-db/migrations/0004_supplier_templates.sql");
pub const MIGRATION_0005: &str =
    include_str!("../../../../packages/shared-db/migrations/0005_oauth_and_audit.sql");
pub const MIGRATION_0006: &str =
    include_str!("../../../../packages/shared-db/migrations/0006_products_nppa_cap.sql");
pub const MIGRATION_0007: &str =
    include_str!("../../../../packages/shared-db/migrations/0007_a2_batch_stock.sql");
pub const MIGRATION_0008: &str =
    include_str!("../../../../packages/shared-db/migrations/0008_hsn_prefix.sql");
pub const MIGRATION_0009: &str =
    include_str!("../../../../packages/shared-db/migrations/0009_a3_customer_master.sql");
pub const MIGRATION_0010: &str =
    include_str!("../../../../packages/shared-db/migrations/0010_payments.sql");
pub const MIGRATION_0011: &str =
    include_str!("../../../../packages/shared-db/migrations/0011_expiry_override_audit.sql");
pub const MIGRATION_0012: &str =
    include_str!("../../../../packages/shared-db/migrations/0012_rx_records.sql");
pub const MIGRATION_0013: &str =
    include_str!("../../../../packages/shared-db/migrations/0013_print_audit.sql");
pub const MIGRATION_0014: &str =
    include_str!("../../../../packages/shared-db/migrations/0014_gstr1_returns.sql");
pub const MIGRATION_0015: &str =
    include_str!("../../../../packages/shared-db/migrations/0015_a11_stock_reconcile.sql");
pub const MIGRATION_0016: &str =
    include_str!("../../../../packages/shared-db/migrations/0016_a12_einvoice_irn.sql");
pub const MIGRATION_0017: &str =
    include_str!("../../../../packages/shared-db/migrations/0017_x2_product_images.sql");
pub const MIGRATION_0018: &str =
    include_str!("../../../../packages/shared-db/migrations/0018_x2b_phash.sql");

pub fn apply_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );",
    )?;
    let applied = |v: i64, c: &Connection| -> bool {
        c.query_row(
            "SELECT COUNT(*) FROM _migrations WHERE version = ?1",
            [v],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
            > 0
    };
    if !applied(1, conn) {
        conn.execute_batch(MIGRATION_0001)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (1, '0001_init')",
            [],
        )?;
    }
    if !applied(2, conn) {
        conn.execute_batch(MIGRATION_0002)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (2, '0002_fts5_products')",
            [],
        )?;
    }
    if !applied(3, conn) {
        conn.execute_batch(MIGRATION_0003)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (3, '0003_grns_header')",
            [],
        )?;
    }
    if !applied(4, conn) {
        conn.execute_batch(MIGRATION_0004)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (4, '0004_supplier_templates')",
            [],
        )?;
    }
    if !applied(5, conn) {
        conn.execute_batch(MIGRATION_0005)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (5, '0005_oauth_and_audit')",
            [],
        )?;
    }
    if !applied(6, conn) {
        conn.execute_batch(MIGRATION_0006)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (6, '0006_products_nppa_cap')",
            [],
        )?;
    }
    if !applied(7, conn) {
        conn.execute_batch(MIGRATION_0007)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (7, '0007_a2_batch_stock')",
            [],
        )?;
    }
    if !applied(8, conn) {
        conn.execute_batch(MIGRATION_0008)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (8, '0008_hsn_prefix')",
            [],
        )?;
    }
    if !applied(9, conn) {
        conn.execute_batch(MIGRATION_0009)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (9, '0009_a3_customer_master')",
            [],
        )?;
    }
    if !applied(10, conn) {
        conn.execute_batch(MIGRATION_0010)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (10, '0010_payments')",
            [],
        )?;
    }
    if !applied(11, conn) {
        conn.execute_batch(MIGRATION_0011)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (11, '0011_expiry_override_audit')",
            [],
        )?;
    }
    if !applied(12, conn) {
        conn.execute_batch(MIGRATION_0012)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (12, '0012_rx_records')",
            [],
        )?;
    }
    if !applied(13, conn) {
        conn.execute_batch(MIGRATION_0013)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (13, '0013_print_audit')",
            [],
        )?;
    }
    if !applied(14, conn) {
        conn.execute_batch(MIGRATION_0014)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (14, '0014_gstr1_returns')",
            [],
        )?;
    }
    if !applied(15, conn) {
        conn.execute_batch(MIGRATION_0015)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (15, '0015_a11_stock_reconcile')",
            [],
        )?;
    }
    if !applied(16, conn) {
        conn.execute_batch(MIGRATION_0016)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (16, '0016_a12_einvoice_irn')",
            [],
        )?;
    }
    if !applied(17, conn) {
        conn.execute_batch(MIGRATION_0017)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (17, '0017_x2_product_images')",
            [],
        )?;
    }
    if !applied(18, conn) {
        conn.execute_batch(MIGRATION_0018)?;
        conn.execute(
            "INSERT INTO _migrations (version, name) VALUES (18, '0018_x2b_phash')",
            [],
        )?;
    }
    ensure_default_shop(conn)?;
    ensure_default_user(conn)?;
    Ok(())
}

/// Seed a default owner user `user_sourav_owner` on fresh installs.
/// A13 (expiry override) needs a known-role actor to gate owner-only overrides.
/// Pilot deployments are single-user (owner), so this is enough; multi-staff
/// deployments add users via an admin screen (future).
///
/// Idempotent: only inserts when `users` is empty.
pub fn ensure_default_user(conn: &Connection) -> Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
    if count == 0 {
        conn.execute(
            "INSERT INTO users (id, shop_id, name, role, pin_hash, is_active)
             VALUES ('user_sourav_owner', 'shop_local', 'Owner', 'owner', 'seed-no-pin', 1)",
            [],
        )?;
    }
    Ok(())
}

/// Seed a `shop_local` row on fresh installs so FK-bearing tables
/// (oauth_accounts, users, products, etc.) don't crash before the owner
/// has completed first-run setup. The owner overwrites name/gstin/license
/// from the Settings UI on first launch. Values here are placeholders that
/// pass the CHECK constraints (gstin length=15, state_code length=2).
///
/// This is idempotent: only runs when `shops` is empty. Fixes blocker B11
/// in AUDIT_REPORT_2026-04-15.md — the OAuth `gmail_connect` flow inserts
/// into `oauth_accounts(shop_id)` which REFERENCES `shops(id)`.
pub fn ensure_default_shop(conn: &Connection) -> Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM shops", [], |r| r.get(0))?;
    if count == 0 {
        conn.execute(
            "INSERT INTO shops (id, name, gstin, state_code, retail_license, address)
             VALUES ('shop_local', 'My Pharmacy', '00AAAAA0000A0Z0', '00', 'PENDING', 'Please set address in Settings')",
            [],
        )?;
    }
    Ok(())
}
