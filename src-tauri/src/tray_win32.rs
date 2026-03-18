//! Win32 System Tray Icon — Daemon-only
//!
//! Creates a hidden window and a Shell_NotifyIcon tray entry.
//! Uses the daemon's existing `PeekMessageW`/`DispatchMessageW` message pump
//! (in `daemon::run_daemon`) — zero extra threads needed.

use crate::config::Profile;
use crate::daemon::{DaemonCommand, DaemonEvent};
use crossbeam_channel::Sender;
use parking_lot::Mutex as ParkMutex;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::LazyLock;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{
    Shell_NotifyIconW, NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE,
    NOTIFYICONDATAW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu,
    DestroyWindow, GetCursorPos, RegisterClassW, SetForegroundWindow,
    TrackPopupMenu,
    MF_CHECKED, MF_STRING, MF_UNCHECKED, TPM_BOTTOMALIGN, TPM_LEFTALIGN,
    WINDOW_EX_STYLE, WM_APP, WM_COMMAND, WM_DESTROY, WNDCLASSW, WS_OVERLAPPED,
    MF_SEPARATOR,
};

const WM_TRAY_CALLBACK: u32 = WM_APP + 1;
const TRAY_ICON_ID: u32 = 1;

// Menu item IDs
const ID_SHOW: u16 = 1001;
const ID_PAUSE: u16 = 1002;
const ID_QUIT: u16 = 1003;
const ID_PROFILE_BASE: u16 = 2000;

// ========================================================================
// Shared State — thread-safe via AtomicIsize for HWND (raw pointer)
// ========================================================================

/// Store HWND as isize so it's Send/Sync.
static TRAY_HWND: AtomicIsize = AtomicIsize::new(0);

struct TraySharedState {
    cmd_tx: Option<Sender<DaemonCommand>>,
    event_tx: Option<Sender<DaemonEvent>>,
    profiles: Vec<String>,
    active_profile: String,
    paused: bool,
    gui_exe_path: String,
}

static TRAY_STATE: LazyLock<ParkMutex<TraySharedState>> = LazyLock::new(|| {
    ParkMutex::new(TraySharedState {
        cmd_tx: None,
        event_tx: None,
        profiles: Vec::new(),
        active_profile: String::new(),
        paused: false,
        gui_exe_path: String::new(),
    })
});

// Function pointer for profile switching — set by daemon_main
static PROFILE_SWITCH_FN: LazyLock<ParkMutex<Option<Box<dyn Fn(&str) + Send + Sync>>>> =
    LazyLock::new(|| ParkMutex::new(None));

fn get_tray_hwnd() -> HWND {
    HWND(TRAY_HWND.load(Ordering::Relaxed) as *mut core::ffi::c_void)
}

fn set_tray_hwnd(hwnd: HWND) {
    TRAY_HWND.store(hwnd.0 as isize, Ordering::Relaxed);
}

// ========================================================================
// Public API
// ========================================================================

/// Initialize the tray icon. Must be called from the thread that runs the
/// message pump (the daemon hook thread).
pub fn init_tray(
    cmd_tx: Sender<DaemonCommand>,
    event_tx: Sender<DaemonEvent>,
    profiles: &[Profile],
    active_profile: &str,
    profile_switch_fn: Box<dyn Fn(&str) + Send + Sync>,
) {
    // Determine GUI exe path (same dir as service, named aurakey.exe)
    let gui_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("aurakey.exe").to_string_lossy().to_string()))
        .unwrap_or_else(|| "aurakey.exe".to_string());

    {
        let mut state = TRAY_STATE.lock();
        state.cmd_tx = Some(cmd_tx);
        state.event_tx = Some(event_tx);
        state.profiles = profiles.iter().map(|p| p.name.clone()).collect();
        state.active_profile = active_profile.to_string();
        state.gui_exe_path = gui_path;
    }

    *PROFILE_SWITCH_FN.lock() = Some(profile_switch_fn);

    unsafe { create_tray_window(); }
}

/// Clean up the tray icon. Call before daemon exits.
pub fn destroy_tray() {
    let hwnd = get_tray_hwnd();
    if hwnd.0 as isize != 0 {
        unsafe {
            let mut nid = NOTIFYICONDATAW::default();
            nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
            nid.hWnd = hwnd;
            nid.uID = TRAY_ICON_ID;
            let _ = Shell_NotifyIconW(NIM_DELETE, &nid);
            let _ = DestroyWindow(hwnd);
        }
    }
}

