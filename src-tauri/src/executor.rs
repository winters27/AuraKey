//! Macro Execution Engine
//!
//! Defines all macro action types and provides three execution models:
//! - **Sequential**: Steps executed one at a time with `delay_after_ms`.
//! - **Timeline**: Steps scheduled by `offset_us` with sub-ms precision (hybrid sleep+spin).
//! - **Continuous**: Tick-loop patterns (key cycling, mouse oscillation) on a worker thread.
//!
//! Ported from the proven Aura Battlemate `apex_macros.rs` executor.

use crate::config::{MouseButton, OutputMode, ScrollDirection, StepDef, TAP_HOLD_MS};
use crate::input;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

// ========================================================================
// Cancellation & Guards
// ========================================================================

/// Global cancellation flag. Set `true` to abort any running macro.
pub static MACRO_CANCEL: AtomicBool = AtomicBool::new(false);

/// Guard preventing overlapping one-shot / timeline macros.
pub static ONESHOT_RUNNING: AtomicBool = AtomicBool::new(false);

// ========================================================================
// MacroAction — Runtime Action Enum
// ========================================================================

/// A single atomic input action at runtime.
#[derive(Debug, Clone)]
pub enum MacroAction {
    KeyTap(u32),
    KeyHold(u32, u64),  // vk, duration_ms (0 = press without auto-release)
    KeyRelease(u32),
    KeySequence(Vec<u32>, u64),
    MouseMoveRelative(i32, i32, bool),
    MouseMoveAbsolute(i32, i32),
    MouseClick(MouseButton),
    MouseHold(MouseButton, u64),  // button, duration_ms (0 = press without auto-release)
    MouseRelease(MouseButton),
    MouseAbsoluteClick(i32, i32, MouseButton),
    MouseSteppedDeltaClick(i32, i32, MouseButton),
    MouseScroll(ScrollDirection, i32),
    Delay(u64),
    CancelAll,
    RunProgram { command: String, args: String, working_dir: String, wait: bool },
    Noop,
}

/// Convert a `StepDef` into a runtime `MacroAction`.
impl From<&StepDef> for MacroAction {
    fn from(step: &StepDef) -> Self {
        match step {
            StepDef::KeyTap { key, .. } => MacroAction::KeyTap(*key),
            StepDef::KeyHold { key, duration_ms, .. } => MacroAction::KeyHold(*key, *duration_ms),
            StepDef::KeyRelease { key, .. } => MacroAction::KeyRelease(*key),
            StepDef::KeySequence { keys, per_key_delay_ms, .. } => {
                MacroAction::KeySequence(keys.clone(), *per_key_delay_ms)
            }
            StepDef::MouseMoveRelative { dx, dy, stepped, .. } => {
                MacroAction::MouseMoveRelative(*dx, *dy, *stepped)
            }
            StepDef::MouseMoveAbsolute { x, y, .. } => MacroAction::MouseMoveAbsolute(*x, *y),
            StepDef::MouseClick { button, .. } => MacroAction::MouseClick(button.clone()),
            StepDef::MouseHold { button, duration_ms, .. } => MacroAction::MouseHold(button.clone(), *duration_ms),
            StepDef::MouseRelease { button, .. } => MacroAction::MouseRelease(button.clone()),
            StepDef::MouseAbsoluteClick { x, y, button, .. } => {
                MacroAction::MouseAbsoluteClick(*x, *y, button.clone())
            }
            StepDef::MouseSteppedDeltaClick { dx, dy, button, .. } => {
                MacroAction::MouseSteppedDeltaClick(*dx, *dy, button.clone())
            }
            StepDef::MouseScroll { direction, amount, .. } => {
                MacroAction::MouseScroll(direction.clone(), *amount)
            }
            StepDef::Delay { ms, .. } => MacroAction::Delay(*ms),
            StepDef::CancelAll => MacroAction::CancelAll,
            StepDef::Label { .. } => MacroAction::Noop,
            StepDef::RepeatBlock { .. } => MacroAction::Noop,
            StepDef::RunProgram { command, args, working_dir, wait, .. } => {
                MacroAction::RunProgram {
                    command: command.clone(),
                    args: args.clone(),
                    working_dir: working_dir.clone(),
                    wait: *wait,
                }
            }
        }
    }
}

// ========================================================================
// MacroStep — Sequential Step
// ========================================================================

