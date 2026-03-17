//! Sequence Recorder — Windows Input Hook Engine
//!
//! Captures keyboard and mouse input events using low-level Windows hooks
//! (`WH_KEYBOARD_LL` + `WH_MOUSE_LL`) and produces editable step lists.
//!
//! Runs on a dedicated thread with its own Windows message pump (hooks require it).

use crate::config::{MouseButton, ScrollDirection, StepDef};
use crossbeam_channel::{Receiver, Sender};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

// ========================================================================
// Raw Event Types
// ========================================================================

/// A raw captured input event with timestamp.
#[derive(Debug, Clone)]
pub enum RawEvent {
    KeyDown { vk: u32, time: Instant },
    KeyUp { vk: u32, time: Instant },
    MouseMove { dx: i32, dy: i32, time: Instant },
    MouseClick { button: MouseButton, x: i32, y: i32, time: Instant },
    MouseScroll { direction: ScrollDirection, amount: i32, time: Instant },
}

/// Result sent back to the GUI after recording completes.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RecordingResult {
    /// Captured steps (already converted from raw events).
    pub steps: Vec<StepDef>,
    /// Total recording duration in ms.
    pub duration_ms: u64,
    /// Whether any steps overlap in time (suggests Timeline mode).
    pub has_overlaps: bool,
}

// ========================================================================
// Recording Commands (GUI → Recorder)
// ========================================================================

/// Commands sent from the GUI to the recorder thread.
pub enum RecorderCommand {
    /// Start recording with the given stop key VK code.
    Start { stop_key: u32 },
    /// Force stop recording.
    Stop,
    /// Shut down the recorder thread.
    Shutdown,
}

// ========================================================================
// Recorder Engine
// ========================================================================

/// Recording engine state.
pub struct RecordingEngine {
    /// Channel to receive commands from GUI.
    cmd_rx: Receiver<RecorderCommand>,
    /// Channel to send results back to GUI.
    result_tx: Sender<RecordingResult>,
    /// Whether currently recording.
    is_recording: Arc<AtomicBool>,
    /// Accumulated raw events.
    events: Vec<RawEvent>,
    /// Recording start time.
    start_time: Option<Instant>,
    /// Stop key VK code.
    stop_key: u32,
    /// Mouse accumulation threshold (ms).
    mouse_accum_ms: u64,
    /// Max recording duration (seconds).
    max_duration_secs: u64,
}

impl RecordingEngine {
    /// Create a new recording engine.
    pub fn new(
        cmd_rx: Receiver<RecorderCommand>,
        result_tx: Sender<RecordingResult>,
        mouse_accum_ms: u64,
        max_duration_secs: u64,
    ) -> Self {
        Self {
            cmd_rx,
            result_tx,
            is_recording: Arc::new(AtomicBool::new(false)),
            events: Vec::new(),
            start_time: None,
            stop_key: 0x7B, // F12 default
            mouse_accum_ms,
            max_duration_secs,
        }
    }

    /// Get a shared reference to the recording flag.
    pub fn is_recording_flag(&self) -> Arc<AtomicBool> {
        self.is_recording.clone()
    }

    /// Main loop — processes commands and runs recording when active.
    ///
    /// This must run on a dedicated thread. When recording is active,
    /// it installs Windows hooks and runs a message pump.
    pub fn run(&mut self) {
        loop {
            match self.cmd_rx.recv() {
                Ok(RecorderCommand::Start { stop_key }) => {
                    self.stop_key = stop_key;
                    self.events.clear();
                    self.start_time = Some(Instant::now());
                    self.is_recording.store(true, Ordering::Relaxed);

                    // Run the recording loop (blocks until stop)
                    self.record_loop();

                    self.is_recording.store(false, Ordering::Relaxed);

                    // Convert raw events to steps and send result
                    let result = self.build_result();
                    let _ = self.result_tx.send(result);
                }
                Ok(RecorderCommand::Stop) => {
                    self.is_recording.store(false, Ordering::Relaxed);
                }
                Ok(RecorderCommand::Shutdown) => break,
                Err(_) => break, // Channel closed
            }
        }
    }

    /// Record input events using low-level polling.
    ///
    /// Note: Full WH_KEYBOARD_LL / WH_MOUSE_LL hook implementation requires
    /// SetWindowsHookEx with a message pump. For the initial build, we use
    /// a polling-based approach with GetAsyncKeyState.
    fn record_loop(&mut self) {
        use std::thread;
        use std::time::Duration;

        let mut prev_keys = [false; 256];
        let start = self.start_time.unwrap();
        let max_dur = Duration::from_secs(self.max_duration_secs);

        // Initialize previous key states
        for vk in 0..256u32 {
            prev_keys[vk as usize] = crate::input::is_key_pressed(vk);
        }

        while self.is_recording.load(Ordering::Relaxed) {
            // Check max duration
            if start.elapsed() > max_dur {
                break;
            }

            // Check for stop command (non-blocking)
            if let Ok(RecorderCommand::Stop) = self.cmd_rx.try_recv() {
                break;
            }

            // Poll all keys
            for vk in 1..256u32 {
                let pressed = crate::input::is_key_pressed(vk);
                let was_pressed = prev_keys[vk as usize];

                if pressed && !was_pressed {
                    // Key down
                    if vk == self.stop_key {
                        // Stop key — don't record, just stop
                        self.is_recording.store(false, Ordering::Relaxed);
                        return;
                    }
                    self.events.push(RawEvent::KeyDown {
                        vk,
                        time: Instant::now(),
                    });
                } else if !pressed && was_pressed {
                    // Key up
                    self.events.push(RawEvent::KeyUp {
                        vk,
                        time: Instant::now(),
                    });
                }

                prev_keys[vk as usize] = pressed;
            }

            // Poll at ~1000Hz
            thread::sleep(Duration::from_millis(1));
        }
    }

