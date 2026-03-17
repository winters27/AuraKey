//! AuraKey Configuration Schema
//!
//! Defines all serde types for the TOML configuration system.
//! Handles profile-based organization, macro definitions, trigger modes,
//! step definitions, and global settings.
//!
//! Configuration path: `{dirs::config_dir()}/aurakey/aurakey.toml`


use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

// ========================================================================
// VK Code Constants (public reference table — not all used in presets)
// ========================================================================

// Mouse button VK codes (0x01–0x06)
pub const VK_LBUTTON: u32  = 0x01;
pub const VK_RBUTTON: u32  = 0x02;
pub const VK_MBUTTON: u32  = 0x04;
pub const VK_XBUTTON1: u32 = 0x05;
pub const VK_XBUTTON2: u32 = 0x06;

/// Check if a VK code is a mouse button.
pub fn is_mouse_vk(vk: u32) -> bool {
    matches!(vk, 0x01 | 0x02 | 0x04 | 0x05 | 0x06)
}

#[allow(dead_code)]
pub const VK_A: u32 = 0x41;
pub const VK_C: u32 = 0x43;
pub const VK_D: u32 = 0x44;
pub const VK_E: u32 = 0x45;
pub const VK_R: u32 = 0x52;
pub const VK_S: u32 = 0x53;
pub const VK_W: u32 = 0x57;
pub const VK_3: u32 = 0x33;
pub const VK_ESCAPE: u32 = 0x1B;
pub const VK_SPACE: u32 = 0x20;
pub const VK_LCONTROL: u32 = 0xA2;
pub const VK_RCONTROL: u32 = 0xA3;
pub const VK_LSHIFT: u32 = 0xA0;
pub const VK_RSHIFT: u32 = 0xA1;
pub const VK_LALT: u32 = 0xA4;
pub const VK_RALT: u32 = 0xA5;
pub const VK_LWIN: u32 = 0x5B;
pub const VK_RWIN: u32 = 0x5C;
pub const VK_F1: u32 = 0x70;
pub const VK_F2: u32 = 0x71;
pub const VK_F3: u32 = 0x72;
pub const VK_F4: u32 = 0x73;
pub const VK_F5: u32 = 0x74;
pub const VK_F6: u32 = 0x75;
pub const VK_F7: u32 = 0x76;
pub const VK_F8: u32 = 0x77;
pub const VK_F9: u32 = 0x78;
pub const VK_F10: u32 = 0x79;
pub const VK_F11: u32 = 0x7A;
pub const VK_F12: u32 = 0x7B;
pub const VK_F13: u32 = 0x7C;
pub const VK_F14: u32 = 0x7D;
pub const VK_F15: u32 = 0x7E;
pub const VK_F16: u32 = 0x7F;
pub const VK_F17: u32 = 0x80;
pub const VK_F18: u32 = 0x81;
pub const VK_F19: u32 = 0x82;
pub const VK_F20: u32 = 0x83;
pub const VK_F21: u32 = 0x84;
pub const VK_F22: u32 = 0x85;
pub const VK_F23: u32 = 0x86;
pub const VK_F24: u32 = 0x87;
pub const VK_NUMPAD0: u32 = 0x60;
pub const VK_NUMPAD1: u32 = 0x61;
pub const VK_NUMPAD2: u32 = 0x62;
pub const VK_NUMPAD3: u32 = 0x63;
pub const VK_NUMPAD4: u32 = 0x64;
pub const VK_NUMPAD5: u32 = 0x65;
pub const VK_NUMPAD6: u32 = 0x66;
pub const VK_NUMPAD7: u32 = 0x67;
pub const VK_NUMPAD8: u32 = 0x68;
pub const VK_NUMPAD9: u32 = 0x69;

// ========================================================================
// Friendly Key Names
// ========================================================================

