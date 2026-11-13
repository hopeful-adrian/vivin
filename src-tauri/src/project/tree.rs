use super::paths::{is_markdown, relative_key, safe_project_directory};
use super::session::ProjectSession;
use crate::error::{AppError, AppResult};
use crate::metadata::ProjectData;
use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::State;

const MAX_DEPTH: usize = 64;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) kind: &'static str,
    pub(crate) children: Vec<TreeNode>,
    pinned: bool,
    lock_source: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceNode {
    name: String,
    path: String,
    local_path: String,
    kind: &'static str,
    file_type: String,
    children: Vec<ResourceNode>,
}

pub(crate) fn collect_tree(
    root: &Path,
    directory: &Path,
    depth: usize,
    data: &ProjectData,
) -> AppResult<Vec<TreeNode>> {
    if depth > MAX_DEPTH {
        return Err(AppError::unsupported("目录层级超过支持范围"));
    }

    let mut nodes = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.')
            || (directory == root && (name == "resources" || name == "attachments"))
        {
            continue;
        }

        let path = entry.path();
        let relative = relative_key(root, &path)?;
        if file_type.is_dir() {
            nodes.push(TreeNode {
                name,
                path: relative.clone(),
                kind: "directory",
                children: collect_tree(root, &path, depth + 1, data)?,
                pinned: false,
                lock_source: data.lock_source(&relative),
            });
        } else if file_type.is_file() && is_markdown(&path) {
            nodes.push(TreeNode {
                name,
                path: relative.clone(),
                kind: "document",
                children: Vec::new(),
                pinned: data.pinned.contains(&relative),
                lock_source: data.lock_source(&relative),
            });
        }
    }

    nodes.sort_by(|left, right| {
        (
            left.kind != "directory",
            !left.pinned,
            left.name.to_lowercase(),
        )
            .cmp(&(
                right.kind != "directory",
                !right.pinned,
                right.name.to_lowercase(),
            ))
    });
    Ok(nodes)
}

pub(crate) fn document_paths(nodes: Vec<TreeNode>, paths: &mut Vec<String>) {
    for node in nodes {
        if node.kind == "directory" {
            document_paths(node.children, paths);
        } else {
            paths.push(node.path);
        }
    }
}

pub(crate) fn collect_resources(
    root: &Path,
    directory: &Path,
    depth: usize,
) -> AppResult<Vec<ResourceNode>> {
    if depth > MAX_DEPTH {
        return Err(AppError::unsupported("资源目录层级超过支持范围"));
    }
    let mut nodes = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let relative = relative_key(root, &path)?;
        if file_type.is_dir() {
            nodes.push(ResourceNode {
                name,
                path: relative,
                local_path: path.to_string_lossy().into_owned(),
                kind: "directory",
                file_type: String::new(),
                children: collect_resources(root, &path, depth + 1)?,
            });
        } else if file_type.is_file() {
            let extension = path.extension().map_or(String::new(), |value| {
                value.to_string_lossy().to_uppercase()
            });
            nodes.push(ResourceNode {
                name,
                path: relative,
                local_path: path.to_string_lossy().into_owned(),
                kind: "file",
                file_type: extension,
                children: Vec::new(),
            });
        }
    }
    nodes.sort_by(|a, b| {
        (a.kind != "directory", a.name.to_lowercase())
            .cmp(&(b.kind != "directory", b.name.to_lowercase()))
    });
    Ok(nodes)
}

#[tauri::command]
pub fn list_project_tree(state: State<'_, ProjectSession>) -> AppResult<Vec<TreeNode>> {
    let root = state.root()?;
    let data = ProjectData::load(&root)?;
    collect_tree(&root, &root, 0, &data)
}

#[tauri::command]
pub fn list_resources(state: State<'_, ProjectSession>) -> AppResult<Vec<ResourceNode>> {
    let root = state.root()?;
    let directory = safe_project_directory(&root, "resources", true)?;
    collect_resources(&root, &directory, 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_excludes_resources_and_uses_portable_paths() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        fs::create_dir(root.join("notes")).unwrap();
        fs::create_dir(root.join("resources")).unwrap();
        fs::write(root.join("notes/hello.md"), "hello").unwrap();
        fs::write(root.join("resources/source.pdf"), "source").unwrap();

        let tree = collect_tree(root, root, 0, &ProjectData::default()).unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].path, "notes");
        assert_eq!(tree[0].children[0].path, "notes/hello.md");
        let mut paths = Vec::new();
        document_paths(tree, &mut paths);
        assert_eq!(paths, vec!["notes/hello.md".to_string()]);
    }
}
