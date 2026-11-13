mod ai;
mod error;
mod metadata;
mod project;
mod system;

use project::{annotations, assets, documents, entries, export, history, search, session, tree};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(Target::new(TargetKind::LogDir { file_name: None }))
                .target(Target::new(TargetKind::Stdout))
                .level(log::LevelFilter::Info)
                .max_file_size(2_000_000)
                .rotation_strategy(RotationStrategy::KeepSome(3))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(project::ProjectSession::default())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            ai::start(app.handle().clone()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            session::open_project,
            session::create_project,
            session::get_platform,
            session::set_dirty_draft,
            session::publish_draft,
            tree::list_project_tree,
            tree::list_resources,
            documents::read_document,
            documents::read_document_revision,
            documents::read_document_revisions,
            documents::reload_document,
            documents::save_document,
            documents::save_conflict_copy,
            entries::create_document,
            entries::create_directory,
            entries::move_entry,
            entries::delete_entry,
            entries::set_pinned,
            entries::set_locked,
            annotations::get_project_data,
            annotations::upsert_term,
            annotations::delete_term,
            annotations::set_term_exception,
            annotations::upsert_annotation,
            annotations::delete_annotation,
            search::search_documents,
            assets::open_project_reference,
            assets::open_project_resource,
            assets::reveal_project_entry,
            assets::import_resource,
            assets::import_image,
            assets::read_project_image,
            history::list_document_history,
            history::read_document_history,
            export::export_html,
            export::print_document,
            system::open_log_directory,
            system::open_release_page,
            system::bridge_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
