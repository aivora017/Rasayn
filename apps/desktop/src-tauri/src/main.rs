#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod backup_scheduler;
mod cash_shift;
mod cleartax;
#[cfg(feature = "cleartax-live")]
mod cleartax_wire;
mod commands;
mod cygnet;
#[cfg(feature = "cygnet-live")]
mod cygnet_wire;
mod db;
mod idempotency;
mod images;
mod khata;
mod license;
mod oauth;
mod phash;
mod photo_grn;
mod printer;
mod product_ingredients;
mod products;
#[cfg(test)]
mod products_perf;
mod rbac;
mod returns;
mod stock_transfer;
mod telemetry;
mod whatsapp;

use crate::db::{apply_migrations, default_db_path, open_local, DbState};

fn main() {
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

    let shared = std::sync::Arc::new(std::sync::Mutex::new(conn));
    let _backup_handle = backup_scheduler::start_auto_backup_loop(shared.clone());

    tauri::Builder::default()
        .manage(DbState(shared))
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
            cash_shift::cash_shift_find_open,
            cash_shift::cash_shift_open,
            cash_shift::cash_shift_close,
            cash_shift::cash_shift_z_report,
            khata::khata_list_entries,
            khata::khata_get_limit,
            khata::khata_set_limit,
            khata::khata_aging,
            khata::khata_record_purchase,
            khata::khata_record_payment,
            rbac::rbac_list_users,
            rbac::rbac_set_role,
            rbac::rbac_list_overrides,
            rbac::rbac_upsert_override,
            rbac::rbac_delete_override,
            printer::printer_list,
            printer::printer_write_bytes,
            printer::printer_test,
            photo_grn::photo_grn_run,
            stock_transfer::stock_transfer_list,
            stock_transfer::stock_transfer_create,
            stock_transfer::stock_transfer_dispatch,
            stock_transfer::stock_transfer_receive,
            stock_transfer::stock_transfer_cancel,
            stock_transfer::stock_transfer_list_lines,
            product_ingredients::product_ingredients_list_for_products,
            product_ingredients::product_ingredients_upsert,
            product_ingredients::product_ingredients_delete,
            license::license_save,
            license::license_get,
            license::license_clear,
            whatsapp::whatsapp_enqueue,
            whatsapp::whatsapp_list,
            whatsapp::whatsapp_mark_sent,
            whatsapp::whatsapp_mark_failed,
            whatsapp::whatsapp_mark_delivered,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
