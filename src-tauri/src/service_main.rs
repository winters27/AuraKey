//! AuraKey Daemon — Background Service Mode
//!
//! Pure Rust service (no Tauri/webview). Runs the hotkey daemon, tray icon,
//! Arduino HID, and a named pipe IPC server for the GUI.
//!
//! Invoked via `aurakey.exe --service`

use crate::config::{self, AppConfig, MacroDef, MacroGroup, Profile};
use crate::daemon::{DaemonCommand, DaemonEvent};
use crate::ipc::{self, IpcRequest, IpcResponse, PIPE_NAME};
use crate::tray_win32;
use crate::{arduino, input};
use crossbeam_channel::{unbounded, Receiver, Sender};
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

// ========================================================================
// IPC Server
// ========================================================================

/// Run the IPC pipe server on a dedicated thread.
/// Listens for one client at a time, processes requests, and bridges
/// daemon commands via crossbeam channels.
fn run_ipc_server(
    config: Arc<Mutex<AppConfig>>,
    daemon_cmd_tx: Sender<DaemonCommand>,
    daemon_event_rx: Arc<Mutex<Receiver<DaemonEvent>>>,
    paused: Arc<AtomicBool>,
) {
    use windows::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
    use windows::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe,
        PIPE_TYPE_BYTE, PIPE_READMODE_BYTE, PIPE_WAIT,
    };
    use windows::core::PCWSTR;

    // PIPE_ACCESS_DUPLEX = 0x00000003
    const PIPE_ACCESS_DUPLEX: u32 = 0x00000003;

    let pipe_name_wide: Vec<u16> = PIPE_NAME.encode_utf16().chain(std::iter::once(0)).collect();

    loop {
        // Create a new pipe instance for each client
        let pipe = unsafe {
            CreateNamedPipeW(
                PCWSTR(pipe_name_wide.as_ptr()),
                windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES(PIPE_ACCESS_DUPLEX),
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                255,        // max instances (allow immediate re-creation)
                4096,       // out buffer
                4096,       // in buffer
                0,          // default timeout
                None,       // default security
            )
        };

        if pipe == INVALID_HANDLE_VALUE {
            eprintln!("[AuraKey] Failed to create pipe: {}", io::Error::last_os_error());
            std::thread::sleep(std::time::Duration::from_secs(1));
            continue;
        }

        // Wait for a client to connect
        let connected = unsafe { ConnectNamedPipe(pipe, None) };
        if connected.is_err() {
            // ERROR_PIPE_CONNECTED (535) means client connected between Create and Connect — that's OK
            let err = io::Error::last_os_error();
            if err.raw_os_error() != Some(535) {
                eprintln!("[AuraKey] ConnectNamedPipe failed: {err}");
                unsafe {
                    let _ = windows::Win32::Foundation::CloseHandle(pipe);
                }
                continue;
            }
        }

        eprintln!("[AuraKey] GUI connected via pipe");

        // Wrap the HANDLE in a Read+Write adapter
        let mut pipe_io = PipeStream(pipe);

        // Process requests until client disconnects
        loop {
            match ipc::read_request(&mut pipe_io) {
                Ok(request) => {
                    let response = handle_ipc_request(
                        request,
                        &config,
                        &daemon_cmd_tx,
                        &daemon_event_rx,
                        &paused,
                    );
                    if let Err(e) = ipc::write_response(&mut pipe_io, &response) {
                        eprintln!("[AuraKey] Write response failed: {e}");
                        break;
                    }
                }
                Err(e) => {
                    if e.kind() == io::ErrorKind::BrokenPipe
                        || e.kind() == io::ErrorKind::UnexpectedEof
                    {
                        eprintln!("[AuraKey] GUI disconnected");
                    } else {
                        eprintln!("[AuraKey] Read request failed: {e}");
                    }
                    break;
                }
            }
        }

        // Disconnect and loop back to accept a new client
        unsafe {
            let _ = DisconnectNamedPipe(pipe);
            let _ = windows::Win32::Foundation::CloseHandle(pipe);
        }
    }
}

