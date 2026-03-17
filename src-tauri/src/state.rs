//! Application State — Shared state managed by Tauri (GUI only)
//!
//! Holds the named pipe connection to the daemon, recorder channels,
//! and a local config cache.

use crate::config::AppConfig;
use crate::recorder::{RecorderCommand, RecordingResult};
use crossbeam_channel::{Receiver, Sender};
use std::sync::Mutex;

/// Shared application state for the GUI process.
pub struct AppState {
    /// Local config cache (synced from daemon on connect).
    pub config: Mutex<AppConfig>,
    /// Named pipe connection to the daemon.
    pub pipe: Mutex<std::fs::File>,
    /// Recorder command channel (local to GUI).
    pub recorder_cmd_tx: Sender<RecorderCommand>,
    /// Recorder result channel (local to GUI).
    pub recorder_result_rx: Mutex<Receiver<RecordingResult>>,
}
