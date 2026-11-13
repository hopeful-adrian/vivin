use crate::error::{AppError, AppResult};
use std::io::Write;
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const MAX_EXPORT_BYTES: usize = 100_000_000;

fn export_file_name(suggested: &str) -> String {
    let stem: String = suggested
        .trim()
        .trim_end_matches(".md")
        .chars()
        .filter(|character| {
            !matches!(character, '/' | '\\' | ':' | '\0') && !character.is_control()
        })
        .take(120)
        .collect();
    let stem = stem.trim_start_matches('.');
    if stem.is_empty() {
        "document.html".to_string()
    } else {
        format!("{stem}.html")
    }
}

/// Writes rendered HTML to a location the user picks in the system save dialog.
/// Returns `None` when the dialog is cancelled.
#[tauri::command]
pub async fn export_html(
    suggested_name: String,
    html: String,
    app: AppHandle,
) -> AppResult<Option<String>> {
    if html.len() > MAX_EXPORT_BYTES {
        return Err(AppError::invalid_input("导出内容过大"));
    }
    let Some(target) = app
        .dialog()
        .file()
        .add_filter("HTML", &["html", "htm"])
        .set_file_name(export_file_name(&suggested_name))
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = target
        .into_path()
        .map_err(|_| AppError::invalid_path("导出位置无效"))?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid_path("导出位置无效"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(html.as_bytes())?;
    temporary.as_file().sync_all()?;
    temporary.persist(&path)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Opens the system print panel for the main window; the page's print stylesheet
/// limits output to the document prepared for printing.
#[tauri::command]
pub fn print_document(window: WebviewWindow) -> AppResult<()> {
    window.print()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggests_safe_html_file_names() {
        assert_eq!(export_file_name("notes/章节.md"), "notes章节.html");
        assert_eq!(export_file_name(".hidden.md"), "hidden.html");
        assert_eq!(export_file_name("  "), "document.html");
    }
}