/// Returns a human-readable string for a Windows VK code.
pub fn vk_name(vk: u32) -> &'static str {
    if crate::gamepad::is_gamepad_vk(vk) {
        return crate::gamepad::gamepad_vk_name(vk);
    }
    match vk {
        // Mouse buttons
        0x01 => "LMB",
        0x02 => "RMB",
        0x04 => "MMB",
        0x05 => "M4",
        0x06 => "M5",
        0x08 => "Backspace",
        0x09 => "Tab",
        0x0D => "Enter",
        0x10 => "Shift",
        0x11 => "Control",
        0x12 => "Alt",
        0x13 => "Pause",
        0x14 => "CapsLock",
        0x1B => "Escape",
        0x20 => "Space",
        0x21 => "PageUp",
        0x22 => "PageDown",
        0x23 => "End",
        0x24 => "Home",
        0x25 => "Left",
        0x26 => "Up",
        0x27 => "Right",
        0x28 => "Down",
        0x2C => "PrintScreen",
        0x2D => "Insert",
        0x2E => "Delete",
        0x30..=0x39 => {
            const NUMS: [&str; 10] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
            NUMS[(vk - 0x30) as usize]
        }
        0x41..=0x5A => {
            const LETTERS: [&str; 26] = [
                "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
                "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
            ];
            LETTERS[(vk - 0x41) as usize]
        }
        0x5B => "LWin",
        0x5C => "RWin",
        0x60..=0x69 => {
            const NPADS: [&str; 10] = [
                "Numpad0", "Numpad1", "Numpad2", "Numpad3", "Numpad4",
                "Numpad5", "Numpad6", "Numpad7", "Numpad8", "Numpad9",
            ];
            NPADS[(vk - 0x60) as usize]
        }
        0x6A => "Numpad*",
        0x6B => "Numpad+",
        0x6D => "Numpad-",
        0x6E => "Numpad.",
        0x6F => "Numpad/",
        0x70..=0x87 => {
            const FKS: [&str; 24] = [
                "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10",
                "F11", "F12", "F13", "F14", "F15", "F16", "F17", "F18", "F19",
                "F20", "F21", "F22", "F23", "F24",
            ];
            FKS[(vk - 0x70) as usize]
        }
        0x90 => "NumLock",
        0x91 => "ScrollLock",
        0xA0 => "LShift",
        0xA1 => "RShift",
        0xA2 => "LCtrl",
        0xA3 => "RCtrl",
        0xA4 => "LAlt",
        0xA5 => "RAlt",
        0xAD => "VolumeMute",
        0xAE => "VolumeDown",
        0xAF => "VolumeUp",
        0xB0 => "MediaNext",
        0xB1 => "MediaPrev",
        0xB2 => "MediaStop",
        0xB3 => "MediaPlayPause",
        0xBA => ";",
        0xBB => "=",
        0xBC => ",",
        0xBD => "-",
        0xBE => ".",
        0xBF => "/",
        0xC0 => "`",
        0xDB => "[",
        0xDC => "\\",
        0xDD => "]",
        0xDE => "'",
        _ => "Unknown",
    }
}

// ========================================================================
// Trigger Configuration
// ========================================================================

/// How the hotkey trigger activates the macro.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum TriggerMode {
    /// Fires once when key(s) go down.
    #[default]
    Press,
    /// Macro runs continuously while held; stops on release.
    Hold,
    /// Press once to start, press again to stop.
    Toggle,
    /// Two presses within timeout_ms.
    DoubleTap,
    /// Key held for long_press_ms before firing.
    LongPress,
    /// Fires on key-up instead of key-down.
    Release,
}


/// Configuration for a macro's trigger hotkey.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerConfig {
    /// Legacy: VK codes for a single trigger chord. Kept for backward compat.
    /// On load, migrated into `trigger_sets` if that field is empty.
    #[serde(default)]
    pub keys: Vec<u32>,
    /// Multiple trigger chords (OR logic). Each inner Vec is a chord (AND).
    /// Any chord match fires the macro.
    #[serde(default)]
    pub trigger_sets: Vec<Vec<u32>>,
    /// How the trigger activates the macro.
    #[serde(default)]
    pub mode: TriggerMode,
    /// Timeout for double-tap detection (ms). Only used when mode = DoubleTap.
    #[serde(default = "default_dt_timeout")]
    pub timeout_ms: u64,
    /// Threshold for long-press detection (ms). Only used when mode = LongPress.
    #[serde(default = "default_lp_threshold")]
    pub long_press_ms: u64,
    /// When true, the trigger key is passed through to the focused application.
    /// When false (default), the trigger key is consumed/swallowed.
    #[serde(default)]
    pub passthrough: bool,
}

fn default_dt_timeout() -> u64 { 300 }
fn default_lp_threshold() -> u64 { 500 }

impl Default for TriggerConfig {
    fn default() -> Self {
        Self {
            keys: vec![],
            trigger_sets: vec![vec![VK_F8]],
            mode: TriggerMode::Press,
            timeout_ms: default_dt_timeout(),
            long_press_ms: default_lp_threshold(),
            passthrough: false,
        }
    }
}

// ========================================================================
// Execution Configuration
// ========================================================================

/// How a macro's steps are executed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ExecutionMode {
    /// Steps execute one at a time, in order.
    #[default]
    Sequential,
    /// Steps execute in parallel with µs-precision offsets.
    Timeline,
    /// Runs on a worker thread at a tick rate (for continuous macros).
    Continuous,
}


/// Pattern for continuous execution mode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ContinuousPattern {
    /// Cycles through a list of keys at the tick rate.
    #[default]
    KeyCycle,
    /// Alternating mouse delta phases (Phase A / Phase B).
    MouseOscillate,
}


/// Execution configuration for a macro.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionConfig {
    /// Execution mode.
    #[serde(default)]
    pub mode: ExecutionMode,
    /// Continuous pattern (only used when mode = Continuous).
    #[serde(default)]
    pub pattern: ContinuousPattern,
    /// Keys to cycle through (KeyCycle pattern only).
    #[serde(default)]
    pub cycle_keys: Vec<u32>,
    /// Mouse oscillation amplitude (MouseOscillate only).
    #[serde(default = "default_amplitude")]
    pub amplitude: i32,
    /// Vertical compensation (MouseOscillate only).
    #[serde(default = "default_vert_comp")]
    pub vertical_comp: i32,
    /// Tick rate in ms (Continuous mode).
    #[serde(default = "default_tick_rate")]
    pub rate_ms: u64,
}

