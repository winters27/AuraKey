//! Arduino HID Serial Connection
//!
//! Manages serial communication with an Arduino (Leonardo/Micro/Pro Micro)
//! running the AuraHID v3 firmware.
//!
//! The ATmega32U4 has native USB — the `Serial` CDC class requires DTR to be
//! asserted by the host before it will process incoming bytes. Unlike Uno-style
//! boards, DTR assertion does NOT reset the board (reset only occurs via the
//! 1200-baud touch used for programming). So we open normally with DTR enabled.

use crate::config::{MouseButton, ScrollDirection};
use parking_lot::Mutex;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;
use std::time::Duration;

// ========================================================================
// Protocol Constants
// ========================================================================

const MAGIC_HEADER: u8 = 0xAA;
const CMD_PING: u8 = 0xFE;
const CMD_TOGGLE: u8 = 0xFF;
const CMD_RELEASE_ALL: u8 = 0xCF;

// Mouse single-byte commands
const CMD_LCLICK: u8 = 0xF0;
const CMD_LPRESS: u8 = 0xF1;
const CMD_LRELEASE: u8 = 0xF2;
const CMD_RCLICK: u8 = 0xE0;
const CMD_RPRESS: u8 = 0xE1;
const CMD_RRELEASE: u8 = 0xE2;
const CMD_MCLICK: u8 = 0xD0;
const CMD_MPRESS: u8 = 0xD1;
const CMD_MRELEASE: u8 = 0xD2;

// Multi-byte commands
const CMD_MOUSE_MOVE: u8 = 0xF3;
const CMD_KEY_HOLD: u8 = 0xF4;
const CMD_KEY_RELEASE: u8 = 0xF5;
const CMD_KEY_TAP: u8 = 0xF6;
const CMD_MOUSE_SCROLL: u8 = 0xF7;

/// Baud rate for Arduino serial communication.
const BAUD_RATE: u32 = 115_200;

/// Embedded AuraHID v3 firmware source.
pub const FIRMWARE_ASSET: &str = include_str!("../assets/AuraHID_v3.ino");

// ========================================================================
// Connection State
// ========================================================================

/// Global Arduino connection singleton.
static CONNECTION: LazyLock<Mutex<Option<ArduinoConnection>>> =
    LazyLock::new(|| Mutex::new(None));

/// Global connection status flag.
static CONNECTED: AtomicBool = AtomicBool::new(false);

/// Arduino serial connection — wraps a `serialport::COMPort` handle.
struct ArduinoConnection {
    port: Box<dyn serialport::SerialPort>,
    port_name: String,
}

// ========================================================================
// Public API
// ========================================================================

/// Check if the Arduino is currently connected.
pub fn is_connected() -> bool {
    CONNECTED.load(Ordering::Relaxed)
}

/// Get the current port name, if connected.
pub fn port_name() -> Option<String> {
    let conn = CONNECTION.lock();
    conn.as_ref().map(|c| c.port_name.clone())
}

/// Connect to an Arduino on the specified COM port.
///
/// Uses standard `serialport::open()` with DTR enabled — on ATmega32U4 boards,
/// DTR assertion does NOT cause a reset (that only happens via 1200-baud touch).
/// DTR being asserted is REQUIRED for the firmware's CDC `Serial` class to
/// report `Serial.available() > 0`.
pub fn connect(port_name: &str) -> anyhow::Result<()> {
    let raw_port = port_name
        .split_whitespace()
        .next()
        .unwrap_or(port_name);

    eprintln!("[Arduino] Opening {raw_port} (standard open, DTR enabled)…");
    let mut port = serialport::new(raw_port, BAUD_RATE)
        .timeout(Duration::from_millis(1000))
        .open()?;

    // Explicitly assert DTR — required for ATmega32U4 CDC Serial to work
    let _ = port.write_data_terminal_ready(true);

    // Brief settle time for USB CDC enumeration
    eprintln!("[Arduino] Waiting for CDC settle…");
    std::thread::sleep(Duration::from_millis(500));

    // Clear any stale bytes
    match port.bytes_to_read() {
        Ok(n) if n > 0 => eprintln!("[Arduino] {n} stale bytes in buffer, clearing…"),
        Ok(_) => eprintln!("[Arduino] Buffer clean"),
        Err(e) => eprintln!("[Arduino] bytes_to_read error: {e}"),
    }
    let _ = port.clear(serialport::ClearBuffer::Input);

    // Ping to verify firmware is alive
    eprintln!("[Arduino] Pinging…");
    for attempt in 1..=3 {
        match send_ping_raw(&mut port, true) {
            Ok(true) => {
                eprintln!("[Arduino] ✓ Firmware responded on attempt {attempt}!");
                *CONNECTION.lock() = Some(ArduinoConnection {
                    port,
                    port_name: raw_port.to_string(),
                });
                CONNECTED.store(true, Ordering::Relaxed);
                return Ok(());
            }
            Ok(false) => {
                eprintln!("[Arduino] Attempt {attempt}/3: wrong response");
                let _ = port.clear(serialport::ClearBuffer::Input);
            }
            Err(e) => eprintln!("[Arduino] Attempt {attempt}/3: {e}"),
        }
        std::thread::sleep(Duration::from_millis(500));
    }

    anyhow::bail!(
        "Could not reach firmware on {raw_port}. \
         Verify AuraHID v3 is flashed and board is Arduino Micro/Leonardo."
    )
}

