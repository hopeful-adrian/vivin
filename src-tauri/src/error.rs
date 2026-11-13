use serde::Serialize;
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    NoProject,
    InvalidPath,
    NotFound,
    Locked,
    RevisionConflict,
    AlreadyExists,
    InvalidInput,
    Unsupported,
    TrashUnavailable,
    State,
    Io,
}

/// Command error returned to the WebView as `{ code, message }`.
/// The message is a Chinese fallback; the frontend localizes by `code`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn invalid_path(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidPath, message)
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidInput, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }

    pub fn locked(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Locked, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::RevisionConflict, message)
    }

    pub fn already_exists(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::AlreadyExists, message)
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unsupported, message)
    }

    pub fn state(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::State, message)
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Io, message)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        let code = match error.kind() {
            std::io::ErrorKind::NotFound => ErrorCode::NotFound,
            std::io::ErrorKind::AlreadyExists => ErrorCode::AlreadyExists,
            _ => ErrorCode::Io,
        };
        Self::new(code, error.to_string())
    }
}

impl From<tempfile::PersistError> for AppError {
    fn from(error: tempfile::PersistError) -> Self {
        error.error.into()
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::io(format!("项目数据无法读取：{error}"))
    }
}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        Self::io(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_code_and_message_for_the_webview() {
        let value = serde_json::to_value(AppError::conflict("文档已被修改")).unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "code": "revision_conflict", "message": "文档已被修改" })
        );
    }

    #[test]
    fn maps_io_kinds_to_codes() {
        let missing: AppError = std::io::Error::from(std::io::ErrorKind::NotFound).into();
        assert_eq!(missing.code, ErrorCode::NotFound);
        let exists: AppError = std::io::Error::from(std::io::ErrorKind::AlreadyExists).into();
        assert_eq!(exists.code, ErrorCode::AlreadyExists);
    }
}
