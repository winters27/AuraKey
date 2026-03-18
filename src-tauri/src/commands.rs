//! Tauri Commands — Bridge between frontend and daemon via IPC
//!
//! Each `#[tauri::command]` sends an IPC request to the daemon over the
//! named pipe and returns the response. Recorder commands stay local.

use crate::config::{self, AppConfig, MacroDef};
use crate::ipc::{self, IpcRequest, IpcResponse};
use crate::recorder::RecorderCommand;
use crate::state::AppState;
use serde_json::Value;
use tauri::State;

// ========================================================================
// IPC Helper
// ========================================================================

/// Send an IPC request to the daemon and expect a specific response shape.
fn ipc_call(state: &AppState, request: IpcRequest) -> Result<IpcResponse, String> {
    let mut pipe = state.pipe.lock().map_err(|e| e.to_string())?;
    ipc::send_request(&mut *pipe, &request).map_err(|e| format!("IPC error: {e}"))
}

/// Send an IPC request that returns a full config, update local cache.
fn ipc_config_call(state: &AppState, request: IpcRequest) -> Result<AppConfig, String> {
    let response = ipc_call(state, request)?;
    match response {
        IpcResponse::Config { config } => {
            *state.config.lock().map_err(|e| e.to_string())? = config.clone();
            Ok(config)
        }
        IpcResponse::Error { message } => Err(message),
        other => Err(format!("Unexpected response: {other:?}")),
    }
}

/// Send an IPC request that returns Ok.
fn ipc_ok_call(state: &AppState, request: IpcRequest) -> Result<(), String> {
    let response = ipc_call(state, request)?;
    match response {
        IpcResponse::Ok => Ok(()),
        IpcResponse::Error { message } => Err(message),
        other => Err(format!("Unexpected response: {other:?}")),
    }
}

// ========================================================================
// Config Commands
// ========================================================================

/// Return the full config (from daemon).
#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    ipc_config_call(&state, IpcRequest::GetConfig)
}

/// Save entire config to disk and reload daemon.
#[tauri::command]
pub fn save_config(state: State<'_, AppState>, config: AppConfig) -> Result<(), String> {
    ipc_ok_call(&state, IpcRequest::SaveConfig { config })
}

/// Save only settings to disk — no daemon reload needed.
#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: config::AppSettings) -> Result<(), String> {
    ipc_ok_call(&state, IpcRequest::SaveSettings { settings })
}

/// Set the active profile by name.
#[tauri::command]
pub fn set_active_profile(state: State<'_, AppState>, name: String) -> Result<(), String> {
    ipc_ok_call(&state, IpcRequest::SetActiveProfile { name })
}

/// Create a new empty profile and switch to it.
#[tauri::command]
pub fn create_profile(state: State<'_, AppState>, name: String) -> Result<AppConfig, String> {
    ipc_config_call(&state, IpcRequest::CreateProfile { name })
}

/// Delete a profile by name.
#[tauri::command]
pub fn delete_profile(state: State<'_, AppState>, name: String) -> Result<AppConfig, String> {
    ipc_config_call(&state, IpcRequest::DeleteProfile { name })
}

/// Rename an existing profile.
#[tauri::command]
pub fn rename_profile(state: State<'_, AppState>, old_name: String, new_name: String) -> Result<AppConfig, String> {
    ipc_config_call(&state, IpcRequest::RenameProfile { old_name, new_name })
}

// ========================================================================
// Macro CRUD Commands
// ========================================================================

/// Create a new macro in the specified group.
#[tauri::command]
pub fn create_macro(
    state: State<'_, AppState>,
    group_idx: usize,
    name: String,
) -> Result<AppConfig, String> {
    ipc_config_call(&state, IpcRequest::CreateMacro { group_idx, name })
}

/// Create a new group.
#[tauri::command]
pub fn create_group(state: State<'_, AppState>, name: String) -> Result<AppConfig, String> {
    ipc_config_call(&state, IpcRequest::CreateGroup { name })
}

/// Update a macro definition at the given group + macro index.
#[tauri::command]
pub fn update_macro(
    state: State<'_, AppState>,
    group_idx: usize,
    macro_idx: usize,
    macro_def: MacroDef,
) -> Result<AppConfig, String> {
    ipc_config_call(&state, IpcRequest::UpdateMacro { group_idx, macro_idx, macro_def })
}