/// Disconnect from the Arduino.
pub fn disconnect() {
    let mut conn = CONNECTION.lock();
    *conn = None;
    CONNECTED.store(false, Ordering::Relaxed);
}

/// List available COM ports with descriptive labels.
pub fn list_ports() -> Vec<serialport::SerialPortInfo> {
    let ports = serialport::available_ports().unwrap_or_default();
    ports
        .into_iter()
        .filter(|p| matches!(
            p.port_type,
            serialport::SerialPortType::UsbPort(_) | serialport::SerialPortType::Unknown
        ))
        .collect()
}

/// Build a descriptive label for a serial port (e.g. "COM5 (Arduino Leonardo)").
pub fn port_label(port: &serialport::SerialPortInfo) -> String {
    match &port.port_type {
        serialport::SerialPortType::UsbPort(info) => {
            if let Some(product) = &info.product {
                format!("{} ({})", port.port_name, product)
            } else {
                let is_arduino = matches!(info.vid, 0x2341 | 0x1B4F | 0x239A | 0x2A03);
                if is_arduino {
                    format!("{} (Arduino)", port.port_name)
                } else {
                    format!("{} (USB Serial)", port.port_name)
                }
            }
        }
        _ => format!("{} (Serial)", port.port_name),
    }
}

/// Send a ping and return round-trip latency in ms.
pub fn ping() -> anyhow::Result<u64> {
    let mut conn = CONNECTION.lock();
    let conn = conn.as_mut().ok_or_else(|| anyhow::anyhow!("Not connected"))?;

    let start = std::time::Instant::now();
    let ok = send_ping_inner(conn, true)?;
    let latency_ms = start.elapsed().as_millis() as u64;

    if ok {
        Ok(latency_ms)
    } else {
        anyhow::bail!("Ping failed — no response")
    }
}

/// Send key tap (shorthand: 0xAA + VK code for codes 0x01–0xBF).
pub fn send_key_tap(vk: u8) {
    if vk > 0x00 && vk <= 0xBF {
        send_bytes(&[MAGIC_HEADER, vk]);
    } else {
        send_bytes(&[MAGIC_HEADER, CMD_KEY_TAP, vk]);
    }
}

/// Send key hold (press only, no release).
pub fn send_key_hold(vk: u8) {
    send_bytes(&[MAGIC_HEADER, CMD_KEY_HOLD, vk]);
}

/// Send key release.
pub fn send_key_release(vk: u8) {
    send_bytes(&[MAGIC_HEADER, CMD_KEY_RELEASE, vk]);
}

/// Send mouse delta movement.
pub fn send_mouse_delta(dx: i16, dy: i16) {
    let dx_bytes = dx.to_be_bytes();
    let dy_bytes = dy.to_be_bytes();
    send_bytes(&[
        MAGIC_HEADER, CMD_MOUSE_MOVE,
        dx_bytes[0], dx_bytes[1],
        dy_bytes[0], dy_bytes[1],
    ]);
}

/// Send mouse click.
pub fn send_mouse_click(button: &MouseButton) {
    let cmd = match button {
        MouseButton::Left => CMD_LCLICK,
        MouseButton::Right => CMD_RCLICK,
        MouseButton::Middle => CMD_MCLICK,
    };
    send_bytes(&[MAGIC_HEADER, cmd]);
}

