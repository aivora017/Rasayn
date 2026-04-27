#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod commands;
mod cygnet;
mod db;
mod images;
mod oauth;
mod phash;
mod products;
#[cfg(test)]
mod products_perf;
mod returns;
mod telemetry;

use crate::db::{apply_migrations, default_db_path, open_local, DbState};
use std::sync::Mutex;

fn main() {
    // F6: LAN-only tracing sinks (stderr + local rolling file).
    // Cloud egress (Sentry) stays off unless opt-in + DSN are both set.
    let log_dir = telemetry::default_log_dir();
    if let Err(e) = telemetry::init(&log_dir) {
        eprintln!("telemetry init failed: {e}; falling back to stderr");
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::INFO)
            .init();
    }

    let path = default_db_path();
    let conn = open_local(&path).expect("open db");
    apply_migrations(&conn).expect("apply migrations");

    tauri::Builder::default()
        .manage(DbState(Mutex::new(conn)))
        .invoke_handler(tauri::generate_handler![
            commands::health_check,
            commands::db_version,
            commands::search_products,
            commands::pick_fefo_batch,
            commands::list_fefo_candidates,
            commands::save_bill,
            commands::list_payments_by_bill,
            commands::get_bill_full,
            commands::record_print,
            commands::generate_gstr1_payload,
            commands::save_gstr1_return,
            commands::list_gst_returns,
            commands::mark_gstr1_filed,
            commands::open_count_session,
            commands::record_count_line,
            commands::get_count_session,
            commands::finalize_count,
            commands::cancel_count_session,
            commands::list_count_sessions,
            commands::user_get,
            commands::record_expiry_override,
            commands::get_nearest_expiry,
            commands::list_stock,
            commands::save_grn,
            commands::day_book,
            commands::gstr1_summary,
            commands::top_movers,
            commands::search_customers,
            commands::upsert_customer,
            commands::search_doctors,
            commands::upsert_doctor,
            commands::create_prescription,
            commands::list_prescriptions,
            commands::list_suppliers,
            commands::list_supplier_templates,
            commands::upsert_supplier_template,
            commands::delete_supplier_template,
            commands::test_supplier_template,
            commands::shop_get,
            commands::shop_update,
            commands::db_backup,
            commands::db_restore,
            products::upsert_product,
            products::get_product,
            products::list_products,
            products::deactivate_product,
            images::attach_product_image,
            images::get_product_image,
            images::delete_product_image,
            images::list_products_missing_image,
            images::find_similar_images,
            images::get_duplicate_suspects,
            images::check_similar_images_for_bytes,
            oauth::gmail_connect,
            oauth::gmail_status,
            oauth::gmail_disconnect,
            oauth::gmail_list_messages,
            oauth::gmail_fetch_attachment,
            commands::generate_irn_payload,
            commands::submit_irn,
            commands::retry_irn,
            commands::cancel_irn,
            commands::list_irn_records,
            commands::get_irn_for_bill,
            returns::save_partial_return,
            returns::list_returns_for_bill,
            returns::get_refundable_qty,
            returns::record_credit_note_irn,
            returns::next_return_no,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
