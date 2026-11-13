use super::paths::{checked_document, utf16_to_byte};
use super::session::ProjectSession;
use crate::error::{AppError, AppResult};
use crate::metadata::{Annotation, ProjectData, Term, TermException};
use std::path::Path;
use tauri::State;
use uuid::Uuid;

const CONTEXT_CHARS: usize = 32;

/// Byte range of `quote` at a UTF-16 `offset`, verified against `content`.
fn quote_range(content: &str, offset: usize, quote: &str) -> AppResult<(usize, usize)> {
    let invalid = || AppError::invalid_input("位置无效");
    let start = utf16_to_byte(content, offset).ok_or_else(invalid)?;
    let end_offset = offset
        .checked_add(quote.encode_utf16().count())
        .ok_or_else(invalid)?;
    let end = utf16_to_byte(content, end_offset).ok_or_else(invalid)?;
    if quote.is_empty() || content.get(start..end) != Some(quote) {
        return Err(AppError::conflict("位置与当前原文不匹配"));
    }
    Ok((start, end))
}

fn context_around(content: &str, start: usize, end: usize) -> (String, String) {
    let before = content[..start]
        .chars()
        .rev()
        .take(CONTEXT_CHARS)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let after = content[end..].chars().take(CONTEXT_CHARS).collect();
    (before, after)
}

pub(crate) fn upsert_term_in(
    root: &Path,
    id: Option<String>,
    name: &str,
    definition: String,
) -> AppResult<Term> {
    let name = name.trim().to_string();
    if name.is_empty() || name.chars().count() > 200 {
        return Err(AppError::invalid_input("术语名称必须为 1–200 个字符"));
    }
    let mut data = ProjectData::load(root)?;
    if data
        .terms
        .iter()
        .any(|term| term.name == name && id.as_deref() != Some(&term.id))
    {
        return Err(AppError::already_exists("项目中已有同名术语"));
    }
    let term = Term {
        id: id.unwrap_or_else(|| Uuid::new_v4().to_string()),
        name,
        definition,
    };
    if let Some(existing) = data.terms.iter_mut().find(|item| item.id == term.id) {
        *existing = term.clone();
    } else {
        data.terms.push(term.clone());
    }
    data.save(root)?;
    Ok(term)
}

pub(crate) fn delete_term_in(root: &Path, id: &str) -> AppResult<()> {
    let mut data = ProjectData::load(root)?;
    if !data.terms.iter().any(|term| term.id == id) {
        return Err(AppError::not_found("术语不存在"));
    }
    data.terms.retain(|term| term.id != id);
    data.term_exceptions
        .retain(|exception| exception.term_id != id);
    data.save(root)
}

pub(crate) fn set_term_exception_in(
    session: &ProjectSession,
    root: &Path,
    document: String,
    term_id: String,
    offset: usize,
    disabled: bool,
    exception_id: Option<String>,
) -> AppResult<Option<TermException>> {
    checked_document(root, &document)?;
    let mut data = ProjectData::load(root)?;
    data.require_unlocked(&document)?;
    let term = data
        .terms
        .iter()
        .find(|term| term.id == term_id)
        .ok_or_else(|| AppError::not_found("术语不存在"))?
        .clone();
    if !disabled {
        data.term_exceptions.retain(|item| match &exception_id {
            Some(id) => &item.id != id,
            None => {
                !(item.document == document && item.term_id == term_id && item.offset == offset)
            }
        });
        data.save(root)?;
        return Ok(None);
    }
    let content = session.current_content(root, &document)?;
    let (start, end) = quote_range(&content, offset, &term.name)?;
    if let Some(existing) = data
        .term_exceptions
        .iter()
        .find(|item| item.document == document && item.term_id == term_id && item.offset == offset)
    {
        return Ok(Some(existing.clone()));
    }
    let (context_before, context_after) = context_around(&content, start, end);
    let exception = TermException {
        id: Uuid::new_v4().to_string(),
        document,
        term_id,
        offset,
        context_before,
        context_after,
    };
    data.term_exceptions.push(exception.clone());
    data.save(root)?;
    Ok(Some(exception))
}

