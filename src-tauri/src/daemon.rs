//! Global Hotkey Daemon — Low-Level Keyboard Hook + Gamepad Polling
//!
//! Uses WH_KEYBOARD_LL to intercept system-wide key events and XInput for
//! gamepad poll. Supports cross-input combos (e.g. LT + R) and multi-chord
//! OR triggers.
//!
//! Runs on a dedicated thread with a Windows message pump.

use crate::config::{
    ContinuousPattern, ExecutionMode, MacroDef, Profile, TriggerMode,
};
use crate::executor::{
    self, ContinuousState, DoubleTapTracker, KeyCycleState, MouseOscillateState,
    MACRO_CANCEL,
};
use crate::gamepad::{self, GamepadPoller};
use crossbeam_channel::{Receiver, Sender};
use parking_lot::Mutex as ParkMutex;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Instant;

#[cfg(windows)]
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, PeekMessageW, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, MSLLHOOKSTRUCT,
    MSG, PM_REMOVE, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN,
    WM_SYSKEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP,
    WM_MBUTTONDOWN, WM_MBUTTONUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
};

// ========================================================================
// Daemon Commands (GUI → Daemon)
// ========================================================================

/// Commands sent from the GUI to the daemon.
pub enum DaemonCommand {
    /// Reload with new profile.
    Reload(Profile),
    /// Pause all hotkey listening.
    Pause,
    /// Resume hotkey listening.
    Resume,
    /// Cancel all running macros immediately.
    CancelAll,
    /// Shut down the daemon.
    Shutdown,
}

/// Events sent from the daemon to the GUI.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum DaemonEvent {
    /// A macro started executing.
    MacroStarted { name: String },
    /// A macro finished executing.
    #[allow(dead_code)]
    MacroFinished { name: String },
    /// A continuous macro is active.
    ContinuousActive { name: String, active: bool },
    /// An error occurred.
    Error(String),
    /// Gamepad connection status changed.
    GamepadStatus { connected: bool },
    /// Config was changed externally (e.g. tray profile switch).
    ConfigChanged,
    /// Pause state was changed externally (e.g. tray pause/resume).
    PauseChanged { paused: bool },
}

// ========================================================================
// Internal Types
// ========================================================================

/// A single chord: modifier VKs + main VK, where any/all may be keyboard
/// or gamepad pseudo-VKs.
#[derive(Clone)]
struct TriggerChord {
    /// Modifier keys/buttons (must all be held).
    modifier_vks: Vec<u32>,
    /// The "main" key/button that triggers the match on press/release.
    main_vk: u32,
    /// Whether the keyboard key should pass through (always true for gamepad).
    passthrough: bool,
    /// Whether main_vk is a gamepad pseudo-VK.
    is_gamepad_main: bool,
}

/// A registered trigger with all the state needed for matching.
struct TriggerEntry {
    macro_def: MacroDef,
    /// All chords (OR logic). Any match fires the macro.
    chords: Vec<TriggerChord>,
    /// For double-tap detection.
    double_tap: Option<DoubleTapTracker>,
    /// For long-press detection.
    long_press_start: Option<Instant>,
    /// For toggle/hold modes — is the continuous loop running?
    toggle_active: Arc<AtomicBool>,
}

/// Events sent from the hook/poller to the daemon processing loop.
enum HookAction {
    /// A keyboard key matching a chord was pressed.
    KeyDown(usize),
    /// A keyboard key matching a chord was released.
    KeyUp(usize),
    /// A gamepad button matching a chord was pressed.
    GamepadDown(usize),
    /// A gamepad button matching a chord was released.
    GamepadUp(usize),
}

// ========================================================================
// Shared Keyboard Pressed State
//
// Moved out of thread_local! so both the hook callback and the gamepad
// chord matcher can read the currently-pressed keyboard keys.
// ========================================================================

static PRESSED_KEYS: LazyLock<ParkMutex<HashSet<u32>>> =
    LazyLock::new(|| ParkMutex::new(HashSet::new()));

// ========================================================================
// Hook Global State
//
// WH_KEYBOARD_LL callbacks are invoked on the thread that installed the
// hook. We still use thread-local for hook-specific state (trigger
// snapshots, action channel), but pressed keys are shared.
// ========================================================================

use std::cell::RefCell;

thread_local! {
    static HOOK_CTX: RefCell<HookContext> = RefCell::new(HookContext::default());
}