/// Delete a macro at the given group + macro index.
#[tauri::command]
pub fn delete_macro(
    state: State<'_, AppState>,
    group_idx: usize,
    macro_idx: usize,
) -> Result<AppConfig, String> {
    ipc_config_call(&state, IpcRequest::DeleteMacro { group_idx, macro_idx })
}

/// Toggle group enabled state.
#[tauri::command]
pub fn toggle_group(
    state: State<'_, AppState>,
    group_idx: usize,
    enabled: bool,
) -> Result<AppConfig, String> {
    ipc_config_call(&state, IpcRequest::ToggleGroup { group_idx, enabled })
}

/// Toggle macro enabled state.
#[tauri::command]
pub fn toggle_macro_enabled(
    state: State<'_, AppState>,
    group_idx: usize,
    macro_idx: usize,
    enabled: bool,
) -> Result<AppConfig, String> {
    ipc_config_call(&state, IpcRequest::ToggleMacroEnabled { group_idx, macro_idx, enabled })
}

/// Move a macro from one group to another.
#[tauri::command]
pub fn move_macro(
    state: State<'_, AppState>,
    from_group: usize,
    from_idx: usize,
    to_group: usize,
) -> Result<AppConfig, String> {
    ipc_config_call(&state, IpcRequest::MoveMacro { from_group, from_idx, to_group })
}

// ========================================================================
// Daemon Control Commands
// ========================================================================

/// Pause or resume the daemon.
#[tauri::command]
pub fn toggle_pause(state: State<'_, AppState>) -> Result<bool, String> {
    let response = ipc_call(&state, IpcRequest::TogglePause)?;
    match response {
        IpcResponse::Bool { value } => Ok(value),
        IpcResponse::Error { message } => Err(message),
        other => Err(format!("Unexpected response: {other:?}")),
    }
}

/// Cancel all running macros.
#[tauri::command]
pub fn cancel_all(state: State<'_, AppState>) -> Result<(), String> {
    ipc_ok_call(&state, IpcRequest::CancelAll)
}

/// Poll daemon events (non-blocking, returns all pending events).
#[tauri::command]
pub fn get_daemon_events(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let response = ipc_call(&state, IpcRequest::PollEvents)?;
    match response {
        IpcResponse::Events { events } => {
            let values: Vec<Value> = events.iter()
                .map(|e| serde_json::to_value(e).unwrap_or_default())
                .collect();
            Ok(values)
        }
        IpcResponse::Error { message } => Err(message),
        other => Err(format!("Unexpected response: {other:?}")),
    }
}

// ========================================================================
// Recording Commands (Local — stays in GUI process)
// ========================================================================

/// Start recording macro input.
#[tauri::command]
pub fn start_recording(state: State<'_, AppState>, stop_key: u32) -> Result<(), String> {
    let _ = state.recorder_cmd_tx.send(RecorderCommand::Start { stop_key });
    Ok(())
}

/// Stop recording.
#[tauri::command]
pub fn stop_recording(state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.recorder_cmd_tx.send(RecorderCommand::Stop);
    Ok(())
}

/// Poll for recording result (non-blocking).
#[tauri::command]
pub fn get_recording_result(state: State<'_, AppState>) -> Result<Option<Value>, String> {
    let rx = state.recorder_result_rx.lock().map_err(|e| e.to_string())?;
    match rx.try_recv() {
        Ok(result) => Ok(Some(serde_json::to_value(&result).unwrap_or_default())),
        Err(_) => Ok(None),
    }
}

// ========================================================================
// Import / Export Commands
// ========================================================================

/// Import macros from a file path.
#[tauri::command]
pub fn import_macros(state: State<'_, AppState>, path: String, group_idx: usize) -> Result<AppConfig, String> {
    ipc_config_call(&state, IpcRequest::ImportMacros { path, group_idx })
}

/// Export the active profile to a file path.
#[tauri::command]
pub fn export_profile(state: State<'_, AppState>, path: String) -> Result<(), String> {
    ipc_ok_call(&state, IpcRequest::ExportProfile { path })
}

