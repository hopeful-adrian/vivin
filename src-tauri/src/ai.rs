use crate::error::{AppError, AppResult};
use crate::metadata::{Annotation, AnnotationKind, ProjectData};
use crate::project::history::HistoryReason;
use crate::project::{
    self, ProjectSession, annotations, entries, safe_project_directory, session, tree,
};
use axum::{
    Router,
    extract::State,
    http::{HeaderMap, Request, StatusCode},
    middleware::{self, Next},
    response::Response,
};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use rmcp::{
    ErrorData as McpError, ServerHandler, handler::server::wrapper::Parameters, model::*,
    schemars::JsonSchema, tool, tool_handler, tool_router,
};
use serde::Deserialize;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

const PORT: u16 = 38419;

pub(crate) fn url() -> String {
    format!("http://127.0.0.1:{PORT}/mcp")
}

#[derive(Clone)]
pub struct VivinMcp {
    app: AppHandle,
}

#[derive(Deserialize, JsonSchema)]
struct PathArg {
    path: String,
}

#[derive(Deserialize, JsonSchema)]
struct OpenProjectArg {
    path: String,
}
#[derive(Deserialize, JsonSchema)]
struct CreateProjectArg {
    parent: String,
    name: String,
}
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct MoveArg {
    path: String,
    destination_directory: String,
    name: String,
}
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct DeleteEntryArg {
    path: String,
}
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct WriteArg {
    path: String,
    content: String,
    expected_revision: String,
}
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CreateArg {
    directory: String,
    name: String,
}
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct AnnotationArg {
    document: String,
    kind: AnnotationKind,
    quote: String,
    offset: usize,
    note: String,
}
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct TermArg {
    id: Option<String>,
    name: String,
    definition: String,
}
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct IdArg {
    id: String,
}
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FlagArg {
    path: String,
    value: bool,
}

fn result<T: serde::Serialize>(value: AppResult<T>) -> Result<CallToolResult, McpError> {
    Ok(match value {
        Ok(value) => CallToolResult::success(vec![ContentBlock::text(
            serde_json::to_string(&value).unwrap_or_else(|_| "null".to_string()),
        )]),
        Err(error) => CallToolResult::error(vec![ContentBlock::text(
            serde_json::to_string(&error).unwrap_or(error.message),
        )]),
    })
}

fn require_no_unsaved_edits(state: &ProjectSession) -> AppResult<()> {
    if state.has_dirty_draft()? {
        return Err(AppError::state(
            "当前项目有未保存的编辑内容，请先在 vivin 中保存或处理后再切换项目",
        ));
    }
    Ok(())
}

fn require_no_draft_under(state: &ProjectSession, path: &str) -> AppResult<()> {
    if state.has_draft_under(path)? {
        return Err(AppError::state("目标包含未保存草稿，请先保存"));
    }
    Ok(())
}

#[tool_router]
impl VivinMcp {
    fn new(app: AppHandle) -> Self {
        Self { app }
    }

