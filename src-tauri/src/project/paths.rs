use crate::error::{AppError, AppResult};
use std::fs;
use std::path::{Component, Path, PathBuf};

pub(crate) fn checked_relative(path: &str) -> AppResult<&Path> {
    let relative = Path::new(path);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::invalid_path("路径必须位于当前项目内"));
    }
    if relative
        .components()
        .any(|component| component.as_os_str().to_string_lossy().starts_with('.'))
    {
        return Err(AppError::invalid_path("不能操作隐藏项目数据"));
    }
    Ok(relative)
}

/// Accepts a single file or directory name without separators or a leading dot.
pub(crate) fn checked_name(name: &str) -> AppResult<&Path> {
    let path = checked_relative(name)?;
    if path.components().count() != 1 {
        return Err(AppError::invalid_input("名称不能包含路径"));
    }
    Ok(path)
}

pub(crate) fn is_markdown(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

pub(crate) fn safe_project_directory(
    root: &Path,
    relative: &str,
    create: bool,
) -> AppResult<PathBuf> {
    let relative = Path::new(relative);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::invalid_path("项目目录路径无效"));
    }
    let mut path = root.to_path_buf();
    for component in relative.components() {
        path.push(component);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(AppError::invalid_path("项目目录不能是符号链接或文件"));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
                fs::create_dir(&path)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(root.join(relative));
            }
            Err(error) => return Err(error.into()),
        }
    }
    let canonical = fs::canonicalize(&path)?;
    if !canonical.starts_with(root) {
        return Err(AppError::invalid_path("项目目录不在当前项目内"));
    }
    Ok(canonical)
}

pub(crate) fn checked_member(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let relative = checked_relative(relative)?;
    if relative
        .components()
        .next()
        .is_some_and(|part| part.as_os_str() == "resources")
    {
        return Err(AppError::invalid_path("资源库不能作为文档目录操作"));
    }
    let absolute = fs::canonicalize(root.join(relative))?;
    if !absolute.starts_with(root) {
        return Err(AppError::invalid_path("路径不在当前项目内"));
    }
    Ok(absolute)
}

/// Resolves an existing directory, or the project root for an empty path.
pub(crate) fn checked_directory(root: &Path, relative: &str) -> AppResult<PathBuf> {
    if relative.is_empty() {
        return Ok(root.to_path_buf());
    }
    let resolved = checked_member(root, relative)?;
    if !resolved.is_dir() {
        return Err(AppError::invalid_path("目录不在当前项目内"));
    }
    Ok(resolved)
}

pub(crate) fn relative_key(root: &Path, path: &Path) -> AppResult<String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| AppError::invalid_path("路径不在当前项目内"))?;
    Ok(relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/"))
}

pub(crate) fn checked_document(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let relative = checked_relative(relative)?;
    if !is_markdown(relative) {
        return Err(AppError::unsupported("只能编辑 Markdown 文档"));
    }
    let absolute = checked_member(root, &relative.to_string_lossy())?;
    if !absolute.is_file() {
        return Err(AppError::not_found("文档不在当前项目内"));
    }
    Ok(absolute)
}

pub(crate) fn utf16_to_byte(content: &str, offset: usize) -> Option<usize> {
    let mut utf16_offset = 0;
    for (byte_offset, character) in content.char_indices() {
        if utf16_offset == offset {
            return Some(byte_offset);
        }
        utf16_offset += character.len_utf16();
        if utf16_offset > offset {
            return None;
        }
    }
    (utf16_offset == offset).then_some(content.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn rejects_paths_outside_the_project() {
        assert!(checked_relative("../outside.md").is_err());
        assert!(checked_relative("/absolute.md").is_err());
        assert!(checked_relative("./document.md").is_err());
        assert_eq!(
            checked_relative(".vivin/project.json").unwrap_err().code,
            ErrorCode::InvalidPath
        );
        assert!(checked_relative("notes/document.md").is_ok());
        assert!(checked_name("notes/document.md").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_to_document_outside_project() {
        use std::os::unix::fs::symlink;

        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let outside_file = outside.path().join("outside.md");
        fs::write(&outside_file, "private").unwrap();
        symlink(&outside_file, project.path().join("link.md")).unwrap();

        let canonical_project = fs::canonicalize(project.path()).unwrap();
        assert_eq!(
            checked_document(&canonical_project, "link.md")
                .unwrap_err()
                .code,
            ErrorCode::InvalidPath
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_managed_directories() {
        use std::os::unix::fs::symlink;

        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(project.path()).unwrap();
        symlink(outside.path(), root.join("attachments")).unwrap();
        symlink(outside.path(), root.join(".vivin")).unwrap();

        assert!(safe_project_directory(&root, "attachments", true).is_err());
        assert!(safe_project_directory(&root, ".vivin/history", true).is_err());
        assert!(safe_project_directory(&root, ".vivin", false).is_err());
    }

    #[test]
    fn converts_utf16_offsets() {
        assert_eq!(utf16_to_byte("中a", 1), Some(3));
        assert_eq!(utf16_to_byte("😀a", 1), None);
        assert_eq!(utf16_to_byte("😀a", 2), Some(4));
    }
}