/// Export a single macro to a file path.
#[tauri::command]
pub fn export_macro(state: State<'_, AppState>, group_idx: usize, macro_idx: usize, path: String) -> Result<(), String> {
    ipc_ok_call(&state, IpcRequest::ExportMacro { group_idx, macro_idx, path })
}

// ========================================================================
// Arduino Commands (proxied to daemon)
// ========================================================================

/// Connect to Arduino on the given COM port.
#[tauri::command]
pub fn arduino_connect(state: State<'_, AppState>, port: String) -> Result<String, String> {
    let response = ipc_call(&state, IpcRequest::ArduinoConnect { port })?;
    match response {
        IpcResponse::Str { value } => Ok(value),
        IpcResponse::Error { message } => Err(message),
        other => Err(format!("Unexpected response: {other:?}")),
    }
}

/// Disconnect from Arduino.
#[tauri::command]
pub fn arduino_disconnect(state: State<'_, AppState>) -> Result<(), String> {
    ipc_ok_call(&state, IpcRequest::ArduinoDisconnect)
}

/// Ping the Arduino and return latency.
#[tauri::command]
pub fn arduino_ping(state: State<'_, AppState>) -> Result<u64, String> {
    let response = ipc_call(&state, IpcRequest::ArduinoPing)?;
    match response {
        IpcResponse::Latency { ms } => Ok(ms),
        IpcResponse::Error { message } => Err(message),
        other => Err(format!("Unexpected response: {other:?}")),
    }
}

/// Check if Arduino is connected.
#[tauri::command]
pub fn arduino_is_connected(state: State<'_, AppState>) -> Result<bool, String> {
    let response = ipc_call(&state, IpcRequest::ArduinoIsConnected)?;
    match response {
        IpcResponse::Bool { value } => Ok(value),
        IpcResponse::Error { message } => Err(message),
        other => Err(format!("Unexpected response: {other:?}")),
    }
}

/// Get Arduino port name.
#[tauri::command]
pub fn arduino_port_name(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let response = ipc_call(&state, IpcRequest::ArduinoPortName)?;
    match response {
        IpcResponse::OptStr { value } => Ok(value),
        IpcResponse::Error { message } => Err(message),
        other => Err(format!("Unexpected response: {other:?}")),
    }
}

/// List available serial (COM) ports.
#[tauri::command]
pub fn arduino_list_ports(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let response = ipc_call(&state, IpcRequest::ArduinoListPorts)?;
    match response {
        IpcResponse::StringList { values } => Ok(values),
        IpcResponse::Error { message } => Err(message),
        other => Err(format!("Unexpected response: {other:?}")),
    }
}

// ========================================================================
// Utility Commands
// ========================================================================

/// Get VK name for a given code. (Local — no IPC needed)
#[tauri::command]
pub fn vk_name(vk: u32) -> String {
    config::vk_name(vk).to_string()
}

/// Detect conflicts in the current config.
#[tauri::command]
pub fn detect_conflicts(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let response = ipc_call(&state, IpcRequest::DetectConflicts)?;
    match response {
        IpcResponse::Conflicts { warnings } => Ok(warnings),
        IpcResponse::Error { message } => Err(message),
        other => Err(format!("Unexpected response: {other:?}")),
    }
}

/// Save the AuraHID firmware to a path and reveal it in Explorer.
#[tauri::command]
pub fn save_firmware(path: String) -> Result<(), String> {
    let firmware = include_bytes!("../assets/AuraHID_v3.ino");
    std::fs::write(&path, firmware).map_err(|e| e.to_string())?;
    // Reveal in Explorer with the file selected
    let _ = std::process::Command::new("explorer")
        .arg(format!("/select,{}", path))
        .spawn();
    Ok(())
}

/// Open config directory in file explorer.
#[tauri::command]
pub fn open_config_dir(state: State<'_, AppState>) -> Result<(), String> {
    ipc_ok_call(&state, IpcRequest::OpenConfigDir)
}

// ========================================================================
// Coordinate Picker Commands (Local — needs GUI window)
// ========================================================================

/// Get primary screen resolution (logical pixels).
#[tauri::command]
pub fn get_screen_resolution() -> Result<(i32, i32), String> {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
    unsafe {
        let w = GetSystemMetrics(SM_CXSCREEN);
        let h = GetSystemMetrics(SM_CYSCREEN);
        Ok((w, h))
    }
}