    /// Convert raw events into steps and build a RecordingResult.
    ///
    /// Strategy:
    /// 1. Collapse KeyDown + KeyUp pairs: short (≤20ms) → KeyTap, long → KeyHold+KeyRelease.
    /// 2. Insert explicit Delay steps between actions for timing gaps.
    fn build_result(&self) -> RecordingResult {
        let start = match self.start_time {
            Some(t) => t,
            None => {
                return RecordingResult {
                    steps: Vec::new(),
                    duration_ms: 0,
                    has_overlaps: false,
                };
            }
        };

        if self.events.is_empty() {
            return RecordingResult {
                steps: Vec::new(),
                duration_ms: 0,
                has_overlaps: false,
            };
        }

        // ── Phase 1: Collapse KeyDown+KeyUp into KeyTap ──
        // Match each KeyDown to its closest subsequent KeyUp for the same VK.
        struct TimedStep {
            step: StepDef,
            time: Instant,
        }

        let mut timed_steps: Vec<TimedStep> = Vec::new();
        let mut consumed_ups: std::collections::HashSet<usize> = std::collections::HashSet::new();
        // Helper: don't collapse modifier keys into KeyTap — they must stay as
        // KeyHold/KeyRelease so the modifier is held while wrapped keys fire.
        let is_modifier_vk = |vk: u32| -> bool {
            matches!(vk,
                0xA0 | 0xA1 | // LShift, RShift
                0xA2 | 0xA3 | // LCtrl, RCtrl
                0xA4 | 0xA5 | // LAlt, RAlt
                0x5B | 0x5C | // LWin, RWin
                0x10 | 0x11 | 0x12  // Generic Shift, Ctrl, Alt
            )
        };

        // Find matching KeyUp for each KeyDown
        for (i, event) in self.events.iter().enumerate() {
            match event {
                RawEvent::KeyDown { vk, time } => {
                    // Modifiers must NOT be collapsed — keep as Hold/Release
                    if is_modifier_vk(*vk) {
                        let offset = time.duration_since(start).as_micros() as u64;
                        timed_steps.push(TimedStep {
                            step: StepDef::KeyHold {
                                key: *vk,
                                duration_ms: 0,
                                offset_us: offset,
                                delay_after_ms: 0,
                            },
                            time: *time,
                        });
                        continue;
                    }

                    // Look for the matching KeyUp
                    let mut found_up = false;
                    for (j, up_event) in self.events.iter().enumerate().skip(i + 1) {
                        if let RawEvent::KeyUp { vk: up_vk, time: up_time } = up_event {
                            if *up_vk == *vk && !consumed_ups.contains(&j) {
                                let hold_ms = up_time.duration_since(*time).as_millis() as u64;
                                let offset = time.duration_since(start).as_micros() as u64;

                                if hold_ms <= 20 {
                                    // Short press → instant KeyTap
                                    timed_steps.push(TimedStep {
                                        step: StepDef::KeyTap {
                                            key: *vk,
                                            hold_ms: 0,
                                            delay_after_ms: 0,
                                            offset_us: offset,
                                        },
                                        time: *time,
                                    });
                                } else {
                                    // Long press → KeyHold + KeyRelease
                                    timed_steps.push(TimedStep {
                                        step: StepDef::KeyHold {
                                            key: *vk,
                                            duration_ms: hold_ms,
                                            offset_us: offset,
                                            delay_after_ms: 0,
                                        },
                                        time: *time,
                                    });
                                    let up_offset = up_time.duration_since(start).as_micros() as u64;
                                    timed_steps.push(TimedStep {
                                        step: StepDef::KeyRelease {
                                            key: *vk,
                                            offset_us: up_offset,
                                            delay_after_ms: 0,
                                        },
                                        time: *up_time,
                                    });
                                }

                                consumed_ups.insert(j);
                                found_up = true;
                                break;
                            }
                        }
                    }
                    if !found_up {
                        // No matching up — keep as KeyHold (press without auto-release)
                        let offset = time.duration_since(start).as_micros() as u64;
                        timed_steps.push(TimedStep {
                            step: StepDef::KeyHold {
                                key: *vk,
                                duration_ms: 0,
                                offset_us: offset,
                                delay_after_ms: 0,
                            },
                            time: *time,
                        });
                    }
                }
                RawEvent::KeyUp { vk, time } => {
                    if consumed_ups.contains(&i) {
                        continue; // Already collapsed into a KeyTap
                    }
                    // Orphan key up — keep it
                    let offset = time.duration_since(start).as_micros() as u64;
                    timed_steps.push(TimedStep {
                        step: StepDef::KeyRelease {
                            key: *vk,
                            offset_us: offset,
                            delay_after_ms: 0,
                        },
                        time: *time,
                    });
                }
                RawEvent::MouseClick { button, x, y, time } => {
                    let offset = time.duration_since(start).as_micros() as u64;
                    timed_steps.push(TimedStep {
                        step: StepDef::MouseAbsoluteClick {
                            x: *x,
                            y: *y,
                            button: button.clone(),
                            offset_us: offset,
                            delay_after_ms: 0,
                        },
                        time: *time,
                    });
                }
                RawEvent::MouseMove { dx, dy, time } => {
                    let offset = time.duration_since(start).as_micros() as u64;
                    timed_steps.push(TimedStep {
                        step: StepDef::MouseMoveRelative {
                            dx: *dx,
                            dy: *dy,
                            stepped: false,
                            offset_us: offset,
                            delay_after_ms: 0,
                        },
                        time: *time,
                    });
                }
                RawEvent::MouseScroll { direction, amount, time } => {
                    let offset = time.duration_since(start).as_micros() as u64;
                    timed_steps.push(TimedStep {
                        step: StepDef::MouseScroll {
                            direction: direction.clone(),
                            amount: *amount,
                            offset_us: offset,
                            delay_after_ms: 0,
                        },
                        time: *time,
                    });
                }
            }
        }

        // ── Phase 2: Sort by time and insert explicit Delay steps ──
        timed_steps.sort_by_key(|ts| ts.time);

        let mut steps: Vec<StepDef> = Vec::with_capacity(timed_steps.len() * 2);
        let mut has_overlaps = false;
        let mut last_offset: u64 = 0;

        for i in 0..timed_steps.len() {
            let step = timed_steps[i].step.clone();

            // Overlap detection
            let offset = step.offset_us();
            if offset < last_offset + 1000 && !steps.is_empty() {
                has_overlaps = true;
            }
            last_offset = offset;

            steps.push(step);

            // Insert explicit Delay for the gap to the next event
            if i + 1 < timed_steps.len() {
                let gap = timed_steps[i + 1].time.saturating_duration_since(timed_steps[i].time);
                let gap_ms = gap.as_millis() as u64;
                if gap_ms > 0 {
                    steps.push(StepDef::Delay { ms: gap_ms, offset_us: 0 });
                }
            }
        }

        let duration_ms = self
            .events
            .last()
            .map(|e| {
                let t = match e {
                    RawEvent::KeyDown { time, .. }
                    | RawEvent::KeyUp { time, .. }
                    | RawEvent::MouseMove { time, .. }
                    | RawEvent::MouseClick { time, .. }
                    | RawEvent::MouseScroll { time, .. } => *time,
                };
                t.duration_since(start).as_millis() as u64
            })
            .unwrap_or(0);

        RecordingResult {
            steps,
            duration_ms,
            has_overlaps,
        }
    }
}