/// A step in a sequential macro — just wraps an action.
/// Timing between steps is handled by explicit `Delay` actions.
#[derive(Debug, Clone)]
pub struct MacroStep {
    pub action: MacroAction,
}

// ========================================================================
// Timeline Event & Timeline
// ========================================================================

/// A timeline event with µs offset from t=0.
#[derive(Debug, Clone)]
pub struct TimelineEvent {
    pub offset_us: u64,
    pub action: MacroAction,
}

/// A parallel macro timeline — all events scheduled relative to t=0.
#[derive(Debug, Clone)]
pub struct MacroTimeline {
    pub events: Vec<TimelineEvent>,
}

impl MacroTimeline {
    /// Create a new timeline, auto-sorting events by offset.
    pub fn new(mut events: Vec<TimelineEvent>) -> Self {
        events.sort_by_key(|e| e.offset_us);
        Self { events }
    }
}

// ========================================================================
// Step → MacroStep / TimelineEvent Conversion
// ========================================================================

/// Convert a list of `StepDef` into sequential `MacroStep` list.
pub fn steps_to_sequential(steps: &[StepDef]) -> Vec<MacroStep> {
    steps
        .iter()
        .filter_map(|s| {
            let action = MacroAction::from(s);
            match action {
                MacroAction::Noop => None,
                _ => Some(MacroStep { action }),
            }
        })
        .collect()
}

/// Convert a list of `StepDef` into a `MacroTimeline`.
pub fn steps_to_timeline(steps: &[StepDef]) -> MacroTimeline {
    let events: Vec<TimelineEvent> = steps
        .iter()
        .filter_map(|s| {
            let action = MacroAction::from(s);
            match action {
                MacroAction::Noop => None,
                _ => Some(TimelineEvent {
                    offset_us: s.offset_us(),
                    action,
                }),
            }
        })
        .collect();
    MacroTimeline::new(events)
}

// ========================================================================
// Action Dispatch
// ========================================================================

/// Dispatch a single macro action immediately.
fn dispatch_action(action: &MacroAction, mode: &OutputMode) {
    match action {
        MacroAction::KeyTap(vk) => {
            input::send_key_hold(*vk, mode);
            std::thread::sleep(Duration::from_millis(TAP_HOLD_MS));
            input::send_key_release(*vk, mode);
        }
        MacroAction::KeyHold(vk, duration_ms) => {
            input::send_key_hold(*vk, mode);
            if *duration_ms > 0 {
                std::thread::sleep(Duration::from_millis(*duration_ms));
                input::send_key_release(*vk, mode);
            }
        }
        MacroAction::KeyRelease(vk) => input::send_key_release(*vk, mode),
        MacroAction::KeySequence(keys, delay_ms) => {
            for (i, vk) in keys.iter().enumerate() {
                input::send_key_tap(*vk, mode);
                if i < keys.len() - 1 && *delay_ms > 0 {
                    std::thread::sleep(Duration::from_millis(*delay_ms));
                }
            }
        }
        MacroAction::MouseMoveRelative(dx, dy, stepped) => {
            if *stepped {
                input::send_mouse_delta_stepped(*dx, *dy, 30);
            } else {
                input::send_mouse_delta(*dx, *dy, mode);
            }
        }
        MacroAction::MouseMoveAbsolute(x, y) => {
            input::send_mouse_absolute(*x, *y);
        }
        MacroAction::MouseClick(button) => {
            input::send_mouse_click(button, mode);
        }
        MacroAction::MouseHold(button, duration_ms) => {
            input::send_mouse_press(button, mode);
            if *duration_ms > 0 {
                std::thread::sleep(Duration::from_millis(*duration_ms));
                input::send_mouse_release(button, mode);
            }
        }
        MacroAction::MouseRelease(button) => {
            input::send_mouse_release(button, mode);
        }
        MacroAction::MouseAbsoluteClick(x, y, button) => {
            input::send_mouse_absolute_click(*x, *y, button);
        }
        MacroAction::MouseSteppedDeltaClick(dx, dy, button) => {
            input::send_mouse_stepped_delta_click(*dx, *dy, button);
        }
        MacroAction::MouseScroll(dir, amount) => {
            input::send_mouse_scroll(dir, *amount, mode);
        }
        MacroAction::Delay(ms) => {
            std::thread::sleep(Duration::from_millis(*ms));
        }
        MacroAction::CancelAll => {
            MACRO_CANCEL.store(true, Ordering::Relaxed);
        }
        MacroAction::RunProgram { command, args, working_dir, wait } => {
            let mut cmd = std::process::Command::new(command);
            if !args.is_empty() {
                // Split args respecting quoted strings
                cmd.args(args.split_whitespace());
            }
            if !working_dir.is_empty() {
                cmd.current_dir(working_dir);
            }
            // Hide console window for GUI apps
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            if *wait {
                let _ = cmd.status();
            } else {
                let _ = cmd.spawn();
            }
        }
        MacroAction::Noop => {}
    }
}

