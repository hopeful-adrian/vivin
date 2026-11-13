use super::documents::{Document, revision};
use super::history;
use super::paths::{
    checked_directory, checked_document, checked_member, checked_name, is_markdown, relative_key,
    safe_project_directory,
};
use super::session::ProjectSession;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::metadata::ProjectData;
use std::fs::{self, OpenOptions};
use std::path::Path;
use tauri::State;
use uuid::Uuid;

pub(crate) fn create_document_in(root: &Path, directory: &str, name: &str) -> AppResult<Document> {
    let parent = checked_directory(root, directory)?;
    let file_name = checked_name(name)?;
    if !is_markdown(file_name) {
        return Err(AppError::invalid_input(
            "文档名称必须以 .md 结尾且不能包含路径",
        ));
    }
    let absolute = parent.join(file_name);
    let path = relative_key(root, &absolute)?;
    ProjectData::load(root)?.require_unlocked(&path)?;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&absolute)?;
    Ok(Document {
        path,
        content: String::new(),
        revision: revision(""),
    })
}

pub(crate) fn create_directory_in(root: &Path, directory: &str, name: &str) -> AppResult<String> {
    let parent = checked_directory(root, directory)?;
    let name_path = checked_name(name)?;
    let path = relative_key(root, &parent.join(name_path))?;
    ProjectData::load(root)?.require_unlocked(&path)?;
    fs::create_dir(parent.join(name_path))?;
    Ok(path)
}

pub(crate) fn move_entry_in(
    root: &Path,
    path: &str,
    destination_directory: &str,
    name: &str,
) -> AppResult<String> {
    let source = checked_member(root, path)?;
    let destination = checked_directory(root, destination_directory)?;
    if destination.starts_with(&source) {
        return Err(AppError::invalid_path("目标目录位于被移动目录之内"));
    }
    let name_path = checked_name(name)?;
    if source.is_file() && !is_markdown(name_path) {
        return Err(AppError::invalid_input("文档名称必须以 .md 结尾"));
    }
    let target = destination.join(name_path);
    if target.exists() {
        return Err(AppError::already_exists("目标路径已存在"));
    }
    let new_path = relative_key(root, &target)?;
    let mut data = ProjectData::load(root)?;
    data.require_unlocked(path)?;
    data.require_unlocked(&new_path)?;
    data.require_no_locked_descendants(path)?;
    data.remap_paths(path, &new_path);
    fs::rename(&source, &target)?;
    if let Err(error) = data.save(root) {
        let _ = fs::rename(&target, &source);
        return Err(error);
    }
    if let Err(error) = history::remap(root, path, &new_path) {
        log::warn!("history not moved from {path} to {new_path}: {error}");
    }
    Ok(new_path)
}

fn move_to_trash(path: &Path) -> AppResult<()> {
    #[allow(unused_mut)]
    let mut context = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        context.set_delete_method(DeleteMethod::NsFileManager);
    }
    context.delete(path).map_err(|error| {
        AppError::new(
            ErrorCode::TrashUnavailable,
            format!("无法移到回收站：{error}"),
        )
    })
}

fn remove_permanently(root: &Path, source: &Path) -> AppResult<()> {
    let staging = safe_project_directory(root, ".vivin/trash", true)?;
    let staged = staging.join(Uuid::new_v4().to_string());
    fs::rename(source, &staged)?;
    if staged.is_dir() {
        fs::remove_dir_all(staged)?;
    } else {
        fs::remove_file(staged)?;
    }
    Ok(())
}

/// Moves an entry to the system trash, or deletes it when `permanent` is set.
/// Pins, locks, annotations and term exceptions under the entry are removed;
/// version history is kept so a deleted document can still be recovered.
pub(crate) fn delete_entry_in(root: &Path, path: &str, permanent: bool) -> AppResult<()> {
    let source = checked_member(root, path)?;
    let previous = ProjectData::load(root)?;
    previous.require_unlocked(path)?;
    previous.require_no_locked_descendants(path)?;
    let mut data = previous.clone();
    data.remove_paths(path);
    data.save(root)?;
    let removed = if permanent {
        remove_permanently(root, &source)
    } else {
        move_to_trash(&source)
    };
    if let Err(error) = removed {
        previous.save(root)?;
        return Err(error);
    }
    Ok(())
}

pub(crate) fn set_pinned_in(root: &Path, path: &str, pinned: bool) -> AppResult<()> {
    checked_document(root, path)?;
    let mut data = ProjectData::load(root)?;
    data.require_unlocked(path)?;
    if pinned {
        data.pinned.insert(path.to_string());
    } else {
        data.pinned.remove(path);
    }
    data.save(root)
}

pub(crate) fn set_locked_in(root: &Path, path: &str, locked: bool) -> AppResult<()> {
    checked_member(root, path)?;
    let mut data = ProjectData::load(root)?;
    if !locked && data.lock_source(path).is_some_and(|source| source != path) {
        return Err(AppError::locked("该项目由上级目录锁定，请先解锁上级目录"));
    }
    if locked {
        data.locked.insert(path.to_string());
    } else {
        data.locked.remove(path);
    }
    data.save(root)
}

#[tauri::command]
pub fn create_document(
    directory: String,
    name: String,
    state: State<'_, ProjectSession>,
) -> AppResult<Document> {
    let _guard = state.mutation_guard()?;
    create_document_in(&state.root()?, &directory, &name)
}