/// Pick a coordinate from the screen.
#[tauri::command]
pub async fn pick_coordinate(window: tauri::Window) -> Result<(i32, i32), String> {
    use std::sync::{Arc, Mutex as StdMutex};

    let _ = window.hide();
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let result: Arc<StdMutex<Option<(i32, i32)>>> = Arc::new(StdMutex::new(None));
    let result_clone = result.clone();

    let handle = std::thread::Builder::new()
        .name("coord-picker".into())
        .spawn(move || {
            use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
            use windows::Win32::UI::WindowsAndMessaging::{
                CallNextHookEx, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx,
                HHOOK, MSG, WH_MOUSE_LL,
            };

            thread_local! {
                static COORD_RESULT: std::cell::RefCell<Option<Arc<StdMutex<Option<(i32, i32)>>>>> =
                    const { std::cell::RefCell::new(None) };
                static HOOK_HANDLE: std::cell::RefCell<Option<HHOOK>> =
                    const { std::cell::RefCell::new(None) };
            }

            COORD_RESULT.with(|r| {
                *r.borrow_mut() = Some(result_clone);
            });

            unsafe extern "system" fn hook_proc(
                code: i32,
                wparam: WPARAM,
                lparam: LPARAM,
            ) -> LRESULT {
                use windows::Win32::UI::WindowsAndMessaging::{
                    PostQuitMessage, WM_LBUTTONDOWN, GetCursorPos,
                };
                use windows::Win32::Foundation::POINT;

                if code >= 0 && wparam.0 as u32 == WM_LBUTTONDOWN {
                    let mut pt = POINT::default();
                    let _ = GetCursorPos(&mut pt);

                    COORD_RESULT.with(|r| {
                        if let Some(arc) = r.borrow().as_ref() {
                            if let Ok(mut guard) = arc.lock() {
                                *guard = Some((pt.x, pt.y));
                            }
                        }
                    });

                    PostQuitMessage(0);
                    return LRESULT(1);
                }

                HOOK_HANDLE.with(|h| {
                    let hook = h.borrow().unwrap_or(HHOOK::default());
                    CallNextHookEx(Some(hook), code, wparam, lparam)
                })
            }

            unsafe {
                let hook = SetWindowsHookExW(
                    WH_MOUSE_LL,
                    Some(hook_proc),
                    None,
                    0,
                ).expect("Failed to install mouse hook");

                HOOK_HANDLE.with(|h| {
                    *h.borrow_mut() = Some(hook);
                });

                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {}

                let _ = UnhookWindowsHookEx(hook);
            }
        })
        .map_err(|e| e.to_string())?;

    handle.join().map_err(|_| "Hook thread panicked".to_string())?;

    let _ = window.show();
    let _ = window.set_focus();

    let coords = result
        .lock()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No coordinate captured".to_string())?;

    Ok(coords)
}

// ========================================================================
// Program Discovery Commands (Local — no IPC needed)
// ========================================================================

/// An installed program entry for the Run Program step picker.
#[derive(serde::Serialize, Clone)]
pub struct InstalledProgram {
    pub name: String,
    pub path: String,
}