fn default_amplitude() -> i32 { 26 }
fn default_vert_comp() -> i32 { -17 }
fn default_tick_rate() -> u64 { 10 }

impl Default for ExecutionConfig {
    fn default() -> Self {
        Self {
            mode: ExecutionMode::Sequential,
            pattern: ContinuousPattern::KeyCycle,
            cycle_keys: Vec::new(),
            amplitude: default_amplitude(),
            vertical_comp: default_vert_comp(),
            rate_ms: default_tick_rate(),
        }
    }
}

// ========================================================================
// Step Definitions (Macro Steps)
// ========================================================================

/// Output mode for a macro — software SendInput or Arduino HID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum OutputMode {
    #[default]
    Software,
    Arduino,
}


/// Mouse button identifier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum MouseButton {
    #[default]
    Left,
    Right,
    Middle,
}


/// Scroll direction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ScrollDirection {
    #[default]
    Up,
    Down,
    Left,
    Right,
}


/// Internal tap hold duration (10ms — long enough for any game to register).
pub const TAP_HOLD_MS: u64 = 10;

/// A single step in a macro sequence.
///
/// Tagged enum — each variant specifies the step type and its parameters.
/// Timing model: taps are instant (~10ms internal), holds have an explicit
/// duration, and pauses between steps use dedicated `Delay` steps.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "PascalCase")]
pub enum StepDef {
    /// Press and release a key instantly (~10ms internal hold).
    KeyTap {
        key: u32,
        /// Legacy field — ignored at runtime, kept for config compat.
        #[serde(default, skip_serializing)]
        hold_ms: u64,
        #[serde(default)]
        offset_us: u64,
        /// Legacy field — migrated to Delay steps on load.
        #[serde(default, skip_serializing)]
        delay_after_ms: u64,
    },
    /// Press a key and hold it for `duration_ms`, then release.
    KeyHold {
        key: u32,
        /// How long to hold the key (ms). 0 = press without auto-release.
        #[serde(default)]
        duration_ms: u64,
        #[serde(default)]
        offset_us: u64,
        /// Legacy field — migrated to Delay steps on load.
        #[serde(default, skip_serializing)]
        delay_after_ms: u64,
    },
    /// Release a held key.
    KeyRelease {
        key: u32,
        #[serde(default)]
        offset_us: u64,
        /// Legacy field — migrated to Delay steps on load.
        #[serde(default, skip_serializing)]
        delay_after_ms: u64,
    },
    /// Multiple key taps in order with per-key delay.
    KeySequence {
        keys: Vec<u32>,
        #[serde(default = "default_per_key_delay")]
        per_key_delay_ms: u64,
        #[serde(default)]
        offset_us: u64,
        /// Legacy field — migrated to Delay steps on load.
        #[serde(default, skip_serializing)]
        delay_after_ms: u64,
    },
    /// Relative mouse movement.
    MouseMoveRelative {
        dx: i32,
        dy: i32,
        #[serde(default)]
        stepped: bool,
        #[serde(default)]
        offset_us: u64,
        #[serde(default, skip_serializing)]
        delay_after_ms: u64,
    },
    /// Absolute mouse movement (pixel coords).
    MouseMoveAbsolute {
        x: i32,
        y: i32,
        #[serde(default)]
        offset_us: u64,
        #[serde(default, skip_serializing)]
        delay_after_ms: u64,
    },
    /// Mouse button click (instant press+release).
    MouseClick {
        #[serde(default)]
        button: MouseButton,
        #[serde(default)]
        offset_us: u64,
        #[serde(default, skip_serializing)]
        delay_after_ms: u64,
    },
    /// Hold a mouse button for `duration_ms`, then release.
    MouseHold {
        #[serde(default)]
        button: MouseButton,
        /// How long to hold the button (ms). 0 = press without auto-release.
        #[serde(default)]
        duration_ms: u64,
        #[serde(default)]
        offset_us: u64,
        #[serde(default, skip_serializing)]
        delay_after_ms: u64,
    },
    /// Release a held mouse button.
    MouseRelease {
        #[serde(default)]
        button: MouseButton,
        #[serde(default)]
        offset_us: u64,
        #[serde(default, skip_serializing)]
        delay_after_ms: u64,
    },
    /// Move to absolute position then click.
    MouseAbsoluteClick {
        x: i32,
        y: i32,
        #[serde(default)]
        button: MouseButton,
        #[serde(default)]
        offset_us: u64,
        #[serde(default, skip_serializing)]
        delay_after_ms: u64,
    },
    /// Stepped relative movement then click.
    MouseSteppedDeltaClick {
        dx: i32,
        dy: i32,
        #[serde(default)]
        button: MouseButton,
        #[serde(default)]
        offset_us: u64,
        #[serde(default, skip_serializing)]
        delay_after_ms: u64,
    },
    /// Mouse scroll.
    MouseScroll {
        #[serde(default)]
        direction: ScrollDirection,
        #[serde(default = "default_scroll_amount")]
        amount: i32,
        #[serde(default)]
        offset_us: u64,
        #[serde(default, skip_serializing)]
        delay_after_ms: u64,
    },
    /// Pure wait (no action).
    Delay {
        ms: u64,
        #[serde(default)]
        offset_us: u64,
    },
    /// Loops previous N steps X times.
    RepeatBlock {
        step_count: usize,
        repeat_count: usize,
        #[serde(default)]
        offset_us: u64,
        #[serde(default, skip_serializing)]
        delay_after_ms: u64,
    },
    /// Visual annotation (not executed).
    Label {
        text: String,
    },
    /// Fires cancellation signal to abort any running macro.
    CancelAll,
    /// Launch an executable or run a shell command.
    RunProgram {
        /// Command or path to execute.
        command: String,
        /// Arguments passed to the command.
        #[serde(default)]
        args: String,
        /// Working directory (empty = inherit from AuraKey process).
        #[serde(default)]
        working_dir: String,
        /// If true, wait for the process to exit before continuing.
        #[serde(default)]
        wait: bool,
        #[serde(default)]
        offset_us: u64,
        #[serde(default, skip_serializing)]
        delay_after_ms: u64,
    },
}

