use super::session::ProjectSession;
use super::tree::{collect_tree, document_paths};
use crate::error::{AppError, AppResult};
use crate::metadata::ProjectData;
use serde::Serialize;
use std::fs;
use tauri::State;

const MAX_HITS_PER_DOCUMENT: usize = 100;
const EXCERPT_CHARS: usize = 40;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    path: String,
    offset: usize,
    excerpt: String,
}

fn search_text(path: &str, text: &str, query: &str, hits: &mut Vec<SearchHit>) {
    for (offset, _) in text.match_indices(query).take(MAX_HITS_PER_DOCUMENT) {
        let start = text[..offset]
            .char_indices()
            .rev()
            .nth(EXCERPT_CHARS)
            .map_or(0, |(index, _)| index);
        let end_offset = offset + query.len();
        let end = text[end_offset..]
            .char_indices()
            .nth(EXCERPT_CHARS)
            .map_or(text.len(), |(index, _)| end_offset + index);
        hits.push(SearchHit {
            path: path.to_string(),
            offset: text[..offset].encode_utf16().count(),
            excerpt: text[start..end].replace('\n', " "),
        });
    }
}

#[tauri::command]
pub fn search_documents(
    query: String,
    state: State<'_, ProjectSession>,
) -> AppResult<Vec<SearchHit>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    if query.chars().count() > 200 {
        return Err(AppError::invalid_input("搜索词过长"));
    }
    let root = state.root()?;
    let data = ProjectData::load(&root)?;
    let mut paths = Vec::new();
    document_paths(collect_tree(&root, &root, 0, &data)?, &mut paths);
    let mut hits = Vec::new();
    for path in paths {
        let text = fs::read_to_string(root.join(&path))?;
        search_text(&path, &text, query, &mut hits);
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_utf16_offsets_and_single_line_excerpts() {
        let mut hits = Vec::new();
        search_text("a.md", "第一行\n😀 目标", "目标", &mut hits);
        assert_eq!(
            hits,
            vec![SearchHit {
                path: "a.md".to_string(),
                offset: 7,
                excerpt: "第一行 😀 目标".to_string(),
            }]
        );
    }
}