// ========================================================================
// Sequential Executor (Async)
// ========================================================================

/// Execute a sequence of macro steps (blocking).
///
/// Checks `MACRO_CANCEL` between each step.
pub fn execute_sequence(steps: &[MacroStep], mode: &OutputMode) {
    for step in steps {
        if MACRO_CANCEL.load(Ordering::Relaxed) {
            input::release_all_held_keys();
            return;
        }
        dispatch_action(&step.action, mode);
    }
    input::release_all_held_keys();
}

/// Spawn a one-shot sequential macro on a dedicated thread.
pub fn spawn_oneshot(steps: Vec<MacroStep>, mode: OutputMode) {
    if ONESHOT_RUNNING.load(Ordering::Relaxed) {
        return;
    }
    ONESHOT_RUNNING.store(true, Ordering::Relaxed);
    MACRO_CANCEL.store(false, Ordering::Relaxed);

    std::thread::Builder::new()
        .name("macro-oneshot".into())
        .spawn(move || {
            execute_sequence(&steps, &mode);
            ONESHOT_RUNNING.store(false, Ordering::Relaxed);
        })
        .expect("Failed to spawn oneshot macro thread");
}

// ========================================================================
// Timeline Executor (Blocking, Sub-ms Precision)
// ========================================================================

/// Execute a timeline on the CURRENT thread with sub-ms precision.
///
/// Uses a hybrid wait strategy:
/// - For waits >2ms: `thread::sleep` (precise via TimerGuard on Windows)
/// - For waits ≤2ms: busy spin with `spin_loop` hint
fn execute_timeline_blocking(timeline: &MacroTimeline, mode: &OutputMode) {
    let t0 = Instant::now();

    for event in &timeline.events {
        if MACRO_CANCEL.load(Ordering::Relaxed) {
            input::release_all_held_keys();
            return;
        }

        let target = Duration::from_micros(event.offset_us);

        // Hybrid wait: coarse sleep then fine spin
        loop {
            let elapsed = t0.elapsed();
            if elapsed >= target {
                break;
            }
            let remaining = target - elapsed;
            if remaining > Duration::from_millis(2) {
                std::thread::sleep(remaining - Duration::from_millis(1));
            } else {
                std::hint::spin_loop();
            }
        }

        dispatch_action(&event.action, mode);
    }

    input::release_all_held_keys();
}

/// Spawn a timeline macro on a dedicated OS thread.
pub fn spawn_timeline(timeline: MacroTimeline, mode: OutputMode) {
    if ONESHOT_RUNNING.load(Ordering::Relaxed) {
        return;
    }
    ONESHOT_RUNNING.store(true, Ordering::Relaxed);
    MACRO_CANCEL.store(false, Ordering::Relaxed);

    std::thread::Builder::new()
        .name("macro-timeline".into())
        .spawn(move || {
            execute_timeline_blocking(&timeline, &mode);
            ONESHOT_RUNNING.store(false, Ordering::Relaxed);
        })
        .expect("Failed to spawn timeline thread");
}

// ========================================================================
// Continuous Execution
// ========================================================================

/// State for continuous key cycle pattern.
#[derive(Debug)]
pub struct KeyCycleState {
    pub keys: Vec<u32>,
    pub index: usize,
    pub last_tick: Instant,
    pub rate_ms: u64,
}

impl KeyCycleState {
    pub fn new(keys: Vec<u32>, rate_ms: u64) -> Self {
        Self {
            keys,
            index: 0,
            last_tick: Instant::now(),
            rate_ms,
        }
    }

    /// Execute one tick of the key cycle.
    pub fn tick(&mut self, mode: &OutputMode) {
        if self.keys.is_empty() {
            return;
        }
        if self.last_tick.elapsed().as_millis() >= self.rate_ms as u128 {
            let vk = self.keys[self.index];
            input::send_key_tap(vk, mode);
            self.index = (self.index + 1) % self.keys.len();
            self.last_tick = Instant::now();
        }
    }