/// Send mouse button press (hold).
pub fn send_mouse_press(button: &MouseButton) {
    let cmd = match button {
        MouseButton::Left => CMD_LPRESS,
        MouseButton::Right => CMD_RPRESS,
        MouseButton::Middle => CMD_MPRESS,
    };
    send_bytes(&[MAGIC_HEADER, cmd]);
}

/// Send mouse button release.
pub fn send_mouse_release(button: &MouseButton) {
    let cmd = match button {
        MouseButton::Left => CMD_LRELEASE,
        MouseButton::Right => CMD_RRELEASE,
        MouseButton::Middle => CMD_MRELEASE,
    };
    send_bytes(&[MAGIC_HEADER, cmd]);
}

/// Send mouse scroll.
pub fn send_mouse_scroll(direction: &ScrollDirection, amount: i32) {
    let dir_byte = match direction {
        ScrollDirection::Up => 0x01,
        ScrollDirection::Down => 0x02,
        ScrollDirection::Left => 0x03,
        ScrollDirection::Right => 0x04,
    };
    let amt = amount.clamp(1, 127) as u8;
    send_bytes(&[MAGIC_HEADER, CMD_MOUSE_SCROLL, amt, dir_byte]);
}

/// Release all keys and mouse buttons on Arduino.
pub fn release_all() {
    send_bytes(&[MAGIC_HEADER, CMD_RELEASE_ALL]);
}

/// Toggle enabled/disabled state on Arduino.
pub fn toggle_enabled() {
    send_bytes(&[MAGIC_HEADER, CMD_TOGGLE]);
}

// ========================================================================
// Auto-Reconnect
// ========================================================================

/// Start the auto-reconnect background thread.
///
/// Pings every 2 seconds. If ping fails, marks as disconnected
/// and attempts reconnect on the same port.
pub fn start_auto_reconnect(port_name: String) {
    std::thread::Builder::new()
        .name("arduino-reconnect".into())
        .spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(2));

                if is_connected() {
                    if silent_ping().is_err() {
                        eprintln!("[Arduino] Heartbeat failed — marking disconnected");
                        disconnect();
                    }
                } else if !port_name.is_empty() {
                    if let Ok(()) = connect(&port_name) {
                        eprintln!("[Arduino] Reconnected to {}", port_name);
                    }
                }
            }
        })
        .expect("Failed to spawn auto-reconnect thread");
}

// ========================================================================
// Internal Helpers
// ========================================================================

/// Send raw bytes to the Arduino. Silently drops on error.
fn send_bytes(data: &[u8]) {
    let mut conn = CONNECTION.lock();
    if let Some(conn) = conn.as_mut() {
        if conn.port.write_all(data).is_err() || conn.port.flush().is_err() {
            CONNECTED.store(false, Ordering::Relaxed);
        }
    }
}

/// Send a ping and wait for the 0xFE response (on locked connection).
fn send_ping_inner(conn: &mut ArduinoConnection, verbose: bool) -> anyhow::Result<bool> {
    send_ping_raw(&mut conn.port, verbose)
}

/// Silent ping for heartbeat — no log output on success.
fn silent_ping() -> anyhow::Result<u64> {
    let mut conn = CONNECTION.lock();
    let conn = conn.as_mut().ok_or_else(|| anyhow::anyhow!("Not connected"))?;
    let start = std::time::Instant::now();
    let ok = send_ping_inner(conn, false)?;
    let latency_ms = start.elapsed().as_millis() as u64;
    if ok { Ok(latency_ms) } else { anyhow::bail!("Ping failed") }
}

/// Send a ping on a raw port reference.
fn send_ping_raw(port: &mut Box<dyn serialport::SerialPort>, verbose: bool) -> anyhow::Result<bool> {
    if verbose { eprintln!("[Arduino] Ping -> writing [0xAA, 0xFE]..."); }
    port.write_all(&[MAGIC_HEADER, CMD_PING])?;
    port.flush()?;
    if verbose { eprintln!("[Arduino] Ping -> flush ok, waiting for response..."); }

    let mut buf = [0u8; 1];
    match port.read_exact(&mut buf) {
        Ok(()) => {
            if verbose { eprintln!("[Arduino] Ping -> got byte: 0x{:02X} (expected 0xFE)", buf[0]); }
            Ok(buf[0] == CMD_PING)
        }
        Err(e) => {
            eprintln!("[Arduino] Ping -> read failed: {e}");
            Ok(false)
        }
    }
}
