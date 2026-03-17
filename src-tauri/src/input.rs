//! Unified Input Dispatch Layer
//!
//! All input actions (keyboard, mouse) are routed through this module.
//! Each function accepts an `OutputMode` to determine whether to use
//! software `SendInput` or route through the Arduino HID connection.
//!
//! Ported from the proven Aura Battlemate `input_service.rs` with the
//! addition of per-call `OutputMode` dispatch.

use crate::arduino;
use crate::config::OutputMode;
use parking_lot::Mutex;
use std::collections::HashSet;
use std::mem::size_of;
use std::sync::LazyLock;
use std::thread;
use std::time::Duration;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, MapVirtualKeyW, SendInput, INPUT, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT,
    KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE, MAPVK_VK_TO_VSC, MOUSEEVENTF_ABSOLUTE,
    MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MOVE,
    MOUSEEVENTF_WHEEL, MOUSEINPUT, MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;

// Right / middle mouse button flags
const MOUSEEVENTF_RIGHTDOWN: MOUSE_EVENT_FLAGS = MOUSE_EVENT_FLAGS(0x0008);
const MOUSEEVENTF_RIGHTUP: MOUSE_EVENT_FLAGS = MOUSE_EVENT_FLAGS(0x0010);
const MOUSEEVENTF_MIDDLEDOWN: MOUSE_EVENT_FLAGS = MOUSE_EVENT_FLAGS(0x0020);
const MOUSEEVENTF_MIDDLEUP: MOUSE_EVENT_FLAGS = MOUSE_EVENT_FLAGS(0x0040);

/// Delay between key down and key up events (ms).
/// Games often use input polling and can miss ultra-fast presses.
const KEY_PRESS_DELAY_MS: u64 = 10;

/// Tracks which keys/buttons are currently held via `send_key_hold`.
/// Used for: (a) preventing double-hold, (b) releasing all on shutdown.
static HELD_KEYS: LazyLock<Mutex<HashSet<u32>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

// ========================================================================
// Keyboard — Tap / Hold / Release
// ========================================================================

/// Simulate a full key tap (down + delay + up).
///
/// Routes through Arduino HID if mode is Arduino and connection is live.
pub fn send_key_tap(vk: u32, mode: &OutputMode) {
    if *mode == OutputMode::Arduino && arduino::is_connected() {
        arduino::send_key_tap(vk as u8);
        return;
    }

    unsafe {
        let scancode = MapVirtualKeyW(vk, MAPVK_VK_TO_VSC) as u16;

        let key_down = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: scancode,
                    dwFlags: KEYEVENTF_SCANCODE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };

        let key_up = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: scancode,
                    dwFlags: KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };

        SendInput(&[key_down], size_of::<INPUT>() as i32);
        thread::sleep(Duration::from_millis(KEY_PRESS_DELAY_MS));
        SendInput(&[key_up], size_of::<INPUT>() as i32);
    }
}

/// Press a key down WITHOUT releasing. Must be paired with `send_key_release`.
///
/// Tracks held state to prevent double-hold.
pub fn send_key_hold(vk: u32, mode: &OutputMode) {
    {
        let mut held = HELD_KEYS.lock();
        if held.contains(&vk) {
            return;
        }
        held.insert(vk);
    }

    if *mode == OutputMode::Arduino && arduino::is_connected() {
        arduino::send_key_hold(vk as u8);
        return;
    }

    unsafe {
        let scancode = MapVirtualKeyW(vk, MAPVK_VK_TO_VSC) as u16;
        let key_down = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: scancode,
                    dwFlags: KEYEVENTF_SCANCODE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        SendInput(&[key_down], size_of::<INPUT>() as i32);
    }
}

/// Release a previously held key.
pub fn send_key_release(vk: u32, mode: &OutputMode) {
    {
        let mut held = HELD_KEYS.lock();
        held.remove(&vk);
    }

    if *mode == OutputMode::Arduino && arduino::is_connected() {
        arduino::send_key_release(vk as u8);
        return;
    }

    unsafe {
        let scancode = MapVirtualKeyW(vk, MAPVK_VK_TO_VSC) as u16;
        let key_up = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: scancode,
                    dwFlags: KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        SendInput(&[key_up], size_of::<INPUT>() as i32);
    }
}

// ========================================================================
// Mouse — Movement
// ========================================================================

/// Move mouse by (dx, dy) pixels relative to current position.
pub fn send_mouse_delta(dx: i32, dy: i32, mode: &OutputMode) {
    if *mode == OutputMode::Arduino && arduino::is_connected() {
        arduino::send_mouse_delta(dx as i16, dy as i16);
        return;
    }

    send_mouse_delta_software(dx, dy);
}