    fn session(&self) -> tauri::State<'_, ProjectSession> {
        self.app.state::<ProjectSession>()
    }

    fn changed(&self) {
        let _ = self.app.emit("vivin://project-changed", ());
    }

    #[tool(
        description = "Create and open a new vivin project in a local parent directory. The new project includes a resources directory."
    )]
    fn create_project(
        &self,
        Parameters(arg): Parameters<CreateProjectArg>,
    ) -> Result<CallToolResult, McpError> {
        result((|| {
            let state = self.session();
            let _guard = state.mutation_guard()?;
            require_no_unsaved_edits(&state)?;
            let root = session::create_project_root(&arg.parent, &arg.name)?;
            let info = state.activate(&self.app, root)?;
            let _ = self.app.emit("vivin://project-opened", &info);
            Ok(info)
        })())
    }

    #[tool(
        description = "Open an existing local project folder in vivin and make it active. Returns the project path."
    )]
    fn open_project(
        &self,
        Parameters(arg): Parameters<OpenProjectArg>,
    ) -> Result<CallToolResult, McpError> {
        result((|| {
            let state = self.session();
            let _guard = state.mutation_guard()?;
            require_no_unsaved_edits(&state)?;
            let root = session::resolve_project_root(&arg.path)?;
            let info = state.activate(&self.app, root)?;
            let _ = self.app.emit("vivin://project-opened", &info);
            Ok(info)
        })())
    }

    #[tool(description = "Get the active vivin project path.")]
    fn project_context(&self) -> Result<CallToolResult, McpError> {
        result((|| Ok(json!({ "path": self.session().root()? })))())
    }

    #[tool(
        description = "List the active project's Markdown document tree, with pinned and lock information."
    )]
    fn list_project_tree(&self) -> Result<CallToolResult, McpError> {
        result((|| {
            let root = self.session().root()?;
            tree::collect_tree(&root, &root, 0, &ProjectData::load(&root)?)
        })())
    }

    #[tool(
        description = "Read a Markdown document from the active project. Returns content and revision. Paths are project-relative."
    )]
    fn read_document(
        &self,
        Parameters(arg): Parameters<PathArg>,
    ) -> Result<CallToolResult, McpError> {
        result((|| {
            let state = self.session();
            let root = state.root()?;
            let content = state.current_content(&root, &arg.path)?;
            Ok(json!({
                "path": arg.path,
                "revision": project::revision(&content),
                "content": content,
                "lockSource": ProjectData::load(&root)?.lock_source(&arg.path),
            }))
        })())
    }

    #[tool(
        description = "Replace a Markdown document using its exact expected revision. Locked files are rejected. The previous text is kept in the document's version history."
    )]
    fn write_document(
        &self,
        Parameters(arg): Parameters<WriteArg>,
    ) -> Result<CallToolResult, McpError> {
        result((|| {
            let state = self.session();
            let _guard = state.mutation_guard()?;
            let root = state.root()?;
            let file = project::checked_document(&root, &arg.path)?;
            let before_disk = fs::read_to_string(&file)?;
            let draft = state.draft(&arg.path)?;
            let before = if let Some(draft) = &draft {
                if project::revision(&before_disk) != draft.base_revision {
                    return Err(AppError::conflict("磁盘文档已改变，请先处理外部修改冲突"));
                }
                if project::revision(&draft.content) != arg.expected_revision {
                    return Err(AppError::conflict("版本冲突：用户草稿已在读取后继续修改"));
                }
                draft.content.clone()
            } else {
                if project::revision(&before_disk) != arg.expected_revision {
                    return Err(AppError::conflict("版本冲突：文档已在读取后修改"));
                }
                before_disk.clone()
            };
            let expected_disk_revision =
                draft.map_or(arg.expected_revision, |draft| draft.base_revision);
            let saved = project::save_document_unlocked(
                &root,
                arg.path.clone(),
                arg.content.clone(),
                expected_disk_revision,
                Some(HistoryReason::Ai),
            )?;
            state.remove_draft(&arg.path)?;
            let _ = self.app.emit(
                "vivin://document-written",
                json!({ "document": &saved, "beforeContent": before }),
            );
            Ok(saved)
        })())
    }

    #[tool(
        description = "Create a Markdown document in the active project. The directory is project-relative or empty for the root."
    )]
    fn create_document(
        &self,
        Parameters(arg): Parameters<CreateArg>,
    ) -> Result<CallToolResult, McpError> {
        result((|| {
            let state = self.session();
            let _guard = state.mutation_guard()?;
            let document = entries::create_document_in(&state.root()?, &arg.directory, &arg.name)?;
            self.changed();
            Ok(document)
        })())
    }

    #[tool(description = "Create a directory in the active project.")]
    fn create_directory(
        &self,
        Parameters(arg): Parameters<CreateArg>,
    ) -> Result<CallToolResult, McpError> {
        result((|| {
            let state = self.session();
            let _guard = state.mutation_guard()?;
            let path = entries::create_directory_in(&state.root()?, &arg.directory, &arg.name)?;
            self.changed();
            Ok(json!({ "path": path }))
        })())
    }

    #[tool(
        description = "Move or rename a Markdown document or directory within the active project."
    )]
    fn move_entry(&self, Parameters(arg): Parameters<MoveArg>) -> Result<CallToolResult, McpError> {
        result((|| {
            let state = self.session();
            let _guard = state.mutation_guard()?;
            require_no_draft_under(&state, &arg.path)?;
            let new_path = entries::move_entry_in(
                &state.root()?,
                &arg.path,
                &arg.destination_directory,
                &arg.name,
            )?;
            let _ = self.app.emit(
                "vivin://entry-moved",
                json!({ "from": arg.path, "to": new_path }),
            );
            self.changed();
            Ok(json!({ "path": new_path }))
        })())
    }

    #[tool(
        description = "Move a Markdown document or directory within the active project to the system trash."
    )]
    fn delete_entry(
        &self,
        Parameters(arg): Parameters<DeleteEntryArg>,
    ) -> Result<CallToolResult, McpError> {
        result((|| {
            let state = self.session();
            let _guard = state.mutation_guard()?;
            require_no_draft_under(&state, &arg.path)?;
            entries::delete_entry_in(&state.root()?, &arg.path, false)?;
            let _ = self
                .app
                .emit("vivin://entry-deleted", json!({ "path": arg.path }));
            self.changed();
            Ok(json!({ "deleted": arg.path }))
        })())
    }

    #[tool(
        description = "List resource files in the active project's resources directory, returning their project-relative and local paths. Resource contents are not parsed."
    )]
    fn list_resources(&self) -> Result<CallToolResult, McpError> {
        result((|| {
            let root = self.session().root()?;
            let dir = safe_project_directory(&root, "resources", false)?;
            if !dir.exists() {
                return Ok(json!([]));
            }
            let nodes = tree::collect_resources(&root, &dir, 0)?;
            Ok(json!({ "projectRoot": root, "resources": nodes }))
        })())
    }

    #[tool(
        description = "List current project data, including terms, annotations, pins and locks."
    )]
    fn project_data(&self) -> Result<CallToolResult, McpError> {
        result((|| ProjectData::load(&self.session().root()?))())
    }

    #[tool(
        description = "Add a todo, comment, question or error annotation to selected Markdown source text. The note may be empty."
    )]
    fn add_annotation(
        &self,
        Parameters(arg): Parameters<AnnotationArg>,
    ) -> Result<CallToolResult, McpError> {
        result((|| {
            let state = self.session();
            let _guard = state.mutation_guard()?;
            let root = state.root()?;
            let annotation = annotations::upsert_annotation_in(
                &state,
                &root,
                Annotation {
                    id: String::new(),
                    document: arg.document,
                    kind: arg.kind,
                    quote: arg.quote,
                    context_before: String::new(),
                    context_after: String::new(),
                    offset: arg.offset,
                    note: arg.note,
                },
            )?;
            self.changed();
            Ok(annotation)
        })())
    }

    #[tool(description = "Delete an annotation by ID.")]
    fn delete_annotation(
        &self,
        Parameters(arg): Parameters<IdArg>,
    ) -> Result<CallToolResult, McpError> {
        result((|| {
            let state = self.session();
            let _guard = state.mutation_guard()?;
            annotations::delete_annotation_in(&state.root()?, &arg.id)?;
            self.changed();
            Ok(json!({ "deleted": arg.id }))
        })())
    }

    #[tool(description = "Create or update a shared project term.")]
    fn upsert_term(
        &self,
        Parameters(arg): Parameters<TermArg>,
    ) -> Result<CallToolResult, McpError> {
        result((|| {
            let state = self.session();
            let _guard = state.mutation_guard()?;
            let term =
                annotations::upsert_term_in(&state.root()?, arg.id, &arg.name, arg.definition)?;
            self.changed();
            Ok(term)
        })())
    }

    #[tool(description = "Delete a shared project term by ID.")]
    fn delete_term(&self, Parameters(arg): Parameters<IdArg>) -> Result<CallToolResult, McpError> {
        result((|| {
            let state = self.session();
            let _guard = state.mutation_guard()?;
            annotations::delete_term_in(&state.root()?, &arg.id)?;
            self.changed();
            Ok(json!({ "deleted": arg.id }))
        })())
    }

    #[tool(description = "Pin or unpin a Markdown document.")]
    fn set_pinned(&self, Parameters(arg): Parameters<FlagArg>) -> Result<CallToolResult, McpError> {
        result((|| {
            let state = self.session();
            let _guard = state.mutation_guard()?;
            entries::set_pinned_in(&state.root()?, &arg.path, arg.value)?;
            self.changed();
            Ok(json!({ "path": arg.path, "pinned": arg.value }))
        })())
    }

    #[tool(
        description = "Lock or unlock a document or directory. An inherited lock cannot be removed on a child."
    )]
    fn set_locked(&self, Parameters(arg): Parameters<FlagArg>) -> Result<CallToolResult, McpError> {
        result((|| {
            let state = self.session();
            let _guard = state.mutation_guard()?;
            entries::set_locked_in(&state.root()?, &arg.path, arg.value)?;
            self.changed();
            Ok(json!({ "path": arg.path, "locked": arg.value }))
        })())
    }
}

