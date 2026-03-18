//! AuraKey — Tauri GUI (IPC Client Mode)
//!
//! The GUI connects to the running daemon via named pipe IPC.
//! When closed, the process fully exits. The daemon keeps running.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[allow(dead_code)]
pub mod arduino;
#[allow(dead_code)]
pub mod config;
mod commands;
pub mod daemon;
#[allow(dead_code)]
pub mod executor;
pub mod gamepad;
pub mod input;
pub mod ipc;
#[allow(dead_code)]
pub mod recorder;
mod state;
pub mod service_main;
pub mod tray_win32;

use config::AppConfig;
use crossbeam_channel::unbounded;
use ipc::PIPE_NAME;
use state::AppState;
use std::sync::Mutex;
use tauri::Manager;


/// Try to connect to the daemon's named pipe.
/// Returns the pipe as a std::fs::File on success.
fn connect_to_daemon() -> Result<std::fs::File, String> {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;

    // Try to open the pipe
    match OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(0) // FILE_FLAG_OVERLAPPED = 0 for synchronous
        .open(PIPE_NAME)
    {
        Ok(file) => Ok(file),
        Err(_) => {
    // Daemon not running — launch ourselves in --service mode
            let self_path = std::env::current_exe()
                .map_err(|e| format!("Cannot determine exe path: {e}"))?;

            eprintln!("[AuraKey GUI] Launching service: {} --service", self_path.display());

            // Launch as detached process in service mode
            let mut cmd = std::process::Command::new(&self_path);
            cmd.arg("--service")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::inherit());

            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                const DETACHED_PROCESS: u32 = 0x00000008;
                const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
                cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
            }

            cmd.spawn()
                .map_err(|e| format!("Failed to launch daemon: {e}"))?;

            // Retry connection with backoff
            for attempt in 1..=20 {
                std::thread::sleep(std::time::Duration::from_millis(150));
                match OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(PIPE_NAME)
                {
                    Ok(file) => {
                        eprintln!(
                            "[AuraKey GUI] Connected to daemon (attempt {attempt})"
                        );
                        return Ok(file);
                    }
                    Err(_) => continue,
                }
            }

            Err("Daemon launched but pipe connection timed out after 3s".to_string())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── Connect to daemon ────────────────────────────────────
    let pipe = connect_to_daemon().unwrap_or_else(|e| {
        eprintln!("[AuraKey GUI] FATAL: {e}");
        // Show error dialog (blocking)
        rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title("AuraKey")
            .set_description(&format!("Cannot connect to AuraKey daemon:\n\n{e}"))
            .show();
        std::process::exit(1);
    });

    // ── Fetch initial config from daemon ─────────────────────
    let pipe = Mutex::new(pipe);
    let initial_config = {
        let mut p = pipe.lock().unwrap();
        match ipc::send_request(&mut *p, &ipc::IpcRequest::GetConfig) {
            Ok(ipc::IpcResponse::Config { config }) => config,
            Ok(other) => {
                eprintln!("[AuraKey GUI] Unexpected response: {other:?}");
                AppConfig::default()
            }
            Err(e) => {
                eprintln!("[AuraKey GUI] Failed to get config: {e}");
                AppConfig::default()
            }
        }
    };

    // ── Recorder channels (local to GUI) ─────────────────────
    let (recorder_cmd_tx, recorder_cmd_rx) = unbounded();
    let (recorder_result_tx, recorder_result_rx) = unbounded();

    // ── Spawn recorder thread ────────────────────────────────
    {
        let mouse_ms = initial_config.settings.mouse_accumulate_ms;
        let max_secs = initial_config.settings.max_recording_secs;
        std::thread::Builder::new()
            .name("recorder".into())
            .spawn(move || {
                let mut engine = recorder::RecordingEngine::new(
                    recorder_cmd_rx,
                    recorder_result_tx,
                    mouse_ms,
                    max_secs,
                );
                engine.run();
            })
            .expect("Failed to spawn recorder thread");
    }

    // ── Build Tauri app ──────────────────────────────────────
    let app_state = AppState {
        config: Mutex::new(initial_config),
        pipe,
        recorder_cmd_tx,
        recorder_result_rx: Mutex::new(recorder_result_rx),
    };

    // ── Check if should start minimized (only via CLI flag from autostart) ──
    let start_minimized = std::env::args().any(|a| a == "--minimized");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::save_settings,
            commands::set_active_profile,
            commands::create_profile,
            commands::delete_profile,
            commands::rename_profile,
            commands::create_macro,
            commands::create_group,
            commands::update_macro,
            commands::delete_macro,
            commands::toggle_group,
            commands::toggle_macro_enabled,
            commands::move_macro,
            commands::toggle_pause,
            commands::cancel_all,
            commands::get_daemon_events,
            commands::start_recording,
            commands::stop_recording,
            commands::get_recording_result,
            commands::import_macros,
            commands::export_profile,
            commands::export_macro,
            commands::arduino_connect,
            commands::arduino_disconnect,
            commands::arduino_ping,
            commands::arduino_is_connected,
            commands::arduino_port_name,
            commands::arduino_list_ports,
            commands::vk_name,
            commands::detect_conflicts,
            commands::save_firmware,
            commands::open_config_dir,
            commands::get_screen_resolution,
            commands::pick_coordinate,
            commands::list_installed_programs,
            commands::browse_program,
            commands::set_autostart,
            commands::get_autostart,
        ])
        .setup(move |app| {
            if start_minimized {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        // No on_window_event close prevention — GUI actually exits
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