/// Software-only relative mouse move (always bypasses Arduino).
pub fn send_mouse_delta_software(dx: i32, dy: i32) {
    unsafe {
        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                mi: MOUSEINPUT {
                    dx,
                    dy,
                    mouseData: 0,
                    dwFlags: MOUSEEVENTF_MOVE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        SendInput(&[input], size_of::<INPUT>() as i32);
    }
}

/// Move cursor to absolute pixel position (logical coordinates).
/// Normalizes to 0–65535 space internally for SendInput.
pub fn send_mouse_absolute(x: i32, y: i32) {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

    unsafe {
        let screen_w = GetSystemMetrics(SM_CXSCREEN) as i32;
        let screen_h = GetSystemMetrics(SM_CYSCREEN) as i32;

        // Normalize to 0–65535 absolute coordinate space
        let norm_x = ((x as i64 * 65536) / screen_w as i64) as i32;
        let norm_y = ((y as i64 * 65536) / screen_h as i64) as i32;

        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                mi: MOUSEINPUT {
                    dx: norm_x,
                    dy: norm_y,
                    mouseData: 0,
                    dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        SendInput(&[input], size_of::<INPUT>() as i32);
    }
}

/// Move cursor via stepped relative deltas with 1ms gaps between chunks.
/// Avoids per-event delta capping by game engines.
pub fn send_mouse_delta_stepped(dx: i32, dy: i32, step_size: i32) {
    let step_size = step_size.max(1);
    let max_abs = dx.abs().max(dy.abs());
    let num_steps = (max_abs + step_size - 1) / step_size;
    if num_steps == 0 {
        return;
    }

    let step_dx = dx / num_steps;
    let step_dy = dy / num_steps;
    let remainder_dx = dx - step_dx * num_steps;
    let remainder_dy = dy - step_dy * num_steps;

    for i in 0..num_steps {
        let mut sdx = step_dx;
        let mut sdy = step_dy;
        if i == num_steps - 1 {
            sdx += remainder_dx;
            sdy += remainder_dy;
        }
        send_mouse_delta_software(sdx, sdy);
        if i < num_steps - 1 {
            thread::sleep(Duration::from_millis(1));
        }
    }
}

// ========================================================================
// Mouse — Clicks
// ========================================================================

/// Get the SendInput flags for a mouse button.
fn mouse_button_flags(
    button: &crate::config::MouseButton,
) -> (MOUSE_EVENT_FLAGS, MOUSE_EVENT_FLAGS) {
    match button {
        crate::config::MouseButton::Left => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        crate::config::MouseButton::Right => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        crate::config::MouseButton::Middle => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
    }
}

/// VK code equivalent for mouse buttons (used for HELD_KEYS tracking).
fn mouse_button_vk(button: &crate::config::MouseButton) -> u32 {
    match button {
        crate::config::MouseButton::Left => 0x01,   // VK_LBUTTON
        crate::config::MouseButton::Right => 0x02,   // VK_RBUTTON
        crate::config::MouseButton::Middle => 0x04,  // VK_MBUTTON
    }
}

/// Simulate a mouse button click (press + delay + release).
pub fn send_mouse_click(button: &crate::config::MouseButton, mode: &OutputMode) {
    if *mode == OutputMode::Arduino && arduino::is_connected() {
        arduino::send_mouse_click(button);
        return;
    }

    let (down_flag, up_flag) = mouse_button_flags(button);

    unsafe {
        let mouse_down = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: 0,
                    dwFlags: down_flag,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let mouse_up = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: 0,
                    dwFlags: up_flag,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };

        SendInput(&[mouse_down], size_of::<INPUT>() as i32);
        thread::sleep(Duration::from_millis(KEY_PRESS_DELAY_MS));
        SendInput(&[mouse_up], size_of::<INPUT>() as i32);
    }
}

/// Press a mouse button down (hold).
pub fn send_mouse_press(button: &crate::config::MouseButton, mode: &OutputMode) {
    let vk = mouse_button_vk(button);
    {
        let mut held = HELD_KEYS.lock();
        if held.contains(&vk) {
            return;
        }
        held.insert(vk);
    }

    if *mode == OutputMode::Arduino && arduino::is_connected() {
        arduino::send_mouse_press(button);
        return;
    }

    let (down_flag, _) = mouse_button_flags(button);
    unsafe {
        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: 0,
                    dwFlags: down_flag,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        SendInput(&[input], size_of::<INPUT>() as i32);
    }
}

/// Release a mouse button.
pub fn send_mouse_release(button: &crate::config::MouseButton, mode: &OutputMode) {
    let vk = mouse_button_vk(button);
    {
        let mut held = HELD_KEYS.lock();
        held.remove(&vk);
    }

    if *mode == OutputMode::Arduino && arduino::is_connected() {
        arduino::send_mouse_release(button);
        return;
    }

    let (_, up_flag) = mouse_button_flags(button);
    unsafe {
        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: 0,
                    dwFlags: up_flag,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        SendInput(&[input], size_of::<INPUT>() as i32);
    }
}

/// Move cursor to absolute pixel position then click.
/// Uses SetCursorPos for deterministic positioning.
pub fn send_mouse_absolute_click(
    x: i32,
    y: i32,
    button: &crate::config::MouseButton,
) {
    unsafe {
        let _ = SetCursorPos(x, y);
    }
    thread::sleep(Duration::from_millis(2));
    send_mouse_click_software(button);
}

/// Move cursor by (dx, dy) in stepped chunks then click.
pub fn send_mouse_stepped_delta_click(
    dx: i32,
    dy: i32,
    button: &crate::config::MouseButton,
) {
    send_mouse_delta_stepped(dx, dy, 30);
    thread::sleep(Duration::from_millis(2));
    send_mouse_click_software(button);
}

/// Software-only mouse click (always bypasses Arduino).
fn send_mouse_click_software(button: &crate::config::MouseButton) {
    let (down_flag, up_flag) = mouse_button_flags(button);
    unsafe {
        let mouse_down = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: 0,
                    dwFlags: down_flag,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let mouse_up = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: 0,
                    dwFlags: up_flag,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };

        SendInput(&[mouse_down], size_of::<INPUT>() as i32);
        thread::sleep(Duration::from_millis(KEY_PRESS_DELAY_MS));
        SendInput(&[mouse_up], size_of::<INPUT>() as i32);
    }
}

