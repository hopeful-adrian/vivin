use crate::error::{AppError, AppResult};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const RELEASES_URL: &str = "https://github.com/hopeful-adrian/vivin/releases";

#[tauri::command]
pub fn open_log_directory(app: AppHandle) -> AppResult<()> {
    let directory = app.path().app_log_dir()?;
    std::fs::create_dir_all(&directory)?;
    app.opener()
        .open_path(directory.to_string_lossy(), None::<&str>)
        .map_err(|error| AppError::io(error.to_string()))
}

#[tauri::command]
pub fn open_release_page(url: String, app: AppHandle) -> AppResult<()> {
    if url != RELEASES_URL && !url.starts_with(&format!("{RELEASES_URL}/")) {
        return Err(AppError::invalid_input("只能打开 vivin 的发布页面"));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| AppError::io(error.to_string()))
}

/// Connection details for local AI clients, shown in Settings.
#[tauri::command]
pub fn bridge_info(app: AppHandle) -> AppResult<serde_json::Value> {
    let path = app.path().app_config_dir()?.join("bridge.json");
    Ok(serde_json::json!({
        "url": crate::ai::url(),
        "configPath": path.to_string_lossy(),
    }))
}