fn default_per_key_delay() -> u64 { 30 }
fn default_scroll_amount() -> i32 { 3 }

impl StepDef {
    /// Returns the offset_us value for this step, if applicable.
    pub fn offset_us(&self) -> u64 {
        match self {
            StepDef::KeyTap { offset_us, .. }
            | StepDef::KeyHold { offset_us, .. }
            | StepDef::KeyRelease { offset_us, .. }
            | StepDef::KeySequence { offset_us, .. }
            | StepDef::MouseMoveRelative { offset_us, .. }
            | StepDef::MouseMoveAbsolute { offset_us, .. }
            | StepDef::MouseClick { offset_us, .. }
            | StepDef::MouseHold { offset_us, .. }
            | StepDef::MouseRelease { offset_us, .. }
            | StepDef::MouseAbsoluteClick { offset_us, .. }
            | StepDef::MouseSteppedDeltaClick { offset_us, .. }
            | StepDef::MouseScroll { offset_us, .. }
            | StepDef::Delay { offset_us, .. }
            | StepDef::RepeatBlock { offset_us, .. }
            | StepDef::RunProgram { offset_us, .. } => *offset_us,
            StepDef::Label { .. } | StepDef::CancelAll => 0,
        }
    }

    /// Returns the legacy `delay_after_ms` if present (for migration).
    fn legacy_delay_after(&self) -> u64 {
        match self {
            StepDef::KeyTap { delay_after_ms, .. }
            | StepDef::KeyHold { delay_after_ms, .. }
            | StepDef::KeyRelease { delay_after_ms, .. }
            | StepDef::KeySequence { delay_after_ms, .. }
            | StepDef::MouseMoveRelative { delay_after_ms, .. }
            | StepDef::MouseMoveAbsolute { delay_after_ms, .. }
            | StepDef::MouseClick { delay_after_ms, .. }
            | StepDef::MouseHold { delay_after_ms, .. }
            | StepDef::MouseRelease { delay_after_ms, .. }
            | StepDef::MouseAbsoluteClick { delay_after_ms, .. }
            | StepDef::MouseSteppedDeltaClick { delay_after_ms, .. }
            | StepDef::MouseScroll { delay_after_ms, .. }
            | StepDef::RepeatBlock { delay_after_ms, .. }
            | StepDef::RunProgram { delay_after_ms, .. } => *delay_after_ms,
            StepDef::Delay { .. } | StepDef::Label { .. } | StepDef::CancelAll => 0,
        }
    }
}

/// Migrate legacy steps: convert `delay_after_ms` fields into explicit `Delay` steps.
/// Also converts old `KeyTap { hold_ms > 20 }` into `KeyHold { duration_ms }` + `KeyRelease`.
pub fn migrate_steps(steps: Vec<StepDef>) -> Vec<StepDef> {
    let mut out = Vec::with_capacity(steps.len() * 2);
    for step in steps {
        // Convert old KeyTap with large hold_ms to KeyHold+KeyRelease
        if let StepDef::KeyTap { key, hold_ms, offset_us, delay_after_ms } = &step {
            if *hold_ms > 20 {
                out.push(StepDef::KeyHold { key: *key, duration_ms: *hold_ms, offset_us: *offset_us, delay_after_ms: 0 });
                out.push(StepDef::KeyRelease { key: *key, offset_us: 0, delay_after_ms: 0 });
                if *delay_after_ms > 0 {
                    out.push(StepDef::Delay { ms: *delay_after_ms, offset_us: 0 });
                }
                continue;
            }
        }

        let delay = step.legacy_delay_after();
        out.push(step);
        if delay > 0 {
            out.push(StepDef::Delay { ms: delay, offset_us: 0 });
        }
    }
    out
}

// ========================================================================
// Macro Definition
// ========================================================================