/// HANDLE → Read + Write adapter.
struct PipeStream(windows::Win32::Foundation::HANDLE);

impl io::Read for PipeStream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        use windows::Win32::Storage::FileSystem::ReadFile;
        let mut bytes_read = 0u32;
        unsafe {
            ReadFile(self.0, Some(buf), Some(&mut bytes_read), None)
                .map_err(|e| io::Error::new(io::ErrorKind::BrokenPipe, e.to_string()))?;
        }
        if bytes_read == 0 {
            Err(io::Error::new(io::ErrorKind::UnexpectedEof, "pipe closed"))
        } else {
            Ok(bytes_read as usize)
        }
    }
}

impl io::Write for PipeStream {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        use windows::Win32::Storage::FileSystem::WriteFile;
        let mut bytes_written = 0u32;
        unsafe {
            WriteFile(self.0, Some(buf), Some(&mut bytes_written), None)
                .map_err(|e| io::Error::new(io::ErrorKind::BrokenPipe, e.to_string()))?;
        }
        Ok(bytes_written as usize)
    }

    fn flush(&mut self) -> io::Result<()> {
        use windows::Win32::Storage::FileSystem::FlushFileBuffers;
        unsafe {
            FlushFileBuffers(self.0)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        }
        Ok(())
    }
}

// ========================================================================
// Request Handler
// ========================================================================