/// Creates a new annotation (empty `id`) anchored to the current text, or updates
/// an existing annotation's kind and note.
pub(crate) fn upsert_annotation_in(
    session: &ProjectSession,
    root: &Path,
    mut annotation: Annotation,
) -> AppResult<Annotation> {
    checked_document(root, &annotation.document)?;
    let mut data = ProjectData::load(root)?;
    data.require_unlocked(&annotation.document)?;
    if annotation.quote.is_empty() {
        return Err(AppError::invalid_input("请先选择要标注的原文"));
    }
    if annotation.id.is_empty() {
        let content = session.current_content(root, &annotation.document)?;
        let (start, end) = quote_range(&content, annotation.offset, &annotation.quote)?;
        let (context_before, context_after) = context_around(&content, start, end);
        annotation.id = Uuid::new_v4().to_string();
        annotation.context_before = context_before;
        annotation.context_after = context_after;
        data.annotations.push(annotation.clone());
    } else {
        let existing = data
            .annotations
            .iter_mut()
            .find(|item| item.id == annotation.id)
            .ok_or_else(|| AppError::not_found("标注不存在"))?;
        if existing.document != annotation.document {
            return Err(AppError::invalid_input("不能更改标注所属文档"));
        }
        *existing = annotation.clone();
    }
    data.save(root)?;
    Ok(annotation)
}

pub(crate) fn delete_annotation_in(root: &Path, id: &str) -> AppResult<()> {
    let mut data = ProjectData::load(root)?;
    let annotation = data
        .annotations
        .iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::not_found("标注不存在"))?;
    data.require_unlocked(&annotation.document)?;
    data.annotations.retain(|item| item.id != id);
    data.save(root)
}

#[tauri::command]
pub fn get_project_data(state: State<'_, ProjectSession>) -> AppResult<ProjectData> {
    ProjectData::load(&state.root()?)
}

#[tauri::command]
pub fn upsert_term(
    id: Option<String>,
    name: String,
    definition: String,
    state: State<'_, ProjectSession>,
) -> AppResult<Term> {
    let _guard = state.mutation_guard()?;
    upsert_term_in(&state.root()?, id, &name, definition)
}

#[tauri::command]
pub fn delete_term(id: String, state: State<'_, ProjectSession>) -> AppResult<()> {
    let _guard = state.mutation_guard()?;
    delete_term_in(&state.root()?, &id)
}

#[tauri::command]
pub fn set_term_exception(
    document: String,
    term_id: String,
    offset: usize,
    disabled: bool,
    exception_id: Option<String>,
    state: State<'_, ProjectSession>,
) -> AppResult<Option<TermException>> {
    let _guard = state.mutation_guard()?;
    let root = state.root()?;
    set_term_exception_in(
        &state,
        &root,
        document,
        term_id,
        offset,
        disabled,
        exception_id,
    )
}

#[tauri::command]
pub fn upsert_annotation(
    annotation: Annotation,
    state: State<'_, ProjectSession>,
) -> AppResult<Annotation> {
    let _guard = state.mutation_guard()?;
    let root = state.root()?;
    upsert_annotation_in(&state, &root, annotation)
}

#[tauri::command]
pub fn delete_annotation(id: String, state: State<'_, ProjectSession>) -> AppResult<()> {
    let _guard = state.mutation_guard()?;
    delete_annotation_in(&state.root()?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use crate::metadata::AnnotationKind;
    use std::fs;

    fn annotation(quote: &str, offset: usize) -> Annotation {
        Annotation {
            id: String::new(),
            document: "a.md".to_string(),
            kind: AnnotationKind::Question,
            quote: quote.to_string(),
            context_before: String::new(),
            context_after: String::new(),
            offset,
            note: String::new(),
        }
    }

    #[test]
    fn anchors_new_annotations_to_the_current_text() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(root.join("a.md"), "前文 目标 后文").unwrap();
        let session = ProjectSession::default();
        session.set_root(root.clone()).unwrap();
        let created = upsert_annotation_in(&session, &root, annotation("目标", 3)).unwrap();
        assert!(!created.id.is_empty());
        assert_eq!(created.context_before, "前文 ");
        assert_eq!(created.context_after, " 后文");
        assert_eq!(
            upsert_annotation_in(&session, &root, annotation("目标", 0))
                .unwrap_err()
                .code,
            ErrorCode::RevisionConflict
        );
        delete_annotation_in(&root, &created.id).unwrap();
        assert_eq!(
            delete_annotation_in(&root, &created.id).unwrap_err().code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn term_names_are_unique() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let term = upsert_term_in(&root, None, " 采购 ", String::new()).unwrap();
        assert_eq!(term.name, "采购");
        assert_eq!(
            upsert_term_in(&root, None, "采购", String::new())
                .unwrap_err()
                .code,
            ErrorCode::AlreadyExists
        );
        assert!(upsert_term_in(&root, Some(term.id.clone()), "采购", "新解释".to_string()).is_ok());
    }
}
