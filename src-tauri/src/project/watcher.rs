use super::paths::is_markdown;
use crate::error::{AppError, AppResult};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher, event::ModifyKind};
use serde::Serialize;
use std::collections::{BTreeSet, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const DEBOUNCE: Duration = Duration::from_millis(300);

/// Watches the open project and emits `vivin://documents-changed` for Markdown
/// content changes and `vivin://project-changed` for structural changes.
/// Dropping the watcher stops the background thread.
pub(crate) struct ProjectWatcher {
    _watcher: RecommendedWatcher,
}

#[derive(Clone, Serialize)]
struct DocumentsChanged {
    paths: Vec<String>,
}

#[derive(Debug, Default, PartialEq)]
struct Change {
    documents: BTreeSet<String>,
    structure: bool,
}

impl ProjectWatcher {
    pub(crate) fn start(app: AppHandle, root: PathBuf) -> AppResult<Self> {
        let (sender, receiver) = channel::<Event>();
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
            if let Ok(event) = result {
                let _ = sender.send(event);
            }
        })
        .map_err(|error| AppError::io(format!("无法监听项目文件：{error}")))?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|error| AppError::io(format!("无法监听项目文件：{error}")))?;
        std::thread::Builder::new()
            .name("vivin-project-watcher".to_string())
            .spawn(move || run(app, root, receiver))
            .map_err(AppError::from)?;
        Ok(Self { _watcher: watcher })
    }
}

fn run(app: AppHandle, root: PathBuf, receiver: Receiver<Event>) {
    let mut known = known_documents(&root);
    while let Ok(first) = receiver.recv() {
        let mut batch = vec![first];
        let deadline = Instant::now() + DEBOUNCE;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match receiver.recv_timeout(remaining) {
                Ok(event) => batch.push(event),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        let change = classify(&root, &mut known, &batch);
        if change.structure {
            known = known_documents(&root);
        }
        if !change.documents.is_empty() {
            let _ = app.emit(
                "vivin://documents-changed",
                DocumentsChanged {
                    paths: change.documents.into_iter().collect(),
                },
            );
        }
        if change.structure {
            let _ = app.emit("vivin://project-changed", ());
        }
    }
}

fn project_key(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return None;
        };
        let part = part.to_string_lossy();
        if part.starts_with('.') {
            return None;
        }
        parts.push(part.into_owned());
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn classify(root: &Path, known: &mut HashSet<String>, events: &[Event]) -> Change {
    let mut change = Change::default();
    for event in events {
        if matches!(
            event.kind,
            EventKind::Access(_) | EventKind::Modify(ModifyKind::Metadata(_))
        ) {
            continue;
        }
        for path in &event.paths {
            let Some(key) = project_key(root, path) else {
                continue;
            };
            if key == "attachments" || key.starts_with("attachments/") {
                continue;
            }
            if key == "resources" || key.starts_with("resources/") {
                change.structure = true;
                continue;
            }
            if is_markdown(path) && !path.is_dir() {
                let exists = path.is_file();
                let membership_changed = if exists {
                    known.insert(key.clone())
                } else {
                    known.remove(&key)
                };
                change.structure |= membership_changed;
                change.documents.insert(key);
            } else if path.is_dir() {
                if !matches!(event.kind, EventKind::Modify(ModifyKind::Data(_))) {
                    change.structure = true;
                }
            } else if !path.exists() {
                let prefix = format!("{key}/");
                let removed: Vec<String> = known
                    .iter()
                    .filter(|candidate| candidate.starts_with(&prefix))
                    .cloned()
                    .collect();
                change.structure = true;
                for document in removed {
                    known.remove(&document);
                    change.documents.insert(document);
                }
            }
        }
    }
    change
}

fn known_documents(root: &Path) -> HashSet<String> {
    fn visit(root: &Path, directory: &Path, depth: usize, found: &mut HashSet<String>) {
        if depth > 64 {
            return;
        }
        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            let Some(key) = project_key(root, &path) else {
                continue;
            };
            if file_type.is_symlink() || key == "resources" || key == "attachments" {
                continue;
            }
            if file_type.is_dir() {
                visit(root, &path, depth + 1, found);
            } else if file_type.is_file() && is_markdown(&path) {
                found.insert(key);
            }
        }
    }
    let mut found = HashSet::new();
    visit(root, root, 0, &mut found);
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, DataChange, RemoveKind};

    fn event(kind: EventKind, path: PathBuf) -> Event {
        Event::new(kind).add_path(path)
    }

    #[test]
    fn separates_content_changes_from_structure_changes() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir(root.join("notes")).unwrap();
        fs::write(root.join("notes/a.md"), "a").unwrap();
        let mut known = known_documents(&root);
        assert!(known.contains("notes/a.md"));

        let edit = classify(
            &root,
            &mut known,
            &[event(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                root.join("notes/a.md"),
            )],
        );
        assert_eq!(edit.documents, BTreeSet::from(["notes/a.md".to_string()]));
        assert!(!edit.structure);

        let hidden = classify(
            &root,
            &mut known,
            &[
                event(
                    EventKind::Create(CreateKind::File),
                    root.join("notes/.tmp123"),
                ),
                event(EventKind::Any, root.join(".vivin/project.json")),
                event(
                    EventKind::Create(CreateKind::File),
                    root.join("attachments/x.png"),
                ),
            ],
        );
        assert_eq!(hidden, Change::default());

        fs::write(root.join("b.md"), "b").unwrap();
        let created = classify(
            &root,
            &mut known,
            &[event(
                EventKind::Create(CreateKind::File),
                root.join("b.md"),
            )],
        );
        assert!(created.structure);

        fs::remove_dir_all(root.join("notes")).unwrap();
        let removed = classify(
            &root,
            &mut known,
            &[event(
                EventKind::Remove(RemoveKind::Folder),
                root.join("notes"),
            )],
        );
        assert!(removed.structure);
        assert!(removed.documents.contains("notes/a.md"));
        assert!(!known.contains("notes/a.md"));
    }
}