/// Update profile list and active profile (called when config changes).
pub fn update_profiles(profiles: &[Profile], active: &str) {
    let mut state = TRAY_STATE.lock();
    state.profiles = profiles.iter().map(|p| p.name.clone()).collect();
    state.active_profile = active.to_string();
}

// ========================================================================
// Embedded Icon
// ========================================================================

/// The app icon, embedded at compile time from src-tauri/icons/icon.ico.
const ICON_DATA: &[u8] = include_bytes!("../icons/icon.ico");

/// Parse a .ico file and create an HICON from the largest image entry.
/// ICO format: 6-byte header, then N 16-byte directory entries, then image data.
unsafe fn icon_from_ico_bytes(data: &[u8]) -> Option<windows::Win32::UI::WindowsAndMessaging::HICON> {
    use windows::Win32::UI::WindowsAndMessaging::{CreateIconFromResourceEx, LR_DEFAULTCOLOR};

    if data.len() < 6 { return None; }

    // Header: reserved(2) + type(2) + count(2)
    let count = u16::from_le_bytes([data[4], data[5]]) as usize;
    if count == 0 || data.len() < 6 + count * 16 { return None; }

    // Find the largest entry by byte size
    let mut best_idx = 0usize;
    let mut best_size = 0u32;
    for i in 0..count {
        let entry_offset = 6 + i * 16;
        let size = u32::from_le_bytes([
            data[entry_offset + 8],
            data[entry_offset + 9],
            data[entry_offset + 10],
            data[entry_offset + 11],
        ]);
        if size > best_size {
            best_size = size;
            best_idx = i;
        }
    }

    let entry_offset = 6 + best_idx * 16;
    let img_size = u32::from_le_bytes([
        data[entry_offset + 8],
        data[entry_offset + 9],
        data[entry_offset + 10],
        data[entry_offset + 11],
    ]) as usize;
    let img_offset = u32::from_le_bytes([
        data[entry_offset + 12],
        data[entry_offset + 13],
        data[entry_offset + 14],
        data[entry_offset + 15],
    ]) as usize;

    if img_offset + img_size > data.len() { return None; }

    let icon_bits = &data[img_offset..img_offset + img_size];

    // Determine if this is a PNG (magic bytes) — use 256x256 for tray
    // CreateIconFromResourceEx handles both BMP and PNG payloads.
    let hicon = CreateIconFromResourceEx(
        icon_bits,
        true, // fIcon = true (icon, not cursor)
        0x00030000, // version
        16, 16, // desired size (system tray uses small icon)
        LR_DEFAULTCOLOR,
    );

    match hicon {
        Ok(h) if h.0 as usize != 0 => Some(h),
        _ => None,
    }
}

// ========================================================================
// Window Creation
// ========================================================================

unsafe fn create_tray_window() {
    let class_name = w!("AuraKeyDaemonTray");

    let wc = WNDCLASSW {
        lpfnWndProc: Some(tray_wnd_proc),
        lpszClassName: class_name,
        ..Default::default()
    };

    RegisterClassW(&wc);

    let hwnd = CreateWindowExW(
        WINDOW_EX_STYLE::default(),
        class_name,
        w!("AuraKey"),
        WS_OVERLAPPED,
        0, 0, 0, 0,
        None,  // no parent
        None,  // no menu
        None,
        None,
    )
    .expect("Failed to create tray window");

    set_tray_hwnd(hwnd);

    // Add tray icon
    let mut nid = NOTIFYICONDATAW::default();
    nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    nid.hWnd = hwnd;
    nid.uID = TRAY_ICON_ID;
    nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    nid.uCallbackMessage = WM_TRAY_CALLBACK;

    // Load embedded icon
    if let Some(hicon) = icon_from_ico_bytes(ICON_DATA) {
        nid.hIcon = hicon;
    }

    // Set tooltip
    let tip = "AuraKey";
    let tip_wide: Vec<u16> = tip.encode_utf16().chain(std::iter::once(0)).collect();
    let copy_len = tip_wide.len().min(nid.szTip.len());
    nid.szTip[..copy_len].copy_from_slice(&tip_wide[..copy_len]);

    let _ = Shell_NotifyIconW(NIM_ADD, &nid);
}