// ========================================================================
// Mouse — Scroll
// ========================================================================

/// Simulate mouse scroll wheel.
pub fn send_mouse_scroll(
    direction: &crate::config::ScrollDirection,
    amount: i32,
    mode: &OutputMode,
) {
    if *mode == OutputMode::Arduino && arduino::is_connected() {
        arduino::send_mouse_scroll(direction, amount);
        return;
    }

    // WHEEL_DELTA = 120 per notch
    let (flags, data) = match direction {
        crate::config::ScrollDirection::Up => (MOUSEEVENTF_WHEEL, amount * 120),
        crate::config::ScrollDirection::Down => (MOUSEEVENTF_WHEEL, -amount * 120),
        crate::config::ScrollDirection::Left => (MOUSEEVENTF_HWHEEL, -amount * 120),
        crate::config::ScrollDirection::Right => (MOUSEEVENTF_HWHEEL, amount * 120),
    };

    unsafe {
        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: data as u32,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        SendInput(&[input], size_of::<INPUT>() as i32);
    }
}

// ========================================================================
// Key State Query
// ========================================================================

/// Check if a key is currently physically pressed.
pub fn is_key_pressed(vk: u32) -> bool {
    unsafe { GetAsyncKeyState(vk as i32) as u16 & 0x8000 != 0 }
}

// ========================================================================
// Safety — Release All
// ========================================================================

/// Release ALL currently held keys and mouse buttons.
///
/// Called on: macro cancellation, app shutdown, panic hook.
/// Always uses software SendInput for safety.
pub fn release_all_held_keys() {
    let keys: Vec<u32> = {
        let mut set = HELD_KEYS.lock();
        set.drain().collect()
    };

    for vk in keys {
        match vk {
            // Mouse buttons
            0x01 => unsafe {
                let input = INPUT {
                    r#type: INPUT_MOUSE,
                    Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                        mi: MOUSEINPUT {
                            dx: 0,
                            dy: 0,
                            mouseData: 0,
                            dwFlags: MOUSEEVENTF_LEFTUP,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                };
                SendInput(&[input], size_of::<INPUT>() as i32);
            },
            0x02 => unsafe {
                let input = INPUT {
                    r#type: INPUT_MOUSE,
                    Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                        mi: MOUSEINPUT {
                            dx: 0,
                            dy: 0,
                            mouseData: 0,
                            dwFlags: MOUSEEVENTF_RIGHTUP,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                };
                SendInput(&[input], size_of::<INPUT>() as i32);
            },
            0x04 => unsafe {
                let input = INPUT {
                    r#type: INPUT_MOUSE,
                    Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                        mi: MOUSEINPUT {
                            dx: 0,
                            dy: 0,
                            mouseData: 0,
                            dwFlags: MOUSEEVENTF_MIDDLEUP,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                };
                SendInput(&[input], size_of::<INPUT>() as i32);
            },
            // Keyboard keys
            _ => unsafe {
                let scancode = MapVirtualKeyW(vk, MAPVK_VK_TO_VSC) as u16;
                let key_up = INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VIRTUAL_KEY(0),
                            wScan: scancode,
                            dwFlags: KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                };
                SendInput(&[key_up], size_of::<INPUT>() as i32);
            },
        }
    }

    // Also tell Arduino to release all (if connected)
    if arduino::is_connected() {
        arduino::release_all();
    }
}