fn handle_ipc_request(
    request: IpcRequest,
    config: &Arc<Mutex<AppConfig>>,
    daemon_cmd_tx: &Sender<DaemonCommand>,
    daemon_event_rx: &Arc<Mutex<Receiver<DaemonEvent>>>,
    paused: &Arc<AtomicBool>,
) -> IpcResponse {
    match request {
        IpcRequest::GetConfig => {
            let cfg = config.lock().unwrap().clone();
            IpcResponse::Config { config: cfg }
        }
        IpcRequest::SaveConfig { config: new_config } => {
            if let Err(e) = config::save_config(&new_config) {
                return IpcResponse::Error { message: e.to_string() };
            }
            let profile = find_active_profile(&new_config);
            let _ = daemon_cmd_tx.send(DaemonCommand::Reload(profile));
            tray_win32::update_profiles(&new_config.profiles, &new_config.active_profile);
            *config.lock().unwrap() = new_config;
            IpcResponse::Ok
        }
        IpcRequest::SaveSettings { settings } => {
            let mut cfg = config.lock().unwrap();
            cfg.settings = settings;
            if let Err(e) = config::save_config(&cfg) {
                return IpcResponse::Error { message: e.to_string() };
            }
            IpcResponse::Ok
        }
        IpcRequest::SetActiveProfile { name } => {
            let mut cfg = config.lock().unwrap();
            cfg.active_profile = name.clone();
            if let Err(e) = config::save_config(&cfg) {
                return IpcResponse::Error { message: e.to_string() };
            }
            let profile = cfg.profiles.iter()
                .find(|p| p.name == name)
                .cloned()
                .unwrap_or_else(|| Profile::new("Default"));
            let _ = daemon_cmd_tx.send(DaemonCommand::Reload(profile));
            tray_win32::update_profiles(&cfg.profiles, &cfg.active_profile);
            IpcResponse::Ok
        }
        IpcRequest::CreateProfile { name } => {
            let mut cfg = config.lock().unwrap();
            if cfg.profiles.iter().any(|p| p.name == name) {
                return IpcResponse::Error { message: format!("Profile '{}' already exists", name) };
            }
            let profile = Profile::new(&name);
            cfg.profiles.push(profile.clone());
            cfg.active_profile = name;
            if let Err(e) = config::save_config(&cfg) {
                return IpcResponse::Error { message: e.to_string() };
            }
            let _ = daemon_cmd_tx.send(DaemonCommand::Reload(profile));
            tray_win32::update_profiles(&cfg.profiles, &cfg.active_profile);
            IpcResponse::Config { config: cfg.clone() }
        }
        IpcRequest::DeleteProfile { name } => {
            let mut cfg = config.lock().unwrap();
            if cfg.profiles.len() <= 1 {
                return IpcResponse::Error { message: "Cannot delete the last profile".into() };
            }
            cfg.profiles.retain(|p| p.name != name);
            if cfg.active_profile == name {
                let fallback = cfg.profiles.first().map(|p| p.name.clone()).unwrap_or_default();
                cfg.active_profile = fallback.clone();
                if let Some(p) = cfg.profiles.iter().find(|p| p.name == fallback).cloned() {
                    let _ = daemon_cmd_tx.send(DaemonCommand::Reload(p));
                }
            }
            if let Err(e) = config::save_config(&cfg) {
                return IpcResponse::Error { message: e.to_string() };
            }
            tray_win32::update_profiles(&cfg.profiles, &cfg.active_profile);
            IpcResponse::Config { config: cfg.clone() }
        }
        IpcRequest::RenameProfile { old_name, new_name } => {
            let mut cfg = config.lock().unwrap();
            if cfg.profiles.iter().any(|p| p.name == new_name) {
                return IpcResponse::Error { message: format!("Profile '{}' already exists", new_name) };
            }
            if let Some(p) = cfg.profiles.iter_mut().find(|p| p.name == old_name) {
                p.name = new_name.clone();
            } else {
                return IpcResponse::Error { message: format!("Profile '{}' not found", old_name) };
            }
            if cfg.active_profile == old_name {
                cfg.active_profile = new_name;
            }
            if let Err(e) = config::save_config(&cfg) {
                return IpcResponse::Error { message: e.to_string() };
            }
            tray_win32::update_profiles(&cfg.profiles, &cfg.active_profile);
            IpcResponse::Config { config: cfg.clone() }
        }
        IpcRequest::CreateMacro { group_idx, name } => {
            let mut cfg = config.lock().unwrap();
            match active_profile_mut(&mut cfg) {
                Ok(profile) => {
                    if group_idx >= profile.groups.len() {
                        return IpcResponse::Error { message: "Group index out of bounds".into() };
                    }
                    profile.groups[group_idx].macros.push(MacroDef::new(name));
                }
                Err(e) => return IpcResponse::Error { message: e },
            }
            if let Err(e) = config::save_config(&cfg) {
                return IpcResponse::Error { message: e.to_string() };
            }
            reload_daemon(&cfg, daemon_cmd_tx);
            IpcResponse::Config { config: cfg.clone() }
        }
        IpcRequest::CreateGroup { name } => {
            let mut cfg = config.lock().unwrap();
            match active_profile_mut(&mut cfg) {
                Ok(profile) => profile.groups.push(MacroGroup::new(name)),
                Err(e) => return IpcResponse::Error { message: e },
            }
            if let Err(e) = config::save_config(&cfg) {
                return IpcResponse::Error { message: e.to_string() };
            }
            reload_daemon(&cfg, daemon_cmd_tx);
            IpcResponse::Config { config: cfg.clone() }
        }
        IpcRequest::UpdateMacro { group_idx, macro_idx, macro_def } => {
            let mut cfg = config.lock().unwrap();
            match active_profile_mut(&mut cfg) {
                Ok(profile) => {
                    if group_idx >= profile.groups.len() || macro_idx >= profile.groups[group_idx].macros.len() {
                        return IpcResponse::Error { message: "Index out of bounds".into() };
                    }
                    profile.groups[group_idx].macros[macro_idx] = macro_def;
                }
                Err(e) => return IpcResponse::Error { message: e },
            }
            if let Err(e) = config::save_config(&cfg) {
                return IpcResponse::Error { message: e.to_string() };
            }
            reload_daemon(&cfg, daemon_cmd_tx);
            IpcResponse::Config { config: cfg.clone() }
        }
        IpcRequest::DeleteMacro { group_idx, macro_idx } => {
            let mut cfg = config.lock().unwrap();
            match active_profile_mut(&mut cfg) {
                Ok(profile) => {
                    if group_idx >= profile.groups.len() || macro_idx >= profile.groups[group_idx].macros.len() {
                        return IpcResponse::Error { message: "Index out of bounds".into() };
                    }
                    profile.groups[group_idx].macros.remove(macro_idx);
                }
                Err(e) => return IpcResponse::Error { message: e },
            }
            if let Err(e) = config::save_config(&cfg) {
                return IpcResponse::Error { message: e.to_string() };
            }
            reload_daemon(&cfg, daemon_cmd_tx);
            IpcResponse::Config { config: cfg.clone() }
        }
        IpcRequest::ToggleGroup { group_idx, enabled } => {
            let mut cfg = config.lock().unwrap();
            match active_profile_mut(&mut cfg) {
                Ok(profile) => {
                    if group_idx >= profile.groups.len() {
                        return IpcResponse::Error { message: "Group index out of bounds".into() };
                    }
                    profile.groups[group_idx].enabled = enabled;
                }
                Err(e) => return IpcResponse::Error { message: e },
            }
            if let Err(e) = config::save_config(&cfg) {
                return IpcResponse::Error { message: e.to_string() };
            }
            reload_daemon(&cfg, daemon_cmd_tx);
            IpcResponse::Config { config: cfg.clone() }
        }
        IpcRequest::ToggleMacroEnabled { group_idx, macro_idx, enabled } => {
            let mut cfg = config.lock().unwrap();
            match active_profile_mut(&mut cfg) {
                Ok(profile) => {
                    if group_idx >= profile.groups.len() || macro_idx >= profile.groups[group_idx].macros.len() {
                        return IpcResponse::Error { message: "Index out of bounds".into() };
                    }
                    profile.groups[group_idx].macros[macro_idx].enabled = enabled;
                }
                Err(e) => return IpcResponse::Error { message: e },
            }
            if let Err(e) = config::save_config(&cfg) {
                return IpcResponse::Error { message: e.to_string() };
            }
            reload_daemon(&cfg, daemon_cmd_tx);
            IpcResponse::Config { config: cfg.clone() }
        }
        IpcRequest::MoveMacro { from_group, from_idx, to_group } => {
            let mut cfg = config.lock().unwrap();
            match active_profile_mut(&mut cfg) {
                Ok(profile) => {
                    if from_group >= profile.groups.len() || to_group >= profile.groups.len() {
                        return IpcResponse::Error { message: "Group index out of bounds".into() };
                    }
                    if from_idx >= profile.groups[from_group].macros.len() {
                        return IpcResponse::Error { message: "Macro index out of bounds".into() };
                    }
                    let m = profile.groups[from_group].macros.remove(from_idx);
                    profile.groups[to_group].macros.push(m);
                }
                Err(e) => return IpcResponse::Error { message: e },
            }
            if let Err(e) = config::save_config(&cfg) {
                return IpcResponse::Error { message: e.to_string() };
            }
            reload_daemon(&cfg, daemon_cmd_tx);
            IpcResponse::Config { config: cfg.clone() }
        }
        IpcRequest::ImportMacros { path, group_idx } => {
            let macros = match config::import_macros(std::path::Path::new(&path)) {
                Ok(m) => m,
                Err(e) => return IpcResponse::Error { message: e.to_string() },
            };
            let mut cfg = config.lock().unwrap();
            match active_profile_mut(&mut cfg) {
                Ok(profile) => {
                    if profile.groups.is_empty() {
                        profile.groups.push(MacroGroup::new("Imported"));
                    }
                    let target = if group_idx < profile.groups.len() { group_idx } else { 0 };
                    profile.groups[target].macros.extend(macros);
                }
                Err(e) => return IpcResponse::Error { message: e },
            }
            if let Err(e) = config::save_config(&cfg) {
                return IpcResponse::Error { message: e.to_string() };
            }
            reload_daemon(&cfg, daemon_cmd_tx);
            IpcResponse::Config { config: cfg.clone() }
        }
        IpcRequest::ExportProfile { path } => {
            let cfg = config.lock().unwrap();
            let profile = find_active_profile(&cfg);
            if let Err(e) = config::export_profile(&profile, std::path::Path::new(&path)) {
                return IpcResponse::Error { message: e.to_string() };
            }
            IpcResponse::Ok
        }
        IpcRequest::ExportMacro { group_idx, macro_idx, path } => {
            let cfg = config.lock().unwrap();
            let profile = find_active_profile(&cfg);
            if group_idx >= profile.groups.len() || macro_idx >= profile.groups[group_idx].macros.len() {
                return IpcResponse::Error { message: "Index out of bounds".into() };
            }
            let macro_def = &profile.groups[group_idx].macros[macro_idx];
            if let Err(e) = config::export_macros(&[macro_def.clone()], std::path::Path::new(&path)) {
                return IpcResponse::Error { message: e.to_string() };
            }
            IpcResponse::Ok
        }
        IpcRequest::TogglePause => {
            let was_paused = paused.load(Ordering::Relaxed);
            let now_paused = !was_paused;
            paused.store(now_paused, Ordering::Relaxed);
            let cmd = if now_paused {
                DaemonCommand::Pause
            } else {
                DaemonCommand::Resume
            };
            let _ = daemon_cmd_tx.send(cmd);
            IpcResponse::Bool { value: now_paused }
        }
        IpcRequest::CancelAll => {
            let _ = daemon_cmd_tx.send(DaemonCommand::CancelAll);
            input::release_all_held_keys();
            IpcResponse::Ok
        }
        IpcRequest::PollEvents => {
            let rx = daemon_event_rx.lock().unwrap();
            let mut events = Vec::new();
            while let Ok(event) = rx.try_recv() {
                events.push(event);
            }
            IpcResponse::Events { events }
        }
        IpcRequest::DetectConflicts => {
            let cfg = config.lock().unwrap();
            let profile = cfg.profiles.iter()
                .find(|p| p.name == cfg.active_profile)
                .unwrap_or_else(|| cfg.profiles.first().unwrap());
            let warnings = config::detect_conflicts(profile);
            let values: Vec<serde_json::Value> = warnings.iter()
                .map(|w| serde_json::to_value(w).unwrap_or_default())
                .collect();
            IpcResponse::Conflicts { warnings: values }
        }
        IpcRequest::VkName { vk } => {
            IpcResponse::Str { value: config::vk_name(vk).to_string() }
        }
        IpcRequest::OpenConfigDir => {
            let dir = config::config_dir();
            let _ = std::process::Command::new("explorer")
                .arg(dir.to_str().unwrap_or("."))
                .spawn();
            IpcResponse::Ok
        }
        IpcRequest::ArduinoConnect { port } => {
            match arduino::connect(&port) {
                Ok(_) => IpcResponse::Str { value: format!("Connected to {port}") },
                Err(e) => IpcResponse::Error { message: e.to_string() },
            }
        }
        IpcRequest::ArduinoDisconnect => {
            arduino::disconnect();
            IpcResponse::Ok
        }
        IpcRequest::ArduinoPing => {
            match arduino::ping() {
                Ok(ms) => IpcResponse::Latency { ms },
                Err(e) => IpcResponse::Error { message: e.to_string() },
            }
        }
        IpcRequest::ArduinoIsConnected => {
            IpcResponse::Bool { value: arduino::is_connected() }
        }
        IpcRequest::ArduinoPortName => {
            IpcResponse::OptStr { value: arduino::port_name() }
        }
        IpcRequest::ArduinoListPorts => {
            let ports: Vec<String> = arduino::list_ports()
                .iter()
                .map(|p| arduino::port_label(p))
                .collect();
            IpcResponse::StringList { values: ports }
        }
        IpcRequest::Shutdown => {
            let _ = daemon_cmd_tx.send(DaemonCommand::Shutdown);
            IpcResponse::Ok
        }
    }
}

