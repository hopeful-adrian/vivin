use super::paths::{
    checked_document, checked_member, checked_relative, is_markdown, relative_key,
    safe_project_directory,
};
use super::session::ProjectSession;
use crate::error::{AppError, AppResult};
use crate::metadata::ProjectData;
use base64::Engine;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

const MAX_IMAGE_BYTES: usize = 20_000_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenReferenceResult {
    kind: &'static str,
    path: Option<String>,
}

fn opener_error(error: impl std::fmt::Display) -> AppError {
    AppError::io(error.to_string())
}

#[tauri::command]
pub fn open_project_reference(
    source_document: String,
    target: String,
    state: State<'_, ProjectSession>,
    app: AppHandle,
) -> AppResult<OpenReferenceResult> {
    let root = state.root()?;
    let target = target.trim();
    if target.is_empty() || target.starts_with('#') {
        return Err(AppError::invalid_input("引用缺少可打开的文件路径"));
    }
    if target.starts_with("https://") || target.starts_with("http://") {
        app.opener()
            .open_url(target, None::<&str>)
            .map_err(opener_error)?;
        return Ok(OpenReferenceResult {
            kind: "external",
            path: None,
        });
    }
    if target.contains("://") || target.starts_with("javascript:") {
        return Err(AppError::unsupported("不支持的引用地址"));
    }
    let source = checked_document(&root, &source_document)?;
    let file_path = target.split(['#', '?']).next().unwrap_or_default();
    let candidate = source
        .parent()
        .ok_or_else(|| AppError::invalid_path("文档路径无效"))?
        .join(file_path);
    let canonical = fs::canonicalize(candidate)?;
    if !canonical.starts_with(&root) || !canonical.is_file() {
        return Err(AppError::invalid_path("引用文件不在当前项目内"));
    }
    let relative = relative_key(&root, &canonical)?;
    if is_markdown(&canonical) && !relative.starts_with("resources/") {
        checked_document(&root, &relative)?;
        Ok(OpenReferenceResult {
            kind: "document",
            path: Some(relative),
        })
    } else {
        app.opener()
            .open_path(canonical.to_string_lossy(), None::<&str>)
            .map_err(opener_error)?;
        Ok(OpenReferenceResult {
            kind: "external",
            path: None,
        })
    }
}

#[tauri::command]
pub fn open_project_resource(
    path: String,
    state: State<'_, ProjectSession>,
    app: AppHandle,
) -> AppResult<()> {
    let root = state.root()?;
    let relative = checked_relative(&path)?;
    if !path.starts_with("resources/") {
        return Err(AppError::invalid_path("只能打开资源库文件"));
    }
    let canonical = fs::canonicalize(root.join(relative))?;
    if !canonical.starts_with(&root) || !canonical.is_file() {
        return Err(AppError::invalid_path("资源文件不在当前项目内"));
    }
    app.opener()
        .open_path(canonical.to_string_lossy(), None::<&str>)
        .map_err(opener_error)
}

#[tauri::command]
pub fn reveal_project_entry(
    path: Option<String>,
    state: State<'_, ProjectSession>,
    app: AppHandle,
) -> AppResult<()> {
    let root = state.root()?;
    let target = match path {
        Some(path) => checked_member(&root, &path)?,
        None => root,
    };
    app.opener()
        .reveal_item_in_dir(target)
        .map_err(opener_error)
}

#[tauri::command]
pub fn import_resource(
    source: String,
    directory: String,
    state: State<'_, ProjectSession>,
) -> AppResult<String> {
    let _guard = state.mutation_guard()?;
    let root = state.root()?;
    let source = fs::canonicalize(source)?;
    if !source.is_file() {
        return Err(AppError::invalid_input("请选择资源文件"));
    }
    let resources = safe_project_directory(&root, "resources", true)?;
    let target_directory = if directory.is_empty() {
        resources.clone()
    } else {
        let resolved = fs::canonicalize(root.join(checked_relative(&directory)?))?;
        if !resolved.starts_with(&resources) || !resolved.is_dir() {
            return Err(AppError::invalid_path("资源目标目录无效"));
        }
        resolved
    };
    let name = source
        .file_name()
        .ok_or_else(|| AppError::invalid_input("资源文件名无效"))?;
    let target = target_directory.join(name);
    if target.exists() {
        return Err(AppError::already_exists("资源库中已有同名文件"));
    }
    fs::copy(source, &target)?;
    relative_key(&root, &target)
}

pub(crate) fn image_type(extension: &str) -> Option<&'static str> {
    match extension.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

#[tauri::command]
pub fn import_image(
    document: String,
    name: String,
    bytes_base64: String,
    state: State<'_, ProjectSession>,
) -> AppResult<String> {
    let _guard = state.mutation_guard()?;
    let root = state.root()?;
    checked_document(&root, &document)?;
    ProjectData::load(&root)?.require_unlocked(&document)?;
    let extension = Path::new(&name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if image_type(&extension).is_none() {
        return Err(AppError::unsupported("仅支持 PNG、JPEG、GIF 和 WebP 图片"));
    }
    if bytes_base64.len() > MAX_IMAGE_BYTES * 4 / 3 + 4 {
        return Err(AppError::invalid_input("图片不能超过 20 MB"));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_base64)
        .map_err(|_| AppError::invalid_input("图片数据无效"))?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(AppError::invalid_input("图片不能超过 20 MB"));
    }
    let folder = safe_project_directory(&root, "attachments", true)?;
    let filename = format!("{}.{}", Uuid::new_v4(), extension);
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(folder.join(&filename))?;
    output.write_all(&bytes)?;
    let depth = Path::new(&document)
        .parent()
        .map_or(0, |parent| parent.components().count());
    Ok(format!("{}attachments/{filename}", "../".repeat(depth)))
}

/// Reads an image referenced from `document` as a data URL, limited to the project.
pub(crate) fn project_image_data_url(
    root: &Path,
    document: &str,
    source: &str,
) -> AppResult<String> {
    let document_file = checked_document(root, document)?;
    let source_path = Path::new(source);
    if source_path.is_absolute()
        || source_path
            .components()
            .any(|part| !matches!(part, Component::Normal(_) | Component::ParentDir))
    {
        return Err(AppError::invalid_path("图片路径无效"));
    }
    let parent = document_file
        .parent()
        .ok_or_else(|| AppError::invalid_path("文档路径无效"))?;
    let absolute = fs::canonicalize(parent.join(source_path))?;
    if !absolute.starts_with(root) || !absolute.is_file() {
        return Err(AppError::invalid_path("图片不在当前项目中"));
    }
    let extension = absolute
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let mime = image_type(extension).ok_or_else(|| AppError::unsupported("图片格式不受支持"))?;
    let bytes = fs::read(absolute)?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(AppError::invalid_input("图片不能超过 20 MB"));
    }
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
pub fn read_project_image(
    document: String,
    source: String,
    state: State<'_, ProjectSession>,
) -> AppResult<String> {
    project_image_data_url(&state.root()?, &document, &source)
}