/// A complete macro definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroDef {
    /// Unique identifier.
    #[serde(default = "Uuid::new_v4")]
    pub id: Uuid,
    /// Display name.
    pub name: String,
    /// Whether this macro is active.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Favorite star for quick access.
    #[serde(default)]
    pub favorite: bool,
    /// Trigger configuration.
    #[serde(default)]
    pub trigger: TriggerConfig,
    /// Execution configuration.
    #[serde(default)]
    pub execution: ExecutionConfig,
    /// Output mode (software or Arduino).
    #[serde(default)]
    pub output_mode: OutputMode,
    /// Macro steps.
    #[serde(default)]
    pub steps: Vec<StepDef>,
}

fn default_true() -> bool { true }

impl MacroDef {
    /// Create a new empty macro with the given name.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4(),
            name: name.into(),
            enabled: true,
            favorite: false,
            trigger: TriggerConfig::default(),
            execution: ExecutionConfig::default(),
            output_mode: OutputMode::default(),
            steps: Vec::new(),
        }
    }
}

// ========================================================================
// Macro Group
// ========================================================================

/// A named group of macros (e.g. "Apex Legends", "Productivity").
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroGroup {
    /// Display name.
    pub name: String,
    /// Whether the entire group is enabled.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Macros in this group.
    #[serde(default)]
    pub macros: Vec<MacroDef>,
}

impl MacroGroup {
    /// Create a new empty group.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            enabled: true,
            macros: Vec::new(),
        }
    }
}

// ========================================================================
// Profile
// ========================================================================

/// A profile is a named collection of macro groups.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    /// Profile display name.
    pub name: String,
    /// Groups in this profile.
    #[serde(default)]
    pub groups: Vec<MacroGroup>,
}

impl Profile {
    /// Create a new empty profile.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            groups: Vec::new(),
        }
    }
}

// ========================================================================
// Arduino Configuration
// ========================================================================

/// Arduino HID passthrough settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArduinoConfig {
    /// Whether Arduino HID mode is available.
    #[serde(default)]
    pub enabled: bool,
    /// COM port name (e.g. "COM4").
    #[serde(default)]
    pub port: String,
    /// Auto-connect on startup.
    #[serde(default)]
    pub auto_connect: bool,
    /// Fall back to software if Arduino disconnected.
    #[serde(default = "default_true")]
    pub fallback_to_software: bool,
}

impl Default for ArduinoConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: String::new(),
            auto_connect: false,
            fallback_to_software: true,
        }
    }
}

// ========================================================================
// Application Settings
// ========================================================================

/// Theme selection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum AppTheme {
    #[default]
    Dark,
    Light,
    System,
}


/// Global application settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// Key to stop sequence recording (VK code).
    #[serde(default = "default_stop_key")]
    pub stop_key: u32,
    /// Emergency stop hotkey (VK codes for the combo).
    #[serde(default = "default_emergency_stop")]
    pub emergency_stop: Vec<u32>,
    /// Countdown duration before recording starts (seconds).
    #[serde(default = "default_countdown")]
    pub recording_countdown_secs: u32,
    /// Mouse movement accumulation threshold (ms).
    #[serde(default = "default_mouse_accum")]
    pub mouse_accumulate_ms: u64,
    /// Maximum recording duration (seconds).
    #[serde(default = "default_max_rec")]
    pub max_recording_secs: u64,
    /// Default execution mode for new macros.
    #[serde(default)]
    pub default_execution: ExecutionMode,
    /// Default tick rate for continuous macros (ms).
    #[serde(default = "default_tick_rate")]
    pub default_tick_rate_ms: u64,
    /// Launch with Windows.
    #[serde(default)]
    pub launch_with_windows: bool,
    /// Start minimized to system tray.
    #[serde(default = "default_true")]
    pub start_minimized: bool,
    /// App theme.
    #[serde(default)]
    pub theme: AppTheme,
    /// Arduino settings.
    #[serde(default)]
    pub arduino: ArduinoConfig,
}

fn default_stop_key() -> u32 { VK_F12 }
fn default_emergency_stop() -> Vec<u32> {
    vec![VK_LCONTROL, VK_LALT, VK_F12]
}
fn default_countdown() -> u32 { 3 }
fn default_mouse_accum() -> u64 { 16 }
fn default_max_rec() -> u64 { 60 }

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            stop_key: default_stop_key(),
            emergency_stop: default_emergency_stop(),
            recording_countdown_secs: default_countdown(),
            mouse_accumulate_ms: default_mouse_accum(),
            max_recording_secs: default_max_rec(),
            default_execution: ExecutionMode::Sequential,
            default_tick_rate_ms: default_tick_rate(),
            launch_with_windows: false,
            start_minimized: true,
            theme: AppTheme::Dark,
            arduino: ArduinoConfig::default(),
        }
    }
}

// ========================================================================
// Top-Level Config
// ========================================================================

/// Top-level application configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Global settings.
    #[serde(default)]
    pub settings: AppSettings,
    /// Active profile name.
    #[serde(default = "default_active_profile")]
    pub active_profile: String,
    /// All profiles.
    #[serde(default)]
    pub profiles: Vec<Profile>,
}

fn default_active_profile() -> String { "Gaming".to_string() }

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            settings: AppSettings::default(),
            active_profile: default_active_profile(),
            profiles: vec![default_apex_profile()],
        }
    }
}