#[tauri::command]
pub fn create_directory(
    directory: String,
    name: String,
    state: State<'_, ProjectSession>,
) -> AppResult<String> {
    let _guard = state.mutation_guard()?;
    create_directory_in(&state.root()?, &directory, &name)
}

#[tauri::command]
pub fn move_entry(
    path: String,
    destination_directory: String,
    name: String,
    state: State<'_, ProjectSession>,
) -> AppResult<String> {
    let _guard = state.mutation_guard()?;
    move_entry_in(&state.root()?, &path, &destination_directory, &name)
}

#[tauri::command]
pub fn delete_entry(
    path: String,
    permanent: Option<bool>,
    state: State<'_, ProjectSession>,
) -> AppResult<()> {
    let _guard = state.mutation_guard()?;
    delete_entry_in(&state.root()?, &path, permanent.unwrap_or(false))
}

#[tauri::command]
pub fn set_pinned(path: String, pinned: bool, state: State<'_, ProjectSession>) -> AppResult<()> {
    let _guard = state.mutation_guard()?;
    set_pinned_in(&state.root()?, &path, pinned)
}

#[tauri::command]
pub fn set_locked(path: String, locked: bool, state: State<'_, ProjectSession>) -> AppResult<()> {
    let _guard = state.mutation_guard()?;
    set_locked_in(&state.root()?, &path, locked)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metadata::{Annotation, AnnotationKind};

    fn project() -> (tempfile::TempDir, std::path::PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        (temp, root)
    }

    #[test]
    fn creates_documents_only_inside_the_project() {
        let (_temp, root) = project();
        assert_eq!(create_document_in(&root, "", "a.md").unwrap().path, "a.md");
        assert_eq!(
            create_document_in(&root, "", "a.md").unwrap_err().code,
            ErrorCode::AlreadyExists
        );
        assert!(create_document_in(&root, "", "../a.md").is_err());
        assert!(create_document_in(&root, "", "a.txt").is_err());
        assert_eq!(create_directory_in(&root, "", "notes").unwrap(), "notes");
        assert_eq!(
            create_document_in(&root, "notes", "b.md").unwrap().path,
            "notes/b.md"
        );
    }

    #[test]
    fn moving_keeps_metadata_and_respects_locks() {
        let (_temp, root) = project();
        fs::create_dir(root.join("drafts")).unwrap();
        fs::create_dir(root.join("archive")).unwrap();
        fs::write(root.join("drafts/a.md"), "text").unwrap();
        set_pinned_in(&root, "drafts/a.md", true).unwrap();
        history::record(
            &root,
            "drafts/a.md",
            "text",
            history::HistoryReason::Save,
            true,
        )
        .unwrap();
        assert_eq!(
            move_entry_in(&root, "drafts", "archive", "drafts").unwrap(),
            "archive/drafts"
        );
        let data = ProjectData::load(&root).unwrap();
        assert!(data.pinned.contains("archive/drafts/a.md"));
        assert_eq!(
            history::list(&root, "archive/drafts/a.md").unwrap().len(),
            1
        );

        set_locked_in(&root, "archive/drafts/a.md", true).unwrap();
        assert_eq!(
            move_entry_in(&root, "archive/drafts", "", "drafts")
                .unwrap_err()
                .code,
            ErrorCode::Locked
        );
        assert!(move_entry_in(&root, "archive", "archive/drafts", "x").is_err());
    }

    #[test]
    fn permanent_delete_removes_metadata_but_keeps_history() {
        let (_temp, root) = project();
        fs::write(root.join("a.md"), "quote").unwrap();
        let mut data = ProjectData::load(&root).unwrap();
        data.pinned.insert("a.md".to_string());
        data.annotations.push(Annotation {
            id: "1".to_string(),
            document: "a.md".to_string(),
            kind: AnnotationKind::Comment,
            quote: "quote".to_string(),
            context_before: String::new(),
            context_after: String::new(),
            offset: 0,
            note: String::new(),
        });
        data.save(&root).unwrap();
        history::record(&root, "a.md", "quote", history::HistoryReason::Save, true).unwrap();
        delete_entry_in(&root, "a.md", true).unwrap();
        assert!(!root.join("a.md").exists());
        let data = ProjectData::load(&root).unwrap();
        assert!(data.pinned.is_empty() && data.annotations.is_empty());
        assert_eq!(history::list(&root, "a.md").unwrap().len(), 1);
    }

    #[test]
    fn locked_entries_cannot_be_deleted() {
        let (_temp, root) = project();
        fs::create_dir(root.join("notes")).unwrap();
        fs::write(root.join("notes/a.md"), "text").unwrap();
        set_locked_in(&root, "notes/a.md", true).unwrap();
        assert_eq!(
            delete_entry_in(&root, "notes", true).unwrap_err().code,
            ErrorCode::Locked
        );
        assert!(root.join("notes/a.md").exists());
        set_locked_in(&root, "notes", true).unwrap();
        set_locked_in(&root, "notes/a.md", false).unwrap();
        assert_eq!(
            delete_entry_in(&root, "notes/a.md", true).unwrap_err().code,
            ErrorCode::Locked
        );
    }
}
