use super::documents::revision;
use super::paths::{checked_document, checked_name};
use super::watcher::ProjectWatcher;
use crate::error::{AppError, AppResult};
use crate::metadata::ProjectData;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, State};

#[derive(Default)]
pub struct ProjectSession {
    root: Mutex<Option<PathBuf>>,
    mutation: Mutex<()>,
    dirty: Mutex<bool>,
    drafts: Mutex<HashMap<String, Draft>>,
    draft_sequences: Mutex<HashMap<String, u64>>,
    watcher: Mutex<Option<ProjectWatcher>>,
}

#[derive(Clone)]
pub(crate) struct Draft {
    pub content: String,
    pub base_revision: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub(crate) name: String,
    pub(crate) path: String,
}

fn poisoned(label: &str) -> AppError {
    AppError::state(format!("{label}不可用"))
}

impl ProjectSession {
    pub(crate) fn root(&self) -> AppResult<PathBuf> {
        self.root
            .lock()
            .map_err(|_| poisoned("项目状态"))?
            .clone()
            .ok_or_else(|| AppError::new(crate::error::ErrorCode::NoProject, "尚未打开项目"))
    }

    pub(crate) fn mutation_guard(&self) -> AppResult<MutexGuard<'_, ()>> {
        self.mutation.lock().map_err(|_| poisoned("项目写入状态"))
    }

    pub(crate) fn set_root(&self, root: PathBuf) -> AppResult<()> {
        self.draft_sequences
            .lock()
            .map_err(|_| poisoned("草稿状态"))?
            .clear();
        self.drafts
            .lock()
            .map_err(|_| poisoned("草稿状态"))?
            .clear();
        *self.dirty.lock().map_err(|_| poisoned("编辑状态"))? = false;
        *self.root.lock().map_err(|_| poisoned("项目状态"))? = Some(root);
        Ok(())
    }

    /// Switches the active project and restarts file watching for it.
    pub(crate) fn activate(&self, app: &AppHandle, root: PathBuf) -> AppResult<ProjectInfo> {
        let info = project_info(&root);
        self.set_root(root.clone())?;
        let watcher = match ProjectWatcher::start(app.clone(), root) {
            Ok(watcher) => Some(watcher),
            Err(error) => {
                log::warn!("project watcher unavailable: {error}");
                None
            }
        };
        *self.watcher.lock().map_err(|_| poisoned("文件监听"))? = watcher;
        Ok(info)
    }

    pub(crate) fn set_dirty(&self, dirty: bool) -> AppResult<()> {
        *self.dirty.lock().map_err(|_| poisoned("编辑状态"))? = dirty;
        Ok(())
    }

    pub(crate) fn has_dirty_draft(&self) -> AppResult<bool> {
        Ok(*self.dirty.lock().map_err(|_| poisoned("编辑状态"))?
            || !self
                .drafts
                .lock()
                .map_err(|_| poisoned("草稿状态"))?
                .is_empty())
    }

    pub(crate) fn draft(&self, path: &str) -> AppResult<Option<Draft>> {
        Ok(self
            .drafts
            .lock()
            .map_err(|_| poisoned("草稿状态"))?
            .get(path)
            .cloned())
    }

    pub(crate) fn clear_draft_if(&self, path: &str, content: &str) -> AppResult<()> {
        let mut drafts = self.drafts.lock().map_err(|_| poisoned("草稿状态"))?;
        if drafts
            .get(path)
            .is_some_and(|draft| draft.content == content)
        {
            drafts.remove(path);
        }
        Ok(())
    }

    pub(crate) fn remove_draft(&self, path: &str) -> AppResult<()> {
        self.drafts
            .lock()
            .map_err(|_| poisoned("草稿状态"))?
            .remove(path);
        Ok(())
    }

    pub(crate) fn has_draft_under(&self, path: &str) -> AppResult<bool> {
        Ok(self
            .drafts
            .lock()
            .map_err(|_| poisoned("草稿状态"))?
            .keys()
            .any(|candidate| candidate == path || candidate.starts_with(&format!("{path}/"))))
    }

    /// Records the latest unsaved editor content so AI tools see what the user sees.
    /// Out-of-order publishes are ignored by sequence number.
    pub(crate) fn publish_draft(
        &self,
        path: String,
        content: String,
        base_revision: String,
        sequence: u64,
    ) -> AppResult<String> {
        let _guard = self.mutation_guard()?;
        let mut sequences = self
            .draft_sequences
            .lock()
            .map_err(|_| poisoned("草稿状态"))?;
        if sequences
            .get(&path)
            .is_some_and(|previous| *previous >= sequence)
        {
            return Ok(self
                .draft(&path)?
                .map_or_else(|| base_revision.clone(), |draft| revision(&draft.content)));
        }
        sequences.insert(path.clone(), sequence);
        let root = self.root()?;
        let file = checked_document(&root, &path)?;
        ProjectData::load(&root)?.require_unlocked(&path)?;
        let disk = fs::read_to_string(file)?;
        if revision(&disk) != base_revision {
            if disk == content {
                self.remove_draft(&path)?;
                return Ok(revision(&content));
            }
            return Err(AppError::conflict("磁盘文档已改变，请先处理冲突"));
        }
        let mut drafts = self.drafts.lock().map_err(|_| poisoned("草稿状态"))?;
        if content == disk {
            drafts.remove(&path);
        } else {
            drafts.insert(
                path,
                Draft {
                    content: content.clone(),
                    base_revision,
                },
            );
        }
        Ok(revision(&content))
    }

    /// Current text of a document as the user sees it: the unsaved draft when it is
    /// based on the disk version, otherwise the disk content.
    pub(crate) fn current_content(&self, root: &Path, path: &str) -> AppResult<String> {
        let file = checked_document(root, path)?;
        let disk = fs::read_to_string(file)?;
        match self.draft(path)? {
            Some(draft) if revision(&disk) != draft.base_revision => Err(AppError::conflict(
                "文档在草稿编辑期间发生外部修改，请先在 vivin 中处理冲突",
            )),
            Some(draft) => Ok(draft.content),
            None => Ok(disk),
        }
    }
}

