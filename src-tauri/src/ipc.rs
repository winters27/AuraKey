//! IPC Protocol — Named Pipe Communication Between Daemon & GUI
//!
//! Uses length-prefixed JSON frames over `\\.\pipe\aurakey`.
//!
//! Frame format: [4-byte LE u32 length][JSON payload]

use crate::config::{AppConfig, AppSettings, MacroDef};
use crate::daemon::DaemonEvent;
use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};

/// Named pipe path.
pub const PIPE_NAME: &str = r"\\.\pipe\aurakey";

// ========================================================================
// GUI → Daemon
// ========================================================================

/// Requests sent from the GUI to the daemon.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum IpcRequest {
    /// Get the full config.
    GetConfig,
    /// Save entire config and reload daemon.
    SaveConfig { config: AppConfig },
    /// Save only settings (no daemon reload).
    SaveSettings { settings: AppSettings },
    /// Set the active profile by name.
    SetActiveProfile { name: String },
    /// Create a new empty profile.
    CreateProfile { name: String },
    /// Delete a profile.
    DeleteProfile { name: String },
    /// Rename a profile.
    RenameProfile { old_name: String, new_name: String },
    /// Create a new macro in a group.
    CreateMacro { group_idx: usize, name: String },
    /// Create a new group.
    CreateGroup { name: String },
    /// Update a macro definition.
    UpdateMacro {
        group_idx: usize,
        macro_idx: usize,
        macro_def: MacroDef,
    },
    /// Delete a macro.
    DeleteMacro { group_idx: usize, macro_idx: usize },
    /// Toggle group enabled state.
    ToggleGroup { group_idx: usize, enabled: bool },
    /// Toggle macro enabled state.
    ToggleMacroEnabled {
        group_idx: usize,
        macro_idx: usize,
        enabled: bool,
    },
    /// Move a macro between groups.
    MoveMacro {
        from_group: usize,
        from_idx: usize,
        to_group: usize,
    },
    /// Import macros from file into a specific group.
    ImportMacros { path: String, group_idx: usize },
    /// Export active profile to file.
    ExportProfile { path: String },
    /// Export a single macro to file.
    ExportMacro { group_idx: usize, macro_idx: usize, path: String },
    /// Toggle pause/resume.
    TogglePause,
    /// Cancel all running macros.
    CancelAll,
    /// Poll daemon events.
    PollEvents,
    /// Detect trigger conflicts.
    DetectConflicts,
    /// Get VK name.
    VkName { vk: u32 },
    /// Open config directory.
    OpenConfigDir,
    // Arduino commands
    ArduinoConnect { port: String },
    ArduinoDisconnect,
    ArduinoPing,
    ArduinoIsConnected,
    ArduinoPortName,
    ArduinoListPorts,
    /// Shut down the daemon.
    Shutdown,
}

// ========================================================================
// Daemon → GUI
// ========================================================================

/// Responses sent from the daemon to the GUI.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum IpcResponse {
    /// Success with no data.
    Ok,
    /// Full config snapshot.
    Config { config: AppConfig },
    /// Boolean result.
    Bool { value: bool },
    /// String result.
    Str { value: String },
    /// Optional string result.
    OptStr { value: Option<String> },
    /// Latency in ms.
    Latency { ms: u64 },
    /// List of strings.
    StringList { values: Vec<String> },
    /// Daemon events.
    Events { events: Vec<DaemonEvent> },
    /// Conflict detection results.
    Conflicts { warnings: Vec<serde_json::Value> },
    /// Error.
    Error { message: String },
}

// ========================================================================
// Frame I/O
// ========================================================================

/// Read a length-prefixed frame from a reader.
pub fn read_frame<R: Read>(reader: &mut R) -> io::Result<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf)?;
    let len = u32::from_le_bytes(len_buf) as usize;

    // Sanity cap at 16MB
    if len > 16 * 1024 * 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("IPC frame too large: {len} bytes"),
        ));
    }

    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf)?;
    Ok(buf)
}

/// Write a length-prefixed frame to a writer.
pub fn write_frame<W: Write>(writer: &mut W, data: &[u8]) -> io::Result<()> {
    let len = (data.len() as u32).to_le_bytes();
    writer.write_all(&len)?;
    writer.write_all(data)?;
    writer.flush()
}

/// Send a request and read the response (GUI-side helper).
pub fn send_request<S: Read + Write>(
    stream: &mut S,
    request: &IpcRequest,
) -> io::Result<IpcResponse> {
    let json = serde_json::to_vec(request)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    write_frame(stream, &json)?;

    let response_bytes = read_frame(stream)?;
    serde_json::from_slice(&response_bytes)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

/// Read a request from a pipe (daemon-side helper).
pub fn read_request<R: Read>(reader: &mut R) -> io::Result<IpcRequest> {
    let bytes = read_frame(reader)?;
    serde_json::from_slice(&bytes)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

/// Write a response to a pipe (daemon-side helper).
pub fn write_response<W: Write>(writer: &mut W, response: &IpcResponse) -> io::Result<()> {
    let json = serde_json::to_vec(response)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    write_frame(writer, &json)
}