/// List installed programs from the Windows registry + common system utilities.
#[tauri::command]
pub fn list_installed_programs() -> Vec<InstalledProgram> {
    let mut programs: Vec<InstalledProgram> = Vec::new();

    // System utilities (always available, don't appear in registry)
    let system_utils = [
        ("Notepad", "notepad.exe"),
        ("Calculator", "calc.exe"),
        ("Command Prompt", "cmd.exe"),
        ("PowerShell", "powershell.exe"),
        ("File Explorer", "explorer.exe"),
        ("Paint", "mspaint.exe"),
        ("Task Manager", "taskmgr.exe"),
        ("Snipping Tool", "snippingtool.exe"),
    ];
    for (name, path) in &system_utils {
        programs.push(InstalledProgram {
            name: name.to_string(),
            path: path.to_string(),
        });
    }

    // Registry keys to scan
    let registry_paths = [
        (winreg::enums::HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg::enums::HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg::enums::HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];

    let mut seen = std::collections::HashSet::new();

    for (hive, path) in &registry_paths {
        let Ok(key) = winreg::RegKey::predef(*hive).open_subkey(path) else { continue };
        for subkey_name in key.enum_keys().filter_map(|k| k.ok()) {
            let Ok(subkey) = key.open_subkey(&subkey_name) else { continue };

            // Must have a display name
            let Ok(display_name) = subkey.get_value::<String, _>("DisplayName") else { continue };
            let display_name = display_name.trim().to_string();
            if display_name.is_empty() { continue; }

            // Skip duplicates
            let key_lower = display_name.to_lowercase();
            if seen.contains(&key_lower) { continue; }

            // Try to find executable path: InstallLocation → look for .exe, or DisplayIcon
            let exe_path = find_exe_from_registry(&subkey);
            if exe_path.is_empty() { continue; }

            seen.insert(key_lower);
            programs.push(InstalledProgram {
                name: display_name,
                path: exe_path,
            });
        }
    }

    // Sort alphabetically (system utils stay at top by virtue of being first)
    let system_count = system_utils.len();
    programs[system_count..].sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    programs
}

/// Try to extract an executable path from a registry Uninstall subkey.
fn find_exe_from_registry(subkey: &winreg::RegKey) -> String {
    // 1. Try DisplayIcon (often points directly to the .exe)
    if let Ok(icon) = subkey.get_value::<String, _>("DisplayIcon") {
        let icon = icon.trim_matches('"').trim();
        // Strip icon index suffix like ",0"
        let clean = if let Some(comma) = icon.rfind(',') {
            let after = &icon[comma + 1..];
            if after.trim().chars().all(|c| c.is_ascii_digit()) {
                icon[..comma].trim()
            } else {
                icon
            }
        } else {
            icon
        };
        if clean.to_lowercase().ends_with(".exe") && std::path::Path::new(clean).exists() {
            return clean.to_string();
        }
    }

    // 2. Try InstallLocation + scan for a single .exe
    if let Ok(install_loc) = subkey.get_value::<String, _>("InstallLocation") {
        let loc = install_loc.trim().trim_matches('"');
        if !loc.is_empty() {
            let dir = std::path::Path::new(loc);
            if dir.is_dir() {
                // Look for .exe files in the root of the install dir
                if let Ok(entries) = std::fs::read_dir(dir) {
                    let exes: Vec<_> = entries
                        .filter_map(|e| e.ok())
                        .filter(|e| {
                            e.path().extension().map_or(false, |ext| ext.eq_ignore_ascii_case("exe"))
                                && !e.file_name().to_string_lossy().to_lowercase().contains("unins")
                                && !e.file_name().to_string_lossy().to_lowercase().contains("update")
                        })
                        .collect();
                    if exes.len() == 1 {
                        return exes[0].path().to_string_lossy().to_string();
                    }
                }
            }
        }
    }

    String::new()
}

/// Open a native file picker to browse for an executable.
#[tauri::command]
pub fn browse_program() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Select Program")
        .add_filter("Executables", &["exe", "bat", "cmd", "ps1", "com"])
        .add_filter("All Files", &["*"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

// ========================================================================
// Autostart Commands (Local — registry access)
// ========================================================================

const AUTOSTART_REG_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
const AUTOSTART_VALUE_NAME: &str = "AuraKey";

/// Set or remove the Windows auto-start registry entry.
#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(AUTOSTART_REG_KEY)
        .map_err(|e| format!("Failed to open Run key: {e}"))?;

    if enabled {
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Cannot determine exe path: {e}"))?;
        // Quote the path and add --minimized flag so it starts to tray
        let value = format!("\"{}\" --minimized", exe_path.display());
        key.set_value(AUTOSTART_VALUE_NAME, &value)
            .map_err(|e| format!("Failed to set registry value: {e}"))?;
    } else {
        // Ignore error if key doesn't exist
        let _ = key.delete_value(AUTOSTART_VALUE_NAME);
    }

    Ok(())
}

/// Check if the auto-start registry entry exists.
#[tauri::command]
pub fn get_autostart() -> Result<bool, String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey(AUTOSTART_REG_KEY)
        .map_err(|e| format!("Failed to open Run key: {e}"))?;

    Ok(key.get_value::<String, _>(AUTOSTART_VALUE_NAME).is_ok())
}