#[derive(Default)]
struct HookContext {
    /// Registered trigger chords to match against (keyboard-main only).
    triggers: Vec<ChordSnapshot>,
    /// Channel to send match events to the daemon loop.
    action_tx: Option<crossbeam_channel::Sender<HookAction>>,
    /// Whether the daemon is paused.
    paused: bool,
}

/// Read-only snapshot of a keyboard-main chord for the hook callback.
#[derive(Default)]
struct ChordSnapshot {
    /// Index into the daemon's trigger entries.
    trigger_idx: usize,
    /// Modifier VKs (keyboard only — gamepad mods checked via atomic).
    kb_modifier_vks: Vec<u32>,
    /// Gamepad modifier VKs (checked via GAMEPAD_STATE atomic).
    gp_modifier_vks: Vec<u32>,
    /// The keyboard main VK.
    main_vk: u32,
    /// Whether to pass through.
    passthrough: bool,
}

// ========================================================================
// Modifier Detection
// ========================================================================

fn is_modifier(vk: u32) -> bool {
    matches!(
        vk,
        0xA0 | 0xA1 | // LShift, RShift
        0xA2 | 0xA3 | // LCtrl, RCtrl
        0xA4 | 0xA5 | // LAlt, RAlt
        0x5B | 0x5C | // LWin, RWin
        0x10 | 0x11 | 0x12  // Generic Shift, Ctrl, Alt
    )
}

/// Normalize generic modifier codes to their left variants for consistent matching.
fn normalize_modifier(vk: u32) -> u32 {
    match vk {
        0x10 => 0xA0, // Shift → LShift
        0x11 => 0xA2, // Ctrl → LCtrl
        0x12 => 0xA4, // Alt → LAlt
        _ => vk,
    }
}

/// Check if all required keyboard modifiers are currently pressed.
fn modifiers_held(required: &[u32], pressed: &HashSet<u32>) -> bool {
    required.iter().all(|req| {
        match *req {
            0xA0 => pressed.contains(&0xA0) || pressed.contains(&0xA1) || pressed.contains(&0x10),
            0xA2 => pressed.contains(&0xA2) || pressed.contains(&0xA3) || pressed.contains(&0x11),
            0xA4 => pressed.contains(&0xA4) || pressed.contains(&0xA5) || pressed.contains(&0x12),
            other => pressed.contains(&other),
        }
    })
}

/// Check if all required gamepad modifiers are currently pressed (via atomic).
fn gamepad_modifiers_held(required: &[u32]) -> bool {
    required.iter().all(|&vk| gamepad::is_gamepad_pressed(vk))
}

// ========================================================================
// Hook Callback
// ========================================================================