#[tool_handler]
impl ServerHandler for VivinMcp {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::from_build_env())
            .with_instructions("The active vivin project is selected in the desktop app. All paths are relative to that project. Writes follow project lock and document version checks. Errors are JSON objects with a stable `code` and a Chinese `message`.".to_string())
    }
}

async fn auth(
    State(token): State<Arc<String>>,
    headers: HeaderMap,
    request: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let valid = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        == Some(format!("Bearer {}", token).as_str());
    let host_ok = headers
        .get("host")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|host| {
            host == format!("127.0.0.1:{PORT}") || host == format!("localhost:{PORT}")
        });
    let origin_ok = headers
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .is_none_or(|origin| {
            origin.starts_with("http://127.0.0.1:") || origin.starts_with("http://localhost:")
        });
    if !valid {
        return Err(StatusCode::UNAUTHORIZED);
    }
    if !host_ok || !origin_ok {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(next.run(request).await)
}

fn bridge_token(path: &PathBuf) -> Result<String, String> {
    if path.exists() {
        return serde_json::from_slice::<serde_json::Value>(
            &fs::read(path).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?
        .get("token")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or_else(|| "桥接配置缺少令牌".to_string());
    }
    let token = format!("{}{}", Uuid::new_v4(), Uuid::new_v4());
    fs::write(
        path,
        serde_json::to_vec_pretty(&json!({ "url": url(), "token": token }))
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    Ok(token)
}

pub fn start(app: AppHandle) -> Result<(), String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    let token = bridge_token(&directory.join("bridge.json"))?;
    tauri::async_runtime::spawn(async move {
        let shared_app = app.clone();
        let service = StreamableHttpService::new(
            move || Ok(VivinMcp::new(shared_app.clone())),
            LocalSessionManager::default().into(),
            StreamableHttpServerConfig::default()
                .with_legacy_session_mode(false)
                .with_json_response(true),
        );
        let router = Router::new()
            .nest_service("/mcp", service)
            .layer(middleware::from_fn_with_state(Arc::new(token), auth));
        match tokio::net::TcpListener::bind(("127.0.0.1", PORT)).await {
            Ok(listener) => {
                if let Err(error) = axum::serve(listener, router).await {
                    log::error!("vivin MCP server: {error}");
                }
            }
            Err(error) => log::error!("vivin MCP server cannot bind: {error}"),
        }
    });
    Ok(())
}