// ========================================================================
// Window Procedure
// ========================================================================

unsafe extern "system" fn tray_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_TRAY_CALLBACK => {
            let event = (lparam.0 & 0xFFFF) as u32;
            // WM_RBUTTONUP = 0x0205, WM_LBUTTONUP = 0x0202
            if event == 0x0205 {
                show_context_menu(hwnd);
            } else if event == 0x0202 {
                launch_gui();
            }
            LRESULT(0)
        }
        WM_COMMAND => {
            let id = (wparam.0 & 0xFFFF) as u16;
            handle_menu_command(id);
            LRESULT(0)
        }
        WM_DESTROY => {
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

// ========================================================================
// Context Menu
// ========================================================================

unsafe fn show_context_menu(hwnd: HWND) {
    let menu = CreatePopupMenu().expect("Failed to create popup menu");
    let state = TRAY_STATE.lock();

    // "Open AuraKey"
    let _ = AppendMenuW(menu, MF_STRING, ID_SHOW as usize, w!("Open AuraKey"));

    // Separator
    let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());

    // Profile items
    for (i, name) in state.profiles.iter().enumerate() {
        let id = ID_PROFILE_BASE + i as u16;
        let flags = if *name == state.active_profile {
            MF_STRING | MF_CHECKED
        } else {
            MF_STRING | MF_UNCHECKED
        };
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        let _ = AppendMenuW(menu, flags, id as usize, PCWSTR(wide.as_ptr()));
    }

    // Separator
    let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());

    // Pause/Resume
    let pause_text = if state.paused { w!("Resume All") } else { w!("Pause All") };
    let _ = AppendMenuW(menu, MF_STRING, ID_PAUSE as usize, pause_text);

    // Separator
    let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());

    // Quit
    let _ = AppendMenuW(menu, MF_STRING, ID_QUIT as usize, w!("Quit"));

    drop(state); // Release lock before blocking TrackPopupMenu

    // Show menu at cursor
    let mut pt = windows::Win32::Foundation::POINT::default();
    let _ = GetCursorPos(&mut pt);
    let _ = SetForegroundWindow(hwnd);
    let _ = TrackPopupMenu(menu, TPM_LEFTALIGN | TPM_BOTTOMALIGN, pt.x, pt.y, None, hwnd, None);
    let _ = DestroyMenu(menu);
}

// ========================================================================
// Menu Command Handler
// ========================================================================

fn handle_menu_command(id: u16) {
    match id {
        ID_SHOW => {
            launch_gui();
        }
        ID_PAUSE => {
            let mut state = TRAY_STATE.lock();
            state.paused = !state.paused;
            let paused = state.paused;
            if let Some(tx) = &state.cmd_tx {
                let cmd = if paused {
                    DaemonCommand::Pause
                } else {
                    DaemonCommand::Resume
                };
                let _ = tx.send(cmd);
            }
            if let Some(etx) = &state.event_tx {
                let _ = etx.send(DaemonEvent::PauseChanged { paused });
            }
        }
        ID_QUIT => {
            let state = TRAY_STATE.lock();
            if let Some(tx) = &state.cmd_tx {
                let _ = tx.send(DaemonCommand::Shutdown);
            }
        }
        id if id >= ID_PROFILE_BASE => {
            let idx = (id - ID_PROFILE_BASE) as usize;
            let name = {
                let state = TRAY_STATE.lock();
                state.profiles.get(idx).cloned()
            };
            if let Some(name) = name {
                {
                    let mut state = TRAY_STATE.lock();
                    state.active_profile = name.clone();
                }
                if let Some(f) = PROFILE_SWITCH_FN.lock().as_ref() {
                    f(&name);
                }
                // Notify GUI of config change
                let state = TRAY_STATE.lock();
                if let Some(etx) = &state.event_tx {
                    let _ = etx.send(DaemonEvent::ConfigChanged);
                }
            }
        }
        _ => {}
    }
}

// ========================================================================
// GUI Launch
// ========================================================================

fn launch_gui() {
    let path = TRAY_STATE.lock().gui_exe_path.clone();
    let _ = std::process::Command::new(&path)
        .spawn();
}
