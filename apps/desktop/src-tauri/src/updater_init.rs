// updater_init.rs — wires tauri-plugin-updater into the app builder.
//
// S27.F, S28 (auto-update + signed MSI). Manifest schema lives in
// packages/auto-update/src/index.ts. Endpoint configured in tauri.conf.json
// under plugins.updater.endpoints.
//
// TODO(founder, follow-up commit): register `check_for_update_now` in
// main.rs invoke_handler — this file does NOT touch main.rs. Add the line:
//
//     .invoke_handler(tauri::generate_handler![..., crate::updater_init::check_for_update_now])
//
// And in the Builder chain, call: `.plugin(crate::updater_init::plugin())`

use serde::Serialize;
use tauri::{plugin::TauriPlugin, Runtime};
use tauri_plugin_updater::UpdaterExt;

/// Returned to the frontend by `check_for_update_now`.
#[derive(Debug, Serialize)]
pub struct UpdateStatus {
    pub has_update: bool,
    pub current: String,
    pub target: Option<String>,
    pub notes: Option<String>,
}

/// Build the updater plugin. Wire into `tauri::Builder::default().plugin(plugin())`.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_updater::Builder::new().build()
}

/// Tauri command — called from the React "Check for updates" button in Settings.
/// Returns the available update (if any) without auto-installing it.
#[tauri::command]
pub async fn check_for_update_now<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<UpdateStatus, String> {
    let current = app.package_info().version.to_string();
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => Ok(UpdateStatus {
            has_update: true,
            current,
            target: Some(update.version.clone()),
            notes: update.body.clone(),
        }),
        None => Ok(UpdateStatus {
            has_update: false,
            current,
            target: None,
            notes: None,
        }),
    }
}
