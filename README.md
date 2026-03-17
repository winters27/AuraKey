<p align="center">
  <h1 align="center">AuraKey</h1>
  <p align="center">Lightweight system tray hotkey daemon with macro sequencing.</p>
</p>

<p align="center">
  <a href="https://github.com/winters27/AuraKey/releases/latest"><img src="https://img.shields.io/github/v/release/winters27/AuraKey?style=flat-square&color=teal" alt="Release"></a>
  <a href="https://github.com/winters27/AuraKey"><img src="https://img.shields.io/github/languages/top/winters27/AuraKey?style=flat-square&color=orange" alt="Language"></a>
  <a href="https://github.com/winters27/AuraKey/blob/main/LICENSE"><img src="https://img.shields.io/github/license/winters27/AuraKey?style=flat-square" alt="License"></a>
  <a href="https://github.com/winters27/AuraKey/releases/latest"><img src="https://img.shields.io/github/downloads/winters27/AuraKey/total?style=flat-square&color=blue" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D6?style=flat-square&logo=windows" alt="Platform">
</p>

---

AuraKey is a Windows utility for creating, managing, and executing macros triggered by **keyboard**, **mouse**, or **XInput controller** inputs. Built with a Tauri + React frontend and a standalone Rust daemon that runs in the background.

## Features

- **Multi-Input Triggers** — Bind macros to keyboard shortcuts, mouse buttons, or Xbox/XInput controller buttons
- **Macro Sequencing** — Record or manually build multi-step macros with key presses, mouse actions, delays, and more
- **Step Types** — Key tap, key hold, mouse click, mouse move, scroll, delay, Run Program, and text type
- **Execution Modes** — Sequential, timeline (absolute timestamps), or continuous (repeating loop)
- **Profile System** — Organize macros into profiles with named groups, enable/disable individually
- **Recording** — Capture keyboard and mouse input in real-time with configurable countdown and duration
- **Arduino HID Passthrough** — Route keystrokes through an Arduino for hardware-level input simulation
- **Import / Export** — Share macro profiles as `.akg` files
- **Conflict Detection** — Warns when multiple macros share the same trigger
- **System Tray** — Daemon runs silently with a tray icon; GUI connects via named pipe IPC

## Architecture

```text
┌──────────────┐       Named Pipe IPC       ┌──────────────────┐
│  aurakey.exe │  ◄──────────────────────►  │  aurakey-service  │
│   (Tauri GUI) │                            │    (Daemon)       │
└──────────────┘                            └──────────────────┘
                                              ├─ Input hooks (keyboard, mouse, XInput)
                                              ├─ Macro executor
                                              ├─ Config manager
                                              └─ Arduino bridge
```

- **`aurakey.exe`** — Tauri GUI for editing macros, settings, and monitoring. Connects to the daemon on launch.
- **`aurakey-service.exe`** — Standalone background daemon. Listens for hotkeys, executes macros, manages the system tray icon. Persists after the GUI closes.

## Tech Stack

| Layer                | Technology                              |
| -------------------- | --------------------------------------- |
| Frontend             | React, TypeScript, Vite                 |
| UI Components        | Radix UI primitives, custom CSS         |
| Desktop Shell        | Tauri v2                                |
| Backend / Daemon     | Rust                                    |
| IPC                  | Windows Named Pipes                     |
| Input Simulation     | Win32 `SendInput` API                   |
| Controller Support   | XInput (Xbox controllers)               |
| Hardware Passthrough | Serial (Arduino Leonardo / Pro Micro)   |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.75+
- Windows 10/11

### Development

```bash
# Install frontend dependencies
npm install

# Build the daemon (required before first run)
cd src-tauri && cargo build --bin aurakey-service --no-default-features && cd ..

# Launch in dev mode
npm run tauri dev
```

### Release Build

```bash
npm run tauri build
```

Produces `aurakey.exe` and `aurakey-service.exe` in `src-tauri/target/release/`.

> **Note:** Both `aurakey.exe` and `aurakey-service.exe` must be in the same directory. The GUI auto-launches the service if it isn't already running.

## Configuration

Config is stored in `%APPDATA%/AuraKey/config.toml`. Open it from the app via **Settings → Config Directory → Open**.

## License

MIT