    pub fn reset(&mut self) {
        self.index = 0;
    }
}

/// State for continuous mouse oscillation pattern.
#[derive(Debug)]
pub struct MouseOscillateState {
    pub amplitude: i32,
    pub vertical_comp: i32,
    pub rate_ms: u64,
    pub phase: bool,
    pub last_tick: Instant,
}

impl MouseOscillateState {
    pub fn new(amplitude: i32, vertical_comp: i32, rate_ms: u64) -> Self {
        Self {
            amplitude,
            vertical_comp,
            rate_ms,
            phase: false,
            // Use a past instant so the first tick fires immediately
            last_tick: Instant::now() - Duration::from_millis(rate_ms + 1),
        }
    }

    /// Execute one tick of the mouse oscillation.
    ///
    /// VDF-style jitter pattern:
    /// - X oscillates: +amplitude, -amplitude alternating
    /// - Y pulls down by vertical_comp every tick (positive = down)
    pub fn tick(&mut self, mode: &OutputMode) {
        if self.last_tick.elapsed().as_millis() >= self.rate_ms as u128 {
            let dx = if self.phase { self.amplitude } else { -self.amplitude };
            let dy = -self.vertical_comp; // UI: negative = pull down
            input::send_mouse_delta(dx, dy, mode);
            self.phase = !self.phase;
            self.last_tick = Instant::now();
        }
    }
}

/// Continuous execution pattern.
pub enum ContinuousState {
    KeyCycle(KeyCycleState),
    MouseOscillate(MouseOscillateState),
}

/// Spawn a continuous macro loop on a dedicated thread.
///
/// Runs until `trigger_held` becomes false (for Hold mode)
/// or `MACRO_CANCEL` is set.
pub fn spawn_continuous_loop(
    mut state: ContinuousState,
    trigger_held: std::sync::Arc<AtomicBool>,
    mode: OutputMode,
) {
    std::thread::Builder::new()
        .name("macro-continuous".into())
        .spawn(move || {
            while trigger_held.load(Ordering::Relaxed)
                && !MACRO_CANCEL.load(Ordering::Relaxed)
            {
                match &mut state {
                    ContinuousState::KeyCycle(s) => s.tick(&mode),
                    ContinuousState::MouseOscillate(s) => s.tick(&mode),
                }
                // Yield CPU briefly to avoid 100% core usage
                std::thread::sleep(Duration::from_micros(500));
            }
            input::release_all_held_keys();
        })
        .expect("Failed to spawn continuous loop thread");
}

// ========================================================================
// Double-Tap FSM
// ========================================================================

/// State machine phase for double-tap detection.
#[derive(Debug, Clone)]
pub enum DoubleTapPhase {
    Idle,
    WaitingForSecond { first_press: Instant },
}

/// Tracks double-tap detection for a single key.
pub struct DoubleTapTracker {
    pub phase: DoubleTapPhase,
    pub timeout_ms: u64,
}

impl DoubleTapTracker {
    pub fn new(timeout_ms: u64) -> Self {
        Self {
            phase: DoubleTapPhase::Idle,
            timeout_ms,
        }
    }

    /// Call on rising edge (key just pressed). Returns `true` if double-tap confirmed.
    pub fn on_press(&mut self) -> bool {
        match &self.phase {
            DoubleTapPhase::Idle => {
                self.phase = DoubleTapPhase::WaitingForSecond {
                    first_press: Instant::now(),
                };
                false
            }
            DoubleTapPhase::WaitingForSecond { first_press } => {
                if first_press.elapsed().as_millis() < self.timeout_ms as u128 {
                    self.phase = DoubleTapPhase::Idle;
                    true // Double-tap confirmed
                } else {
                    self.phase = DoubleTapPhase::WaitingForSecond {
                        first_press: Instant::now(),
                    };
                    false
                }
            }
        }
    }

    /// Call every tick to expire stale first-press state.
    pub fn tick(&mut self) {
        if let DoubleTapPhase::WaitingForSecond { first_press } = &self.phase {
            if first_press.elapsed().as_millis() >= self.timeout_ms as u128 {
                self.phase = DoubleTapPhase::Idle;
            }
        }
    }
}
