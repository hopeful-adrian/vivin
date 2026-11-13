use super::history::{self, HistoryReason};
use super::paths::{checked_document, checked_relative, relative_key};
use super::session::ProjectSession;
use crate::error::{AppError, AppResult};
use crate::metadata::ProjectData;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use tauri::State;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub(crate) path: String,
    pub(crate) content: String,
    pub(crate) revision: String,
}

pub(crate) fn revision(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

pub(crate) fn read_document_at(root: &Path, path: String) -> AppResult<Document> {
    let content = fs::read_to_string(checked_document(root, &path)?)?;
    Ok(Document {
        path,
        revision: revision(&content),
        content,
    })
}

/// Atomically replaces a document when the disk still matches `expected_revision`.
/// `snapshot` forces a history entry for the replaced content; ordinary saves are throttled.
pub(crate) fn save_document_unlocked(
    root: &Path,
    path: String,
    content: String,
    expected_revision: String,
    snapshot: Option<HistoryReason>,
) -> AppResult<Document> {
    let absolute = checked_document(root, &path)?;
    ProjectData::load(root)?.require_unlocked(&path)?;
    let current = fs::read_to_string(&absolute)?;
    if revision(&current) != expected_revision {
        return Err(AppError::conflict(
            "文档已被其他操作修改，请重新加载或另存为新文档",
        ));
    }

    let parent = absolute
        .parent()
        .ok_or_else(|| AppError::invalid_path("文档路径无效"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(content.as_bytes())?;
    temporary.as_file().sync_all()?;
    let latest = fs::read_to_string(&absolute)?;
    if revision(&latest) != expected_revision {
        return Err(AppError::conflict(
            "文档已被其他操作修改，请重新加载或另存为新文档",
        ));
    }
    if latest != content {
        let (reason, force) =
            snapshot.map_or((HistoryReason::Save, false), |reason| (reason, true));
        if let Err(error) = history::record(root, &path, &latest, reason, force) {
            log::warn!("history snapshot skipped for {path}: {error}");
        }
    }
    temporary.persist(&absolute)?;

    Ok(Document {
        path,
        revision: revision(&content),
        content,
    })
}

/// Builds `name（label）.md` next to `path`, adding a counter when the name is taken.
fn conflict_copy_path(root: &Path, path: &str, label: &str) -> AppResult<std::path::PathBuf> {
    let label = label.trim();
    if label.is_empty()
        || label.chars().count() > 64
        || label.starts_with('.')
        || label
            .chars()
            .any(|character| matches!(character, '/' | '\\' | ':' | '\0') || character.is_control())
    {
        return Err(AppError::invalid_input("冲突副本名称无效"));
    }
    let source = checked_document(root, path)?;
    let parent = source
        .parent()
        .ok_or_else(|| AppError::invalid_path("文档路径无效"))?;
    let stem = source
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    for attempt in 1..=99 {
        let suffix = if attempt == 1 {
            String::new()
        } else {
            format!(" {attempt}")
        };
        let candidate = parent.join(format!("{stem}（{label}{suffix}）.md"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(AppError::already_exists("冲突副本过多，请先整理同名文档"))
}

pub(crate) fn save_conflict_copy_unlocked(
    root: &Path,
    path: &str,
    content: &str,
    label: &str,
) -> AppResult<Document> {
    let target = conflict_copy_path(root, path, label)?;
    let relative = relative_key(root, &target)?;
    checked_relative(&relative)?;
    ProjectData::load(root)?.require_unlocked(&relative)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)?;
    file.write_all(content.as_bytes())?;
    file.sync_all()?;
    Ok(Document {
        path: relative,
        revision: revision(content),
        content: content.to_string(),
    })
}

impl ProjectSession {
    pub(crate) fn reload_document(&self, path: String) -> AppResult<Document> {
        let _guard = self.mutation_guard()?;
        let root = self.root()?;
        let document = read_document_at(&root, path)?;
        self.remove_draft(&document.path)?;
        Ok(document)
    }
}

#[tauri::command]
pub fn read_document(path: String, state: State<'_, ProjectSession>) -> AppResult<Document> {
    read_document_at(&state.root()?, path)
}

#[tauri::command]
pub fn read_document_revision(path: String, state: State<'_, ProjectSession>) -> AppResult<String> {
    let root = state.root()?;
    Ok(revision(&fs::read_to_string(checked_document(
        &root, &path,
    )?)?))
}

/// Revisions of several documents at once; missing or invalid paths map to `None`.
#[tauri::command]
pub fn read_document_revisions(
    paths: Vec<String>,
    state: State<'_, ProjectSession>,
) -> AppResult<HashMap<String, Option<String>>> {
    let root = state.root()?;
    Ok(paths
        .into_iter()
        .take(64)
        .map(|path| {
            let current = checked_document(&root, &path)
                .ok()
                .and_then(|file| fs::read_to_string(file).ok())
                .map(|content| revision(&content));
            (path, current)
        })
        .collect())
}

#[tauri::command]
pub fn save_document(
    path: String,
    content: String,
    expected_revision: String,
    snapshot: Option<HistoryReason>,
    state: State<'_, ProjectSession>,
) -> AppResult<Document> {
    let _guard = state.mutation_guard()?;
    let root = state.root()?;
    let saved = save_document_unlocked(
        &root,
        path.clone(),
        content.clone(),
        expected_revision,
        snapshot,
    )?;
    state.clear_draft_if(&path, &content)?;
    Ok(saved)
}

#[tauri::command]
pub fn reload_document(path: String, state: State<'_, ProjectSession>) -> AppResult<Document> {
    state.reload_document(path)
}

/// Preserves unsaved local edits as a sibling document before the disk version is loaded.
#[tauri::command]
pub fn save_conflict_copy(
    path: String,
    content: String,
    label: String,
    state: State<'_, ProjectSession>,
) -> AppResult<Document> {
    let _guard = state.mutation_guard()?;
    let root = state.root()?;
    save_conflict_copy_unlocked(&root, &path, &content, &label)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use crate::project::session::Draft;

    fn project() -> (tempfile::TempDir, std::path::PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        (temp, root)
    }

    #[test]
    fn external_reload_discards_stale_draft_and_rejects_stale_autosave() {
        let (_temp, root) = project();
        let session = ProjectSession::default();
        session.set_root(root.clone()).unwrap();
        fs::write(root.join("note.md"), "original").unwrap();
        let old_revision = revision("original");
        session.insert_draft_for_test(
            "note.md",
            Draft {
                content: "unsaved draft".to_string(),
                base_revision: old_revision.clone(),
            },
        );
        fs::write(root.join("note.md"), "changed on disk").unwrap();
        let stale = save_document_unlocked(
            &root,
            "note.md".to_string(),
            "stale autosave".to_string(),
            old_revision,
            None,
        )
        .unwrap_err();
        assert_eq!(stale.code, ErrorCode::RevisionConflict);
        let loaded = session.reload_document("note.md".to_string()).unwrap();
        assert_eq!(loaded.content, "changed on disk");
        assert!(session.draft("note.md").unwrap().is_none());
        assert!(
            session
                .reload_document("../outside.md".to_string())
                .is_err()
        );
    }

    #[test]
    fn locked_documents_cannot_be_saved() {
        let (_temp, root) = project();
        fs::write(root.join("note.md"), "original").unwrap();
        let mut data = ProjectData::load(&root).unwrap();
        data.locked.insert("note.md".to_string());
        data.save(&root).unwrap();
        let error = save_document_unlocked(
            &root,
            "note.md".to_string(),
            "edit".to_string(),
            revision("original"),
            None,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Locked);
    }

    #[test]
    fn conflict_copies_keep_local_text_beside_the_document() {
        let (_temp, root) = project();
        fs::create_dir(root.join("notes")).unwrap();
        fs::write(root.join("notes/a.md"), "disk").unwrap();
        let first = save_conflict_copy_unlocked(&root, "notes/a.md", "local", "冲突副本").unwrap();
        assert_eq!(first.path, "notes/a（冲突副本）.md");
        assert_eq!(fs::read_to_string(root.join(&first.path)).unwrap(), "local");
        let second = save_conflict_copy_unlocked(&root, "notes/a.md", "again", "冲突副本").unwrap();
        assert_eq!(second.path, "notes/a（冲突副本 2）.md");
        assert!(save_conflict_copy_unlocked(&root, "notes/a.md", "x", "../escape").is_err());
    }
}
