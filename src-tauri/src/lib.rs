// Tauri 2.0: 移动端入口点

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::registry::safe_io_register_root,
            commands::registry::safe_io_unregister_root,
            commands::registry::safe_io_list_roots,
            commands::fs::safe_io_fs_read,
            commands::fs::safe_io_fs_write,
            commands::fs::safe_io_fs_ls,
            commands::fs::safe_io_fs_stat,
            commands::fs::safe_io_fs_exists,
            commands::fs::safe_io_fs_rm,
            commands::fs::safe_io_fs_cp,
            commands::fs::safe_io_fs_mv,
            commands::fs::safe_io_fs_mkdir,
            commands::fs::safe_io_fs_hide,
            commands::fs::safe_io_fs_unhide,
            commands::fs::safe_io_fs_is_hidden,
            commands::zip::safe_io_zip_from,
            commands::zip::safe_io_zip_extract,
            commands::zip::safe_io_zip_list,
            commands::owner_rpc::start_owner_rpc,
            commands::owner_rpc::stop_owner_rpc,
            commands::owner_rpc::owner_rpc_respond,
        ])
        .manage(commands::owner_rpc::OwnerRpcState::default())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