// ========================================================================
// Post-Processing Functions
// ========================================================================

/// Collapse all delays below threshold to 0.
pub fn normalize_delays(steps: &mut [StepDef], threshold_ms: u64) {
    let threshold_us = threshold_ms * 1000;
    let mut prev_offset: u64 = 0;
    for step in steps.iter_mut() {
        let offset = step.offset_us();
        if offset > 0 && offset - prev_offset < threshold_us {
            set_offset_us(step, prev_offset);
        } else {
            prev_offset = offset;
        }
    }
}

/// Multiply all offsets by a factor.
pub fn scale_timing(steps: &mut [StepDef], factor: f64) {
    for step in steps.iter_mut() {
        let new_offset = (step.offset_us() as f64 * factor) as u64;
        set_offset_us(step, new_offset);
    }
}

/// Snap all offsets to nearest grid_ms boundary.
pub fn quantize(steps: &mut [StepDef], grid_ms: u64) {
    let grid_us = grid_ms * 1000;
    if grid_us == 0 {
        return;
    }
    for step in steps.iter_mut() {
        let offset = step.offset_us();
        let snapped = ((offset + grid_us / 2) / grid_us) * grid_us;
        set_offset_us(step, snapped);
    }
}

/// Remove all mouse movement steps (keep clicks + keys).
pub fn strip_mouse_movement(steps: &mut Vec<StepDef>) {
    steps.retain(|s| !matches!(s, StepDef::MouseMoveRelative { .. } | StepDef::MouseMoveAbsolute { .. }));
}

/// Helper: set offset_us on a StepDef.
fn set_offset_us(step: &mut StepDef, value: u64) {
    match step {
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
        | StepDef::RepeatBlock { offset_us, .. } => *offset_us = value,
        StepDef::Label { .. } | StepDef::CancelAll | StepDef::RunProgram { .. } => {}
    }
}
