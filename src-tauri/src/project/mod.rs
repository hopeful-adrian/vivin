//! Project file services. Every path is resolved inside the open project root,
//! and every write checks locks and document revisions before touching disk.

pub mod annotations;
pub mod assets;
pub mod documents;
pub mod entries;
pub mod export;
pub mod history;
mod paths;
pub mod search;
pub mod session;
pub mod tree;
mod watcher;

pub(crate) use documents::{revision, save_document_unlocked};
pub(crate) use paths::{checked_document, safe_project_directory};
pub use session::ProjectSession;
