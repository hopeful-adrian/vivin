use crate::error::{AppError, AppResult};
use crate::project::safe_project_directory;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::io::Write;
use std::path::Path;

#[derive(Clone, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectData {
    #[serde(default = "schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub pinned: BTreeSet<String>,
    #[serde(default)]
    pub locked: BTreeSet<String>,
    #[serde(default)]
    pub terms: Vec<Term>,
    #[serde(default)]
    pub term_exceptions: Vec<TermException>,
    #[serde(default)]
    pub annotations: Vec<Annotation>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Term {
    pub id: String,
    pub name: String,
    pub definition: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TermException {
    pub id: String,
    pub document: String,
    pub term_id: String,
    pub offset: usize,
    pub context_before: String,
    pub context_after: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub document: String,
    pub kind: AnnotationKind,
    pub quote: String,
    pub context_before: String,
    pub context_after: String,
    pub offset: usize,
    pub note: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationKind {
    Todo,
    Comment,
    Question,
    Error,
}

fn schema_version() -> u32 {
    1
}

impl ProjectData {
    pub fn load(root: &Path) -> AppResult<Self> {
        let path = safe_project_directory(root, ".vivin", false)?.join("project.json");
        if !path.exists() {
            return Ok(Self {
                schema_version: schema_version(),
                ..Self::default()
            });
        }
        let bytes = fs::read(path)?;
        let data: Self = serde_json::from_slice(&bytes)?;
        if data.schema_version != schema_version() {
            return Err(AppError::unsupported(format!(
                "不支持的项目数据版本：{}",
                data.schema_version
            )));
        }
        Ok(data)
    }

    pub fn save(&self, root: &Path) -> AppResult<()> {
        let directory = safe_project_directory(root, ".vivin", true)?;
        let mut temporary = tempfile::NamedTempFile::new_in(&directory)?;
        serde_json::to_writer_pretty(&mut temporary, self)?;
        temporary.write_all(b"\n")?;
        temporary.as_file().sync_all()?;
        temporary.persist(directory.join("project.json"))?;
        Ok(())
    }

    pub fn lock_source(&self, path: &str) -> Option<String> {
        let mut candidate = path;
        loop {
            if self.locked.contains(candidate) {
                return Some(candidate.to_string());
            }
            match candidate.rsplit_once('/') {
                Some((parent, _)) => candidate = parent,
                None => return None,
            }
        }
    }

    pub fn require_unlocked(&self, path: &str) -> AppResult<()> {
        if let Some(source) = self.lock_source(path) {
            return Err(AppError::locked(format!("已由 {source} 锁定，无法修改")));
        }
        Ok(())
    }

    /// Rejects moving or deleting a directory that contains its own locked entries.
    pub fn require_no_locked_descendants(&self, path: &str) -> AppResult<()> {
        let prefix = format!("{path}/");
        if self.locked.iter().any(|locked| locked.starts_with(&prefix)) {
            return Err(AppError::locked("目录内有独立锁定的内容，请先解锁"));
        }
        Ok(())
    }

    pub fn remap_paths(&mut self, from: &str, to: &str) {
        fn remap(value: &str, from: &str, to: &str) -> String {
            if value == from {
                to.to_string()
            } else if let Some(suffix) = value.strip_prefix(&format!("{from}/")) {
                format!("{to}/{suffix}")
            } else {
                value.to_string()
            }
        }
        self.pinned = self
            .pinned
            .iter()
            .map(|path| remap(path, from, to))
            .collect();
        self.locked = self
            .locked
            .iter()
            .map(|path| remap(path, from, to))
            .collect();
        for annotation in &mut self.annotations {
            annotation.document = remap(&annotation.document, from, to);
        }
        for exception in &mut self.term_exceptions {
            exception.document = remap(&exception.document, from, to);
        }
    }

    pub fn remove_paths(&mut self, path: &str) {
        let contained =
            |candidate: &str| candidate == path || candidate.starts_with(&format!("{path}/"));
        self.pinned.retain(|candidate| !contained(candidate));
        self.locked.retain(|candidate| !contained(candidate));
        self.annotations
            .retain(|annotation| !contained(&annotation.document));
        self.term_exceptions
            .retain(|exception| !contained(&exception.document));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_locks_are_inherited_and_own_locks_survive() {
        let mut data = ProjectData::default();
        data.locked.insert("drafts".to_string());
        data.locked.insert("drafts/important.md".to_string());
        assert_eq!(
            data.lock_source("drafts/chapter.md").as_deref(),
            Some("drafts")
        );
        data.locked.remove("drafts");
        assert_eq!(data.lock_source("drafts/chapter.md"), None);
        assert_eq!(
            data.lock_source("drafts/important.md").as_deref(),
            Some("drafts/important.md")
        );
    }

    #[test]
    fn moving_directory_updates_references() {
        let mut data = ProjectData::default();
        data.pinned.insert("drafts/one.md".to_string());
        data.locked.insert("drafts/sub".to_string());
        data.remap_paths("drafts", "archive/drafts");
        assert!(data.pinned.contains("archive/drafts/one.md"));
        assert!(data.locked.contains("archive/drafts/sub"));
    }
}