// ========================================================================
// Config I/O
// ========================================================================

/// Returns the config directory path: `{config_dir}/aurakey/`
pub fn config_dir() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("aurakey")
}

/// Returns the path to the main config file.
pub fn config_path() -> PathBuf {
    config_dir().join("aurakey.toml")
}

/// Load configuration from disk. Creates default with Apex presets if not found.
/// Automatically migrates legacy `delay_after_ms` fields to explicit `Delay` steps.
pub fn load_config() -> anyhow::Result<AppConfig> {
    let path = config_path();
    if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        let mut config: AppConfig = toml::from_str(&content)?;

        // Migrate legacy steps (delay_after_ms -> explicit Delay steps)
        let mut migrated = false;
        for profile in &mut config.profiles {
            for group in &mut profile.groups {
                for m in &mut group.macros {
                    let has_legacy = m.steps.iter().any(|s| s.legacy_delay_after() > 0);
                    if has_legacy {
                        m.steps = migrate_steps(std::mem::take(&mut m.steps));
                        migrated = true;
                    }
                }
            }
        }
        if migrated {
            eprintln!("[AuraKey] Migrated legacy delay_after_ms to explicit Delay steps");
            let _ = save_config(&config);
        }

        // Migrate legacy keys -> trigger_sets
        let mut trigger_migrated = false;
        for profile in &mut config.profiles {
            for group in &mut profile.groups {
                for m in &mut group.macros {
                    if m.trigger.trigger_sets.is_empty() && !m.trigger.keys.is_empty() {
                        m.trigger.trigger_sets = vec![m.trigger.keys.clone()];
                        m.trigger.keys.clear();
                        trigger_migrated = true;
                    }
                }
            }
        }
        if trigger_migrated {
            eprintln!("[AuraKey] Migrated legacy trigger keys to trigger_sets");
            let _ = save_config(&config);
        }

        Ok(config)
    } else {
        let config = AppConfig::default();
        save_config(&config)?;
        Ok(config)
    }
}

/// Save configuration to disk.
pub fn save_config(config: &AppConfig) -> anyhow::Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let content = toml::to_string_pretty(config)?;
    std::fs::write(config_path(), content)?;
    Ok(())
}

// ========================================================================
// Default Apex Legends Presets
// ========================================================================

