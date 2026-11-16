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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
    family: String,
    localized: Option<String>,
}

/// Installed font family names for the text font setting; file paths are never returned.
#[tauri::command]
pub async fn list_system_fonts() -> AppResult<Vec<FontFamily>> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut database = fontdb::Database::new();
        database.load_system_fonts();
        let mut families = std::collections::BTreeMap::<String, Option<String>>::new();
        for face in database.faces() {
            let Some((family, _)) = face.families.first() else {
                continue;
            };
            if family.is_empty() || family.starts_with('.') {
                continue;
            }
            let chinese_name = |simplified: bool| {
                face.families
                    .iter()
                    .find(|(name, language)| {
                        name != family
                            && if simplified {
                                matches!(
                                    language,
                                    fontdb::Language::Chinese_PeoplesRepublicOfChina
                                        | fontdb::Language::Chinese_Singapore
                                )
                            } else {
                                matches!(
                                    language,
                                    fontdb::Language::Chinese_Taiwan
                                        | fontdb::Language::Chinese_HongKongSAR
                                        | fontdb::Language::Chinese_MacaoSAR
                                )
                            }
                    })
                    .map(|(name, _)| name.clone())
            };
            let localized = chinese_name(true).or_else(|| chinese_name(false));
            let entry = families.entry(family.clone()).or_default();
            if entry.is_none() {
                *entry = localized;
            }
        }
        families
            .into_iter()
            .map(|(family, localized)| FontFamily { family, localized })
            .collect()
    })
    .await
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
