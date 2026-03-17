//! Gamepad Input — XInput Polling + Pseudo-VK Mapping
//!
//! Provides a unified input layer where gamepad buttons are represented as
//! pseudo virtual-key codes (0x1000+), allowing them to coexist with keyboard
//! VK codes in trigger definitions.

use std::sync::atomic::{AtomicU32, Ordering};

// ========================================================================
// Pseudo-VK Constants
// ========================================================================

/// Base offset for gamepad pseudo-VK codes. Windows VK codes cap at 0xFF,
/// so 0x1000+ is safely outside that range.
pub const GAMEPAD_VK_BASE: u32 = 0x1000;

pub const GP_A: u32          = 0x1001;
pub const GP_B: u32          = 0x1002;
pub const GP_X: u32          = 0x1003;
pub const GP_Y: u32          = 0x1004;
pub const GP_LB: u32         = 0x1005;
pub const GP_RB: u32         = 0x1006;
pub const GP_LT: u32         = 0x1007;
pub const GP_RT: u32         = 0x1008;
pub const GP_START: u32      = 0x1009;
pub const GP_BACK: u32       = 0x100A;
pub const GP_DPAD_UP: u32    = 0x100B;
pub const GP_DPAD_DOWN: u32  = 0x100C;
pub const GP_DPAD_LEFT: u32  = 0x100D;
pub const GP_DPAD_RIGHT: u32 = 0x100E;
pub const GP_LS_CLICK: u32   = 0x100F;
pub const GP_RS_CLICK: u32   = 0x1010;

/// All gamepad pseudo-VKs in order (for iteration).
pub const ALL_GAMEPAD_VKS: &[u32] = &[
    GP_A, GP_B, GP_X, GP_Y,
    GP_LB, GP_RB, GP_LT, GP_RT,
    GP_START, GP_BACK,
    GP_DPAD_UP, GP_DPAD_DOWN, GP_DPAD_LEFT, GP_DPAD_RIGHT,
    GP_LS_CLICK, GP_RS_CLICK,
];

/// Check if a u32 is a gamepad pseudo-VK.
pub fn is_gamepad_vk(vk: u32) -> bool {
    vk >= GP_A && vk <= GP_RS_CLICK
}

/// Human-readable name for a gamepad pseudo-VK.
pub fn gamepad_vk_name(vk: u32) -> &'static str {
    match vk {
        GP_A          => "A",
        GP_B          => "B",
        GP_X          => "X",
        GP_Y          => "Y",
        GP_LB         => "LB",
        GP_RB         => "RB",
        GP_LT         => "LT",
        GP_RT         => "RT",
        GP_START      => "Start",
        GP_BACK       => "Back",
        GP_DPAD_UP    => "D-Pad Up",
        GP_DPAD_DOWN  => "D-Pad Down",
        GP_DPAD_LEFT  => "D-Pad Left",
        GP_DPAD_RIGHT => "D-Pad Right",
        GP_LS_CLICK   => "LS Click",
        GP_RS_CLICK   => "RS Click",
        _ => "Unknown",
    }
}

// ========================================================================
// XInput Polling
// ========================================================================

/// Shared gamepad button bitmask. Each bit corresponds to a pseudo-VK.
/// Bit index = pseudo_vk - GP_A. Written by the poller, read by the
/// keyboard hook for cross-input combo detection.
pub static GAMEPAD_STATE: AtomicU32 = AtomicU32::new(0);

/// Get the bit index for a gamepad pseudo-VK.
fn bit_index(vk: u32) -> u32 {
    vk - GP_A
}

/// Check if a gamepad button is currently pressed (from the shared atomic).
pub fn is_gamepad_pressed(vk: u32) -> bool {
    if !is_gamepad_vk(vk) { return false; }
    let mask = 1u32 << bit_index(vk);
    GAMEPAD_STATE.load(Ordering::Relaxed) & mask != 0
}

/// XInput gamepad poller with edge detection.
pub struct GamepadPoller {
    /// Previous button bitmask for edge detection.
    prev_bitmask: u32,
    /// Controller index (0–3).
    pub controller_index: u32,
    /// Whether a controller was connected on last poll.
    pub connected: bool,
    /// Hysteresis state for left analog trigger.
    lt_active: bool,
    /// Hysteresis state for right analog trigger.
    rt_active: bool,
    /// Consecutive polls where LT reads below threshold (debounce release).
    lt_release_count: u32,
    /// Consecutive polls where RT reads below threshold (debounce release).
    rt_release_count: u32,
}

/// A gamepad button state change.
pub struct GamepadEvent {
    /// The pseudo-VK that changed.
    pub vk: u32,
    /// true = pressed, false = released.
    pub pressed: bool,
}

/// Trigger must exceed this to count as pressed.
const TRIGGER_THRESHOLD_ON: u8 = 30;
/// Trigger must drop below this for DEBOUNCE_COUNT consecutive polls to count as released.
const TRIGGER_THRESHOLD_OFF: u8 = 20;
/// Number of consecutive sub-threshold polls required before release fires.
const TRIGGER_RELEASE_DEBOUNCE: u32 = 10;

impl GamepadPoller {
    pub fn new(controller_index: u32) -> Self {
        Self {
            prev_bitmask: 0,
            controller_index,
            connected: false,
            lt_active: false,
            rt_active: false,
            lt_release_count: 0,
            rt_release_count: 0,
        }
    }