pub(crate) fn project_info(root: &Path) -> ProjectInfo {
    ProjectInfo {
        name: root.file_name().map_or_else(
            || root.to_string_lossy().into_owned(),
            |name| name.to_string_lossy().into_owned(),
        ),
        path: root.to_string_lossy().into_owned(),
    }
}

pub(crate) fn resolve_project_root(path: &str) -> AppResult<PathBuf> {
    let root = fs::canonicalize(path)?;
    if !root.is_dir() {
        return Err(AppError::invalid_path("请选择项目文件夹"));
    }
    ProjectData::load(&root)?;
    Ok(root)
}

pub(crate) fn create_project_root(parent: &str, name: &str) -> AppResult<PathBuf> {
    let parent = fs::canonicalize(parent)?;
    if !parent.is_dir() {
        return Err(AppError::invalid_path("请选择用于存放项目的文件夹"));
    }
    let name_path = checked_name(name)
        .map_err(|_| AppError::invalid_input("项目名称不能包含路径或以点开头"))?;
    let root = parent.join(name_path);
    fs::create_dir(&root)?;
    if let Err(error) = fs::create_dir(root.join("resources")) {
        let _ = fs::remove_dir_all(&root);
        return Err(error.into());
    }
    Ok(fs::canonicalize(root)?)
}

#[tauri::command]
pub fn open_project(
    path: String,
    state: State<'_, ProjectSession>,
    app: AppHandle,
) -> AppResult<ProjectInfo> {
    let _guard = state.mutation_guard()?;
    let root = resolve_project_root(&path)?;
    state.activate(&app, root)
}

#[tauri::command]
pub fn create_project(
    parent: String,
    name: String,
    state: State<'_, ProjectSession>,
    app: AppHandle,
) -> AppResult<ProjectInfo> {
    let _guard = state.mutation_guard()?;
    let root = create_project_root(&parent, &name)?;
    state.activate(&app, root)
}

#[tauri::command]
pub fn set_dirty_draft(dirty: bool, state: State<'_, ProjectSession>) -> AppResult<()> {
    state.set_dirty(dirty)
}

#[tauri::command]
pub fn publish_draft(
    path: String,
    content: String,
    base_revision: String,
    sequence: u64,
    state: State<'_, ProjectSession>,
) -> AppResult<String> {
    state.publish_draft(path, content, base_revision, sequence)
}

#[tauri::command]
pub fn get_platform() -> &'static str {
    std::env::consts::OS
}

#[cfg(test)]
impl ProjectSession {
    pub(crate) fn insert_draft_for_test(&self, path: &str, draft: Draft) {
        self.drafts.lock().unwrap().insert(path.to_string(), draft);
    }
}