#[cfg(windows)]
unsafe extern "system" fn ll_keyboard_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code < 0 {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    let kbd = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
    let vk = kbd.vkCode;
    let w = wparam.0 as u32;

    // Skip injected events to avoid feedback loops
    const LLKHF_INJECTED: u32 = 0x10;
    if kbd.flags.0 & LLKHF_INJECTED != 0 {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    let is_down = w == WM_KEYDOWN || w == WM_SYSKEYDOWN;
    let is_up = w == WM_KEYUP || w == WM_SYSKEYUP;

    // Update shared pressed keys
    if is_down {
        PRESSED_KEYS.lock().insert(vk);
    } else if is_up {
        PRESSED_KEYS.lock().remove(&vk);
    }

    let mut should_swallow = false;

    HOOK_CTX.with(|ctx| {
        let ctx = ctx.borrow();

        if ctx.paused {
            return;
        }

        if !is_down && !is_up {
            return;
        }

        let pressed = PRESSED_KEYS.lock();

        // Check each keyboard-main chord
        for chord in &ctx.triggers {
            if chord.main_vk != vk {
                continue;
            }

            // Check keyboard modifiers
            if !modifiers_held(&chord.kb_modifier_vks, &pressed) {
                continue;
            }

            // Check gamepad modifiers (cross-input combo)
            if !gamepad_modifiers_held(&chord.gp_modifier_vks) {
                continue;
            }

            // Match found!
            if let Some(tx) = &ctx.action_tx {
                if is_down {
                    let _ = tx.send(HookAction::KeyDown(chord.trigger_idx));
                } else if is_up {
                    let _ = tx.send(HookAction::KeyUp(chord.trigger_idx));
                }
            }

            if !chord.passthrough {
                should_swallow = true;
            }
        }
    });

    if should_swallow {
        LRESULT(1)
    } else {
        CallNextHookEx(None, code, wparam, lparam)
    }
}

// ========================================================================
// Mouse Hook Callback
// ========================================================================

#[cfg(windows)]
unsafe extern "system" fn ll_mouse_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code < 0 {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    let msl = &*(lparam.0 as *const MSLLHOOKSTRUCT);
    let w = wparam.0 as u32;

    // Skip injected events to avoid feedback loops
    const LLMHF_INJECTED: u32 = 0x01;
    if msl.flags & LLMHF_INJECTED != 0 {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    // Map mouse message to VK + down/up
    let (vk, is_down, is_up) = match w {
        WM_LBUTTONDOWN => (0x01u32, true, false),
        WM_LBUTTONUP   => (0x01, false, true),
        WM_RBUTTONDOWN => (0x02, true, false),
        WM_RBUTTONUP   => (0x02, false, true),
        WM_MBUTTONDOWN => (0x04, true, false),
        WM_MBUTTONUP   => (0x04, false, true),
        WM_XBUTTONDOWN => {
            let xbutton = (msl.mouseData >> 16) & 0xFFFF;
            let vk = if xbutton == 1 { 0x05u32 } else { 0x06 };
            (vk, true, false)
        }
        WM_XBUTTONUP => {
            let xbutton = (msl.mouseData >> 16) & 0xFFFF;
            let vk = if xbutton == 1 { 0x05u32 } else { 0x06 };
            (vk, false, true)
        }
        _ => return CallNextHookEx(None, code, wparam, lparam),
    };

    // Update pressed state
    if is_down {
        PRESSED_KEYS.lock().insert(vk);
    } else if is_up {
        PRESSED_KEYS.lock().remove(&vk);
    }

    let mut should_swallow = false;

    HOOK_CTX.with(|ctx| {
        let ctx = ctx.borrow();
        if ctx.paused { return; }
        if !is_down && !is_up { return; }

        let pressed = PRESSED_KEYS.lock();

        for chord in &ctx.triggers {
            if chord.main_vk != vk { continue; }
            if !modifiers_held(&chord.kb_modifier_vks, &pressed) { continue; }
            if !gamepad_modifiers_held(&chord.gp_modifier_vks) { continue; }

            if let Some(tx) = &ctx.action_tx {
                if is_down {
                    let _ = tx.send(HookAction::KeyDown(chord.trigger_idx));
                } else if is_up {
                    let _ = tx.send(HookAction::KeyUp(chord.trigger_idx));
                }
            }

            if !chord.passthrough {
                should_swallow = true;
            }
        }
    });

    if should_swallow {
        LRESULT(1)
    } else {
        CallNextHookEx(None, code, wparam, lparam)
    }
}

// ========================================================================
// Daemon Main Loop
// ========================================================================

/// Run the hotkey daemon on the current thread.
#[cfg(windows)]
pub fn run_daemon(
    cmd_rx: Receiver<DaemonCommand>,
    event_tx: Sender<DaemonEvent>,
    initial_profile: Profile,
) {
    let (action_tx, action_rx) = crossbeam_channel::unbounded::<HookAction>();

    // Build trigger entries from the initial profile
    let mut triggers = build_triggers(&initial_profile);

    // Install the hook context
    update_hook_context(&triggers, action_tx.clone());

    // Install the low-level keyboard hook
    let kb_hook = unsafe {
        SetWindowsHookExW(WH_KEYBOARD_LL, Some(ll_keyboard_proc), None, 0)
    };

    let kb_hook = match kb_hook {
        Ok(h) => h,
        Err(e) => {
            let _ = event_tx.send(DaemonEvent::Error(format!(
                "Failed to install keyboard hook: {e}"
            )));
            return;
        }
    };

    // Install the low-level mouse hook
    let _mouse_hook = unsafe {
        SetWindowsHookExW(WH_MOUSE_LL, Some(ll_mouse_proc), None, 0)
    };

    match &_mouse_hook {
        Ok(_) => {},
        Err(e) => {
            eprintln!("[AuraKey] Warning: mouse hook failed: {e}");
        }
    }

    // Gamepad poller
    let mut gamepad = GamepadPoller::new(0);
    let mut gamepad_was_connected = false;
    let mut gamepad_backoff_counter: u32 = 0;
    const GAMEPAD_BACKOFF_TICKS: u32 = 2000; // ~2s at 1ms tick

    // ── Main loop: pump messages + gamepad + actions + commands ──
    loop {
        // 1. Pump Windows messages (required for WH_KEYBOARD_LL to work)
        unsafe {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }

        // 2. Poll gamepad (with backoff when disconnected)
        let should_poll = if gamepad.connected {
            true
        } else {
            gamepad_backoff_counter += 1;
            if gamepad_backoff_counter >= GAMEPAD_BACKOFF_TICKS {
                gamepad_backoff_counter = 0;
                true
            } else {
                false
            }
        };

        if should_poll {
            if let Some(events) = gamepad.poll() {
                // Connection status change
                if gamepad.connected != gamepad_was_connected {
                    gamepad_was_connected = gamepad.connected;
                    let _ = event_tx.send(DaemonEvent::GamepadStatus {
                        connected: gamepad.connected,
                    });
                    if gamepad.connected {
                        eprintln!("[AuraKey] Gamepad connected (XInput index {})", gamepad.controller_index);
                    } else {
                        eprintln!("[AuraKey] Gamepad disconnected");
                    }
                }

                // Process gamepad button events
                let paused = HOOK_CTX.with(|ctx| ctx.borrow().paused);
                if !paused {
                    for gp_event in &events {
                        for (idx, trigger) in triggers.iter().enumerate() {
                            for chord in &trigger.chords {
                                if !chord.is_gamepad_main || chord.main_vk != gp_event.vk {
                                    continue;
                                }
                                // Check gamepad modifier buttons
                                let gp_mods_held = chord.modifier_vks.iter()
                                    .filter(|v| gamepad::is_gamepad_vk(**v))
                                    .all(|&v| gamepad::is_gamepad_pressed(v));
                                if !gp_mods_held {
                                    continue;
                                }
                                // Check keyboard modifier keys (cross-input)
                                let kb_mods: Vec<u32> = chord.modifier_vks.iter()
                                    .filter(|v| !gamepad::is_gamepad_vk(**v))
                                    .copied()
                                    .collect();
                                let pressed = PRESSED_KEYS.lock();
                                if !modifiers_held(&kb_mods, &pressed) {
                                    continue;
                                }
                                // Match!
                                if gp_event.pressed {
                                    let _ = action_tx.send(HookAction::GamepadDown(idx));
                                } else {
                                    let _ = action_tx.send(HookAction::GamepadUp(idx));
                                }
                            }
                        }
                    }
                }
            } else if gamepad_was_connected {
                // Just disconnected
                gamepad_was_connected = false;
                let _ = event_tx.send(DaemonEvent::GamepadStatus { connected: false });
                eprintln!("[AuraKey] Gamepad disconnected");
            }
        }

        // 3. Process hook/gamepad actions (key matches from callback + poller)
        while let Ok(action) = action_rx.try_recv() {
            match action {
                HookAction::KeyDown(idx) | HookAction::GamepadDown(idx) => {
                    if idx < triggers.len() {
                        handle_key_down(&mut triggers[idx], &event_tx);
                    }
                }
                HookAction::KeyUp(idx) | HookAction::GamepadUp(idx) => {
                    if idx < triggers.len() {
                        handle_key_up(&mut triggers[idx], &event_tx);
                    }
                }
            }
        }

        // 4. Tick double-tap trackers
        for trigger in &mut triggers {
            if let Some(dt) = &mut trigger.double_tap {
                dt.tick();
            }
        }

        // 5. Check for GUI commands (non-blocking)
        while let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                DaemonCommand::Reload(profile) => {
                    MACRO_CANCEL.store(true, Ordering::Relaxed);
                    triggers = build_triggers(&profile);
                    update_hook_context(&triggers, action_tx.clone());
                    std::thread::sleep(std::time::Duration::from_millis(10));
                    MACRO_CANCEL.store(false, Ordering::Relaxed);
                }
                DaemonCommand::Pause => {
                    HOOK_CTX.with(|ctx| ctx.borrow_mut().paused = true);
                }
                DaemonCommand::Resume => {
                    HOOK_CTX.with(|ctx| ctx.borrow_mut().paused = false);
                }
                DaemonCommand::CancelAll => {
                    MACRO_CANCEL.store(true, Ordering::Relaxed);
                    for trigger in &triggers {
                        trigger.toggle_active.store(false, Ordering::Relaxed);
                    }
                    crate::input::release_all_held_keys();
                    std::thread::sleep(std::time::Duration::from_millis(10));
                    MACRO_CANCEL.store(false, Ordering::Relaxed);
                }
                DaemonCommand::Shutdown => {
                    MACRO_CANCEL.store(true, Ordering::Relaxed);
                    crate::input::release_all_held_keys();
                    unsafe { let _ = UnhookWindowsHookEx(kb_hook); }
                    return;
                }
            }
        }

        // Don't burn CPU
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
}

// ========================================================================
// Trigger Building
// ========================================================================

/// Build trigger entries from a profile.
fn build_triggers(profile: &Profile) -> Vec<TriggerEntry> {
    let mut entries = Vec::new();

    for group in &profile.groups {
        if !group.enabled {
            continue;
        }
        for macro_def in &group.macros {
            if !macro_def.enabled || macro_def.trigger.trigger_sets.is_empty() {
                continue;
            }

            let mut chords = Vec::new();

            for chord_keys in &macro_def.trigger.trigger_sets {
                if chord_keys.is_empty() {
                    continue;
                }

                let mut modifier_vks = Vec::new();
                let mut main_vk = 0u32;

                for &vk in chord_keys {
                    if gamepad::is_gamepad_vk(vk) {
                        // Gamepad buttons: last one is main, rest are modifiers
                        if main_vk != 0 && gamepad::is_gamepad_vk(main_vk) {
                            modifier_vks.push(main_vk);
                        }
                        main_vk = vk;
                    } else if is_modifier(vk) {
                        modifier_vks.push(normalize_modifier(vk));
                    } else {
                        // Keyboard non-modifier: this is the main key
                        // (push previous main to mods if it was gamepad)
                        if main_vk != 0 && gamepad::is_gamepad_vk(main_vk) {
                            modifier_vks.push(main_vk);
                        }
                        main_vk = vk;
                    }
                }

                // If all keys are modifiers (keyboard-only), use last as main
                if main_vk == 0 && !modifier_vks.is_empty() {
                    main_vk = chord_keys.last().copied().unwrap_or(0);
                    modifier_vks.pop();
                }

                if main_vk == 0 {
                    continue;
                }

                let is_gamepad_main = gamepad::is_gamepad_vk(main_vk);
                let is_mouse_main = crate::config::is_mouse_vk(main_vk);

                chords.push(TriggerChord {
                    modifier_vks,
                    main_vk,
                    // Mouse and gamepad buttons always pass through by default
                    passthrough: macro_def.trigger.passthrough || is_gamepad_main || is_mouse_main,
                    is_gamepad_main,
                });
            }

            if chords.is_empty() {
                continue;
            }

            let double_tap = if macro_def.trigger.mode == TriggerMode::DoubleTap {
                Some(DoubleTapTracker::new(macro_def.trigger.timeout_ms))
            } else {
                None
            };

            entries.push(TriggerEntry {
                macro_def: macro_def.clone(),
                chords,
                double_tap,
                long_press_start: None,
                toggle_active: Arc::new(AtomicBool::new(false)),
            });

            eprintln!(
                "[AuraKey] Registered trigger '{}' mode={:?} chords={}",
                macro_def.name,
                macro_def.trigger.mode,
                entries.last().unwrap().chords.iter()
                    .map(|c| format!("main=0x{:X} mods={:?} gp={}", c.main_vk, c.modifier_vks, c.is_gamepad_main))
                    .collect::<Vec<_>>().join(" | ")
            );
        }
    }

    entries
}

/// Push keyboard-main chord snapshots into the hook's thread-local context.
fn update_hook_context(
    triggers: &[TriggerEntry],
    action_tx: crossbeam_channel::Sender<HookAction>,
) {
    let mut snapshots = Vec::new();

    for (idx, trigger) in triggers.iter().enumerate() {
        for chord in &trigger.chords {
            // Only keyboard-main chords go in the hook context
            if chord.is_gamepad_main {
                continue;
            }

            let (kb_mods, gp_mods): (Vec<u32>, Vec<u32>) = chord
                .modifier_vks
                .iter()
                .partition(|v| !gamepad::is_gamepad_vk(**v));

            snapshots.push(ChordSnapshot {
                trigger_idx: idx,
                kb_modifier_vks: kb_mods,
                gp_modifier_vks: gp_mods,
                main_vk: chord.main_vk,
                passthrough: chord.passthrough,
            });
        }
    }

    HOOK_CTX.with(|ctx| {
        let mut ctx = ctx.borrow_mut();
        ctx.triggers = snapshots;
        ctx.action_tx = Some(action_tx);
        ctx.paused = false;
    });

    // Clear shared pressed state on reload
    PRESSED_KEYS.lock().clear();
}

// ========================================================================
// Event Handlers
// ========================================================================

fn handle_key_down(trigger: &mut TriggerEntry, event_tx: &Sender<DaemonEvent>) {
    let macro_name = trigger.macro_def.name.clone();

    match trigger.macro_def.trigger.mode {
        TriggerMode::Press => {
            fire_macro(&trigger.macro_def, event_tx);
        }
        TriggerMode::Hold => {
            let flag = trigger.toggle_active.clone();
            flag.store(true, Ordering::Relaxed);
            let _ = event_tx.send(DaemonEvent::ContinuousActive {
                name: macro_name,
                active: true,
            });
            start_continuous(&trigger.macro_def, flag);
        }
        TriggerMode::Toggle => {
            let was_active = trigger.toggle_active.load(Ordering::Relaxed);
            if was_active {
                trigger.toggle_active.store(false, Ordering::Relaxed);
                let _ = event_tx.send(DaemonEvent::ContinuousActive {
                    name: macro_name,
                    active: false,
                });
            } else {
                let flag = trigger.toggle_active.clone();
                flag.store(true, Ordering::Relaxed);
                let _ = event_tx.send(DaemonEvent::ContinuousActive {
                    name: macro_name,
                    active: true,
                });
                start_continuous(&trigger.macro_def, flag);
            }
        }
        TriggerMode::DoubleTap => {
            if let Some(dt) = &mut trigger.double_tap {
                if dt.on_press() {
                    fire_macro(&trigger.macro_def, event_tx);
                }
            }
        }
        TriggerMode::LongPress => {
            trigger.long_press_start = Some(Instant::now());
        }
        TriggerMode::Release => {
            // Release mode fires on key up, not down — do nothing here
        }
    }
}

fn handle_key_up(trigger: &mut TriggerEntry, event_tx: &Sender<DaemonEvent>) {
    let macro_name = trigger.macro_def.name.clone();

    match trigger.macro_def.trigger.mode {
        TriggerMode::Hold => {
            trigger.toggle_active.store(false, Ordering::Relaxed);
            let _ = event_tx.send(DaemonEvent::ContinuousActive {
                name: macro_name,
                active: false,
            });
        }
        TriggerMode::LongPress => {
            if let Some(start) = trigger.long_press_start.take() {
                let threshold = trigger.macro_def.trigger.long_press_ms as u128;
                if start.elapsed().as_millis() >= threshold {
                    fire_macro(&trigger.macro_def, event_tx);
                }
            }
        }
        TriggerMode::Release => {
            fire_macro(&trigger.macro_def, event_tx);
        }
        _ => {}
    }
}

// ========================================================================
// Macro Execution
// ========================================================================

fn fire_macro(macro_def: &MacroDef, event_tx: &Sender<DaemonEvent>) {
    let mode = macro_def.output_mode.clone();
    let name = macro_def.name.clone();

    let _ = event_tx.send(DaemonEvent::MacroStarted { name });

    match macro_def.execution.mode {
        ExecutionMode::Sequential => {
            let steps = executor::steps_to_sequential(&macro_def.steps);
            executor::spawn_oneshot(steps, mode);
        }
        ExecutionMode::Timeline => {
            let timeline = executor::steps_to_timeline(&macro_def.steps);
            executor::spawn_timeline(timeline, mode);
        }
        ExecutionMode::Continuous => {
            let steps = executor::steps_to_sequential(&macro_def.steps);
            executor::spawn_oneshot(steps, mode);
        }
    }
}

fn start_continuous(macro_def: &MacroDef, trigger_held: Arc<AtomicBool>) {
    let mode = macro_def.output_mode.clone();
    let exec = &macro_def.execution;

    let state = match exec.pattern {
        ContinuousPattern::KeyCycle => {
            ContinuousState::KeyCycle(KeyCycleState::new(exec.cycle_keys.clone(), exec.rate_ms))
        }
        ContinuousPattern::MouseOscillate => {
            ContinuousState::MouseOscillate(MouseOscillateState::new(
                exec.amplitude,
                exec.vertical_comp,
                exec.rate_ms,
            ))
        }
    };

    executor::spawn_continuous_loop(state, trigger_held, mode);
}
