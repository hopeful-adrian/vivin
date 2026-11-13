use super::documents::revision;
use super::paths::{checked_relative, is_markdown, safe_project_directory};
use super::session::ProjectSession;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use uuid::Uuid;

const MIN_INTERVAL_MS: u64 = 10 * 60 * 1000;
const MAX_PER_DOCUMENT: usize = 50;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HistoryReason {
    Save,
    Format,
    Restore,
    Ai,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub created_at: u64,
    pub size: usize,
    pub reason: HistoryReason,
    pub revision: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryIndex {
    #[serde(default)]
    documents: BTreeMap<String, Vec<HistoryEntry>>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}

fn directory(root: &Path, create: bool) -> AppResult<PathBuf> {
    safe_project_directory(root, ".vivin/history", create)
}

fn load_index(directory: &Path) -> AppResult<HistoryIndex> {
    let path = directory.join("index.json");
    if !path.exists() {
        return Ok(HistoryIndex::default());
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn save_index(directory: &Path, index: &HistoryIndex) -> AppResult<()> {
    let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
    serde_json::to_writer_pretty(&mut temporary, index)?;
    temporary.write_all(b"\n")?;
    temporary.as_file().sync_all()?;
    temporary.persist(directory.join("index.json"))?;
    Ok(())
}

fn checked_document_key(path: &str) -> AppResult<()> {
    if !is_markdown(checked_relative(path)?) {
        return Err(AppError::unsupported("只有 Markdown 文档有版本历史"));
    }
    Ok(())
}

/// Stores `content` as the newest version of `path`. Unforced snapshots are skipped
/// within ten minutes of the previous one; identical or blank content is never stored.
pub(crate) fn record(
    root: &Path,
    path: &str,
    content: &str,
    reason: HistoryReason,
    force: bool,
) -> AppResult<bool> {
    record_at(root, path, content, reason, force, now_ms())
}

fn record_at(
    root: &Path,
    path: &str,
    content: &str,
    reason: HistoryReason,
    force: bool,
    now: u64,
) -> AppResult<bool> {
    checked_document_key(path)?;
    if content.trim().is_empty() {
        return Ok(false);
    }
    let directory = directory(root, true)?;
    let mut index = load_index(&directory)?;
    let entries = index.documents.entry(path.to_string()).or_default();
    let content_revision = revision(content);
    if let Some(latest) = entries.last()
        && (latest.revision == content_revision
            || (!force && now.saturating_sub(latest.created_at) < MIN_INTERVAL_MS))
    {
        return Ok(false);
    }
    let id = Uuid::new_v4().to_string();
    fs::write(directory.join(format!("{id}.md")), content)?;
    entries.push(HistoryEntry {
        id,
        created_at: now,
        size: content.chars().count(),
        reason,
        revision: content_revision,
    });
    while entries.len() > MAX_PER_DOCUMENT {
        let removed = entries.remove(0);
        let _ = fs::remove_file(directory.join(format!("{}.md", removed.id)));
    }
    save_index(&directory, &index)?;
    Ok(true)
}

/// Keeps history attached to documents after a move or rename.
pub(crate) fn remap(root: &Path, from: &str, to: &str) -> AppResult<()> {
    let directory = directory(root, false)?;
    if !directory.join("index.json").exists() {
        return Ok(());
    }
    let mut index = load_index(&directory)?;
    let prefix = format!("{from}/");
    let moved: Vec<String> = index
        .documents
        .keys()
        .filter(|key| key.as_str() == from || key.starts_with(&prefix))
        .cloned()
        .collect();
    if moved.is_empty() {
        return Ok(());
    }
    for key in moved {
        if let Some(entries) = index.documents.remove(&key) {
            let next = format!("{to}{}", &key[from.len()..]);
            index.documents.entry(next).or_default().extend(entries);
        }
    }
    for entries in index.documents.values_mut() {
        entries.sort_by_key(|entry| entry.created_at);
    }
    save_index(&directory, &index)
}

pub(crate) fn list(root: &Path, path: &str) -> AppResult<Vec<HistoryEntry>> {
    checked_document_key(path)?;
    let directory = directory(root, false)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut entries = load_index(&directory)?
        .documents
        .remove(path)
        .unwrap_or_default();
    entries.reverse();
    Ok(entries)
}

pub(crate) fn read(root: &Path, path: &str, id: &str) -> AppResult<String> {
    checked_document_key(path)?;
    if id.is_empty()
        || !id
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
    {
        return Err(AppError::invalid_input("历史版本编号无效"));
    }
    let directory = directory(root, false)?;
    let known = load_index(&directory)?
        .documents
        .get(path)
        .is_some_and(|entries| entries.iter().any(|entry| entry.id == id));
    if !known {
        return Err(AppError::not_found("没有找到这个历史版本"));
    }
    Ok(fs::read_to_string(directory.join(format!("{id}.md")))?)
}

#[tauri::command]
pub fn list_document_history(
    path: String,
    state: State<'_, ProjectSession>,
) -> AppResult<Vec<HistoryEntry>> {
    list(&state.root()?, &path)
}

#[tauri::command]
pub fn read_document_history(
    path: String,
    id: String,
    state: State<'_, ProjectSession>,
) -> AppResult<String> {
    read(&state.root()?, &path, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project() -> (tempfile::TempDir, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        (temp, root)
    }

    #[test]
    fn throttles_unforced_snapshots_and_skips_duplicates() {
        let (_temp, root) = project();
        let start = 1_000_000;
        assert!(record_at(&root, "a.md", "one", HistoryReason::Save, false, start).unwrap());
        assert!(
            !record_at(
                &root,
                "a.md",
                "two",
                HistoryReason::Save,
                false,
                start + 1000
            )
            .unwrap()
        );
        assert!(
            record_at(
                &root,
                "a.md",
                "two",
                HistoryReason::Format,
                true,
                start + 2000
            )
            .unwrap()
        );
        assert!(!record_at(&root, "a.md", "two", HistoryReason::Ai, true, start + 3000).unwrap());
        assert!(
            record_at(
                &root,
                "a.md",
                "three",
                HistoryReason::Save,
                false,
                start + 2000 + MIN_INTERVAL_MS
            )
            .unwrap()
        );
        assert!(!record_at(&root, "a.md", "  \n", HistoryReason::Save, true, start).unwrap());
        let entries = list(&root, "a.md").unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(read(&root, "a.md", &entries[0].id).unwrap(), "three");
        assert_eq!(entries[1].reason, HistoryReason::Format);
    }

    #[test]
    fn keeps_at_most_fifty_versions_per_document() {
        let (_temp, root) = project();
        for index in 0..55 {
            record_at(
                &root,
                "a.md",
                &format!("v{index}"),
                HistoryReason::Save,
                true,
                index,
            )
            .unwrap();
        }
        let entries = list(&root, "a.md").unwrap();
        assert_eq!(entries.len(), MAX_PER_DOCUMENT);
        assert_eq!(read(&root, "a.md", &entries[0].id).unwrap(), "v54");
        let files = fs::read_dir(root.join(".vivin/history")).unwrap().count();
        assert_eq!(files, MAX_PER_DOCUMENT + 1);
    }

    #[test]
    fn follows_moved_documents_and_rejects_foreign_ids() {
        let (_temp, root) = project();
        record_at(&root, "drafts/a.md", "text", HistoryReason::Save, true, 1).unwrap();
        remap(&root, "drafts", "archive/drafts").unwrap();
        assert!(list(&root, "drafts/a.md").unwrap().is_empty());
        let moved = list(&root, "archive/drafts/a.md").unwrap();
        assert_eq!(moved.len(), 1);
        assert!(read(&root, "other.md", &moved[0].id).is_err());
        assert!(read(&root, "archive/drafts/a.md", "../index.json").is_err());
        assert!(list(&root, "../a.md").is_err());
    }
}