// ========================================================================
// Helpers
// ========================================================================

fn find_active_profile(config: &AppConfig) -> Profile {
    config.profiles.iter()
        .find(|p| p.name == config.active_profile)
        .cloned()
        .unwrap_or_else(|| {
            config.profiles.first().cloned().unwrap_or_else(|| Profile::new("Default"))
        })
}

fn active_profile_mut(config: &mut AppConfig) -> Result<&mut Profile, String> {
    let name = config.active_profile.clone();
    config.profiles.iter_mut()
        .find(|p| p.name == name)
        .ok_or_else(|| "Active profile not found".to_string())
}

fn reload_daemon(config: &AppConfig, daemon_cmd_tx: &Sender<DaemonCommand>) {
    let profile = find_active_profile(config);
    let _ = daemon_cmd_tx.send(DaemonCommand::Reload(profile));
}

// ========================================================================
// Main
// ========================================================================

pub fn run_service() {
    eprintln!("[AuraKey] Starting...");

    // ── Panic hook: release all held keys ────────────────────
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        eprintln!("[AuraKey PANIC] Releasing all held keys...");
        input::release_all_held_keys();
        default_hook(info);
    }));

    // ── Load config ──────────────────────────────────────────
    let config = config::load_config().unwrap_or_else(|e| {
        eprintln!("[AuraKey] Failed to load config: {e}, using defaults");
        AppConfig::default()
    });

    let initial_profile = find_active_profile(&config);
    let profiles_snapshot: Vec<Profile> = config.profiles.clone();
    let active_name = config.active_profile.clone();

    // ── Create channels ──────────────────────────────────────
    let (daemon_cmd_tx, daemon_cmd_rx) = unbounded();
    let (daemon_event_tx, daemon_event_rx) = unbounded();

    let config = Arc::new(Mutex::new(config));
    let daemon_event_rx = Arc::new(Mutex::new(daemon_event_rx));
    let paused = Arc::new(AtomicBool::new(false));

    // ── Arduino auto-connect ─────────────────────────────────
    {
        let cfg = config.lock().unwrap();
        if cfg.settings.arduino.auto_connect && !cfg.settings.arduino.port.is_empty() {
            let port = cfg.settings.arduino.port.clone();
            if arduino::connect(&port).is_ok() {
                eprintln!("[AuraKey] Arduino connected to {port}");
            }
            arduino::start_auto_reconnect(port);
        }
    }

    // ── Initialize tray icon ─────────────────────────────────
    // Must be called on the thread that will run the message pump
    // (the daemon hook thread). We'll do it before entering run_daemon.
    {
        let cmd_tx = daemon_cmd_tx.clone();
        let evt_tx = daemon_event_tx.clone();
        let cfg_ref = config.clone();
        let daemon_cmd_tx_switch = daemon_cmd_tx.clone();

        tray_win32::init_tray(
            cmd_tx,
            evt_tx,
            &profiles_snapshot,
            &active_name,
            Box::new(move |name: &str| {
                // Profile switch from tray menu
                if let Ok(mut cfg) = cfg_ref.lock() {
                    cfg.active_profile = name.to_string();
                    let _ = config::save_config(&cfg);
                    let profile = cfg.profiles.iter()
                        .find(|p| p.name == name)
                        .cloned()
                        .unwrap_or_else(|| Profile::new("Default"));
                    let _ = daemon_cmd_tx_switch.send(DaemonCommand::Reload(profile));
                }
            }),
        );
    }

    // ── Spawn IPC server thread ──────────────────────────────
    {
        let config = config.clone();
        let cmd_tx = daemon_cmd_tx.clone();
        let event_rx = daemon_event_rx.clone();
        let paused = paused.clone();

        std::thread::Builder::new()
            .name("ipc-server".into())
            .spawn(move || {
                run_ipc_server(config, cmd_tx, event_rx, paused);
            })
            .expect("Failed to spawn IPC server thread");
    }

    eprintln!("[AuraKey] Service running. Tray icon active.");

    // ── Run daemon on this thread (has the message pump) ─────
    // This blocks until DaemonCommand::Shutdown is received.
    crate::daemon::run_daemon(daemon_cmd_rx, daemon_event_tx, initial_profile);

    // ── Cleanup ──────────────────────────────────────────────
    tray_win32::destroy_tray();
    input::release_all_held_keys();
    eprintln!("[AuraKey] Shutdown complete.");
}