/// Creates the default "Gaming" profile with all 6 Apex benchmark macros.
pub fn default_apex_profile() -> Profile {
    let mut profile = Profile::new("Gaming");

    let mut apex_group = MacroGroup::new("Apex Legends");

    // 1. Superglide
    apex_group.macros.push(MacroDef {
        id: Uuid::new_v4(),
        name: "Superglide".to_string(),
        enabled: true,
        favorite: true,
        trigger: TriggerConfig {
            trigger_sets: vec![vec![VK_LCONTROL, VK_SPACE]],
            mode: TriggerMode::Press,
            ..Default::default()
        },
        execution: ExecutionConfig {
            mode: ExecutionMode::Timeline,
            ..Default::default()
        },
        output_mode: OutputMode::Software,
        steps: vec![
            StepDef::KeyHold { key: VK_C, duration_ms: 0, offset_us: 0, delay_after_ms: 0 },
            StepDef::KeyHold { key: VK_SPACE, duration_ms: 0, offset_us: 16_000, delay_after_ms: 0 },
            StepDef::KeyRelease { key: VK_C, offset_us: 17_000, delay_after_ms: 0 },
            StepDef::KeyRelease { key: VK_SPACE, offset_us: 26_000, delay_after_ms: 0 },
        ],
    });

    // 2. Armor Swap
    apex_group.macros.push(MacroDef {
        id: Uuid::new_v4(),
        name: "Armor Swap".to_string(),
        enabled: true,
        favorite: false,
        trigger: TriggerConfig {
            trigger_sets: vec![vec![VK_F9]],
            mode: TriggerMode::Press,
            ..Default::default()
        },
        execution: ExecutionConfig {
            mode: ExecutionMode::Timeline,
            ..Default::default()
        },
        output_mode: OutputMode::Software,
        steps: vec![
            StepDef::KeyHold { key: VK_E, duration_ms: 0, offset_us: 0, delay_after_ms: 0 },
            StepDef::KeyRelease { key: VK_E, offset_us: 550_000, delay_after_ms: 0 },
            StepDef::MouseAbsoluteClick {
                x: 960, y: 540,
                button: MouseButton::Left,
                offset_us: 555_000, delay_after_ms: 0,
            },
            StepDef::KeyTap {
                key: VK_ESCAPE, hold_ms: 0,
                offset_us: 600_000, delay_after_ms: 0,
            },
        ],
    });

    // 3. Move & Loot
    apex_group.macros.push(MacroDef {
        id: Uuid::new_v4(),
        name: "Move & Loot".to_string(),
        enabled: true,
        favorite: false,
        trigger: TriggerConfig {
            trigger_sets: vec![vec![VK_F10]],
            mode: TriggerMode::Press,
            ..Default::default()
        },
        execution: ExecutionConfig {
            mode: ExecutionMode::Timeline,
            ..Default::default()
        },
        output_mode: OutputMode::Software,
        steps: vec![
            StepDef::KeyHold { key: VK_W, duration_ms: 0, offset_us: 0, delay_after_ms: 0 },
            StepDef::KeyHold { key: VK_S, duration_ms: 0, offset_us: 5_000, delay_after_ms: 0 },
            StepDef::KeyRelease { key: VK_S, offset_us: 6_000, delay_after_ms: 0 },
            StepDef::KeyTap { key: VK_E, hold_ms: 0, offset_us: 51_000, delay_after_ms: 0 },
            StepDef::KeyHold { key: VK_SPACE, duration_ms: 0, offset_us: 119_000, delay_after_ms: 0 },
            StepDef::KeyRelease { key: VK_SPACE, offset_us: 129_000, delay_after_ms: 0 },
            StepDef::KeyRelease { key: VK_W, offset_us: 250_000, delay_after_ms: 0 },
        ],
    });

    // 4. Jitter Aim (continuous)
    apex_group.macros.push(MacroDef {
        id: Uuid::new_v4(),
        name: "Jitter Aim".to_string(),
        enabled: true,
        favorite: false,
        trigger: TriggerConfig {
            trigger_sets: vec![vec![VK_F8]],
            mode: TriggerMode::Hold,
            ..Default::default()
        },
        execution: ExecutionConfig {
            mode: ExecutionMode::Continuous,
            pattern: ContinuousPattern::MouseOscillate,
            amplitude: 26,
            vertical_comp: 17,
            rate_ms: 10,
            ..Default::default()
        },
        output_mode: OutputMode::Software,
        steps: Vec::new(),
    });

    // 5. Strafe Spam (continuous)
    apex_group.macros.push(MacroDef {
        id: Uuid::new_v4(),
        name: "Strafe Spam".to_string(),
        enabled: true,
        favorite: false,
        trigger: TriggerConfig {
            trigger_sets: vec![vec![VK_F7]],
            mode: TriggerMode::Toggle,
            ..Default::default()
        },
        execution: ExecutionConfig {
            mode: ExecutionMode::Continuous,
            pattern: ContinuousPattern::KeyCycle,
            cycle_keys: vec![VK_LCONTROL, VK_A, VK_D, VK_SPACE, VK_C, VK_A, VK_D, VK_A],
            rate_ms: 30,
            ..Default::default()
        },
        output_mode: OutputMode::Software,
        steps: Vec::new(),
    });

    // 6. Quick Actions (double-tap — two separate macros)
    apex_group.macros.push(MacroDef {
        id: Uuid::new_v4(),
        name: "Quick Reload (2x R)".to_string(),
        enabled: true,
        favorite: false,
        trigger: TriggerConfig {
            trigger_sets: vec![vec![VK_R]],
            mode: TriggerMode::DoubleTap,
            timeout_ms: 300,
            ..Default::default()
        },
        execution: ExecutionConfig {
            mode: ExecutionMode::Sequential,
            ..Default::default()
        },
        output_mode: OutputMode::Software,
        steps: vec![
            StepDef::KeyTap { key: VK_R, hold_ms: 0, offset_us: 0, delay_after_ms: 0 },
        ],
    });

    apex_group.macros.push(MacroDef {
        id: Uuid::new_v4(),
        name: "Quick Holster (2x 3)".to_string(),
        enabled: true,
        favorite: false,
        trigger: TriggerConfig {
            trigger_sets: vec![vec![VK_3]],
            mode: TriggerMode::DoubleTap,
            timeout_ms: 300,
            ..Default::default()
        },
        execution: ExecutionConfig {
            mode: ExecutionMode::Sequential,
            ..Default::default()
        },
        output_mode: OutputMode::Software,
        steps: vec![
            StepDef::KeyTap { key: VK_3, hold_ms: 0, offset_us: 0, delay_after_ms: 0 },
            StepDef::Delay { ms: 50, offset_us: 0 },
            StepDef::KeyTap { key: VK_3, hold_ms: 0, offset_us: 0, delay_after_ms: 0 },
        ],
    });

    profile.groups.push(apex_group);
    profile
}

// ========================================================================
// Import / Export (.akg Format)
// ========================================================================