    /// Poll XInput and return edge-detected events.
    ///
    /// Returns `None` if no controller is connected.
    /// Returns `Some(events)` with press/release edges on state change.
    #[cfg(windows)]
    pub fn poll(&mut self) -> Option<Vec<GamepadEvent>> {
        use windows::Win32::UI::Input::XboxController::{
            XInputGetState, XINPUT_STATE,
            XINPUT_GAMEPAD_A, XINPUT_GAMEPAD_B, XINPUT_GAMEPAD_X, XINPUT_GAMEPAD_Y,
            XINPUT_GAMEPAD_LEFT_SHOULDER, XINPUT_GAMEPAD_RIGHT_SHOULDER,
            XINPUT_GAMEPAD_START, XINPUT_GAMEPAD_BACK,
            XINPUT_GAMEPAD_DPAD_UP, XINPUT_GAMEPAD_DPAD_DOWN,
            XINPUT_GAMEPAD_DPAD_LEFT, XINPUT_GAMEPAD_DPAD_RIGHT,
            XINPUT_GAMEPAD_LEFT_THUMB, XINPUT_GAMEPAD_RIGHT_THUMB,
        };

        let mut state = XINPUT_STATE::default();
        let result = unsafe { XInputGetState(self.controller_index, &mut state) };

        if result != 0 {
            if self.connected {
                self.connected = false;
                self.prev_bitmask = 0;
                self.lt_active = false;
                self.rt_active = false;
                self.lt_release_count = 0;
                self.rt_release_count = 0;
                GAMEPAD_STATE.store(0, Ordering::Relaxed);
            }
            return None;
        }

        self.connected = true;
        let gp = &state.Gamepad;

        // Build current bitmask from digital buttons
        let mut current: u32 = 0;
        let buttons = gp.wButtons.0 as u32;

        let mappings: &[(u32, u32)] = &[
            (XINPUT_GAMEPAD_A.0 as u32,               bit_index(GP_A)),
            (XINPUT_GAMEPAD_B.0 as u32,               bit_index(GP_B)),
            (XINPUT_GAMEPAD_X.0 as u32,               bit_index(GP_X)),
            (XINPUT_GAMEPAD_Y.0 as u32,               bit_index(GP_Y)),
            (XINPUT_GAMEPAD_LEFT_SHOULDER.0 as u32,   bit_index(GP_LB)),
            (XINPUT_GAMEPAD_RIGHT_SHOULDER.0 as u32,  bit_index(GP_RB)),
            (XINPUT_GAMEPAD_START.0 as u32,           bit_index(GP_START)),
            (XINPUT_GAMEPAD_BACK.0 as u32,            bit_index(GP_BACK)),
            (XINPUT_GAMEPAD_DPAD_UP.0 as u32,         bit_index(GP_DPAD_UP)),
            (XINPUT_GAMEPAD_DPAD_DOWN.0 as u32,       bit_index(GP_DPAD_DOWN)),
            (XINPUT_GAMEPAD_DPAD_LEFT.0 as u32,       bit_index(GP_DPAD_LEFT)),
            (XINPUT_GAMEPAD_DPAD_RIGHT.0 as u32,      bit_index(GP_DPAD_RIGHT)),
            (XINPUT_GAMEPAD_LEFT_THUMB.0 as u32,      bit_index(GP_LS_CLICK)),
            (XINPUT_GAMEPAD_RIGHT_THUMB.0 as u32,     bit_index(GP_RS_CLICK)),
        ];

        for &(xinput_mask, our_bit) in mappings {
            if buttons & xinput_mask != 0 {
                current |= 1 << our_bit;
            }
        }

        // Analog triggers with debounced release
        // LT
        if self.lt_active {
            if gp.bLeftTrigger < TRIGGER_THRESHOLD_OFF {
                self.lt_release_count += 1;
                if self.lt_release_count >= TRIGGER_RELEASE_DEBOUNCE {
                    self.lt_active = false;
                    self.lt_release_count = 0;
                } else {
                    // Not enough consecutive low reads — still consider pressed
                    current |= 1 << bit_index(GP_LT);
                }
            } else {
                self.lt_release_count = 0;
                current |= 1 << bit_index(GP_LT);
            }
        } else if gp.bLeftTrigger > TRIGGER_THRESHOLD_ON {
            self.lt_active = true;
            self.lt_release_count = 0;
            current |= 1 << bit_index(GP_LT);
        }

        // RT
        if self.rt_active {
            if gp.bRightTrigger < TRIGGER_THRESHOLD_OFF {
                self.rt_release_count += 1;
                if self.rt_release_count >= TRIGGER_RELEASE_DEBOUNCE {
                    self.rt_active = false;
                    self.rt_release_count = 0;
                } else {
                    // Phantom zero — ignore, keep pressed
                    current |= 1 << bit_index(GP_RT);
                }
            } else {
                if self.rt_release_count > 0 {
                }
                self.rt_release_count = 0;
                current |= 1 << bit_index(GP_RT);
            }
        } else if gp.bRightTrigger > TRIGGER_THRESHOLD_ON {
            self.rt_active = true;
            self.rt_release_count = 0;
            current |= 1 << bit_index(GP_RT);
        }

        // Update shared atomic
        GAMEPAD_STATE.store(current, Ordering::Relaxed);

        // Edge detection
        let changed = current ^ self.prev_bitmask;
        if changed == 0 {
            return Some(Vec::new());
        }

        let mut events = Vec::new();
        for &vk in ALL_GAMEPAD_VKS {
            let bit = 1u32 << bit_index(vk);
            if changed & bit != 0 {
                events.push(GamepadEvent {
                    vk,
                    pressed: current & bit != 0,
                });
            }
        }

        self.prev_bitmask = current;
        Some(events)
    }

    #[cfg(not(windows))]
    pub fn poll(&mut self) -> Option<Vec<GamepadEvent>> {
        None
    }
}