/// Envelope for .akg export files.
#[derive(Debug, Serialize, Deserialize)]
struct AkgExport {
    aurakey_export: AkgHeader,
    #[serde(default)]
    profile: Option<Profile>,
    #[serde(default)]
    macros: Option<Vec<MacroDef>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AkgHeader {
    version: String,
    /// "profile" or "macros"
    export_type: String,
}

/// Export a full profile to a `.akg` file.
pub fn export_profile(profile: &Profile, path: &std::path::Path) -> anyhow::Result<()> {
    let export = AkgExport {
        aurakey_export: AkgHeader {
            version: "1.0".to_string(),
            export_type: "profile".to_string(),
        },
        profile: Some(profile.clone()),
        macros: None,
    };
    let content = toml::to_string_pretty(&export)?;
    std::fs::write(path, content)?;
    Ok(())
}

/// Import a profile from a `.akg` file.
pub fn import_profile(path: &std::path::Path) -> anyhow::Result<Profile> {
    let content = std::fs::read_to_string(path)?;
    let export: AkgExport = toml::from_str(&content)?;
    export.profile.ok_or_else(|| anyhow::anyhow!("File does not contain a profile"))
}

/// Export individual macros to a `.akg` file.
pub fn export_macros(macros: &[MacroDef], path: &std::path::Path) -> anyhow::Result<()> {
    let export = AkgExport {
        aurakey_export: AkgHeader {
            version: "1.0".to_string(),
            export_type: "macros".to_string(),
        },
        profile: None,
        macros: Some(macros.to_vec()),
    };
    let content = toml::to_string_pretty(&export)?;
    std::fs::write(path, content)?;
    Ok(())
}

/// Import macros from a `.akg` file.
pub fn import_macros(path: &std::path::Path) -> anyhow::Result<Vec<MacroDef>> {
    let content = std::fs::read_to_string(path)?;
    let export: AkgExport = toml::from_str(&content)?;
    if let Some(macros) = export.macros {
        Ok(macros)
    } else if let Some(profile) = export.profile {
        // Extract all macros from all groups
        Ok(profile.groups.into_iter().flat_map(|g| g.macros).collect())
    } else {
        Err(anyhow::anyhow!("File contains neither macros nor a profile"))
    }
}

// ========================================================================
// Conflict Detection
// ========================================================================

/// A conflict between two macros with the same hotkey.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ConflictWarning {
    pub macro_a: String,
    pub macro_b: String,
    pub keys: Vec<u32>,
}

/// Detects duplicate hotkey assignments within a profile.
pub fn detect_conflicts(profile: &Profile) -> Vec<ConflictWarning> {
    let mut warnings = Vec::new();
    let mut seen: Vec<(&str, Vec<Vec<u32>>)> = Vec::new();

    for group in &profile.groups {
        if !group.enabled {
            continue;
        }
        for m in &group.macros {
            if !m.enabled || m.trigger.trigger_sets.is_empty() {
                continue;
            }
            let sets = &m.trigger.trigger_sets;
            for (prev_name, prev_sets) in &seen {
                // Conflict if any chord in current matches any chord in prev
                for chord in sets {
                    for prev_chord in prev_sets {
                        if keys_match(chord, prev_chord) {
                            warnings.push(ConflictWarning {
                                macro_a: prev_name.to_string(),
                                macro_b: m.name.clone(),
                                keys: chord.clone(),
                            });
                        }
                    }
                }
            }
            seen.push((&m.name, sets.clone()));
        }
    }

    warnings
}

/// Check if two key sets are equivalent (same keys, any order).
fn keys_match(a: &[u32], b: &[u32]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut a_sorted = a.to_vec();
    let mut b_sorted = b.to_vec();
    a_sorted.sort();
    b_sorted.sort();
    a_sorted == b_sorted
}

// ========================================================================
// Tests
// ========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_roundtrip() {
        let config = AppConfig::default();
        let toml_str = toml::to_string_pretty(&config).expect("serialize");
        let parsed: AppConfig = toml::from_str(&toml_str).expect("deserialize");

        assert_eq!(parsed.active_profile, config.active_profile);
        assert_eq!(parsed.profiles.len(), config.profiles.len());

        let apex = &parsed.profiles[0].groups[0];
        assert_eq!(apex.name, "Apex Legends");
        assert_eq!(apex.macros.len(), 7); // 6 macros + Quick Holster
        assert_eq!(apex.macros[0].name, "Superglide");
        assert_eq!(apex.macros[0].steps.len(), 4);
    }

    #[test]
    fn test_vk_names() {
        assert_eq!(vk_name(VK_SPACE), "Space");
        assert_eq!(vk_name(VK_A), "A");
        assert_eq!(vk_name(VK_F12), "F12");
        assert_eq!(vk_name(VK_LCONTROL), "LCtrl");
    }

    #[test]
    fn test_export_import_roundtrip() {
        let profile = default_apex_profile();
        let path = std::env::temp_dir().join("aurakey_test_export.akg");
        export_profile(&profile, &path).expect("export");
        let imported = import_profile(&path).expect("import");
        assert_eq!(imported.name, profile.name);
        assert_eq!(imported.groups.len(), profile.groups.len());
        assert_eq!(
            imported.groups[0].macros.len(),
            profile.groups[0].macros.len()
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_conflict_detection() {
        let mut profile = Profile::new("Test");
        let mut group = MacroGroup::new("Group");

        let mut m1 = MacroDef::new("Macro A");
        m1.trigger.trigger_sets = vec![vec![VK_F8]];
        let mut m2 = MacroDef::new("Macro B");
        m2.trigger.trigger_sets = vec![vec![VK_F8]]; // duplicate
        let mut m3 = MacroDef::new("Macro C");
        m3.trigger.trigger_sets = vec![vec![VK_F9]]; // different

        group.macros.push(m1);
        group.macros.push(m2);
        group.macros.push(m3);
        profile.groups.push(group);

        let conflicts = detect_conflicts(&profile);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].macro_a, "Macro A");
        assert_eq!(conflicts[0].macro_b, "Macro B");
    }
}
