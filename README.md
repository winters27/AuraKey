# AuraKey

**Lightweight system tray hotkey daemon with macro sequencing.**

AuraKey is a Windows utility for creating, managing, and executing keyboard/mouse macros. Built with a Tauri + React frontend and a standalone Rust daemon that runs in the background.

---

## Features

- **Macro Sequencing** — Record or manually build multi-step macros with key presses, mouse actions, delays, and more
- **Multiple Trigger Sets** — Bind macros to keyboard shortcuts, mouse buttons, or Xbox controller buttons
- **Step Types** — Key tap, key hold, mouse click, mouse move, scroll, delay, Run Program, and text type
- **Execution Modes** — Sequential, timeline (absolute timestamps), or continuous (repeating loop)
- **Profile System** — Organize macros into profiles with named groups, enable/disable individually
- **Recording** — Capture keyboard and mouse input in real-time with configurable countdown and duration
- **Arduino HID Passthrough** — Route keystrokes through an Arduino for hardware-level input simulation
- **Import / Export** — Share macro profiles as `.akg` files
- **Conflict Detection** — Warns when multiple macros share the same trigger
- **System Tray** — Daemon runs silently with a tray icon; GUI connects via named pipe IPC

## Architecture

```
┌──────────────┐       Named Pipe IPC       ┌──────────────────┐
│  aurakey.exe │  ◄──────────────────────►  │  aurakey-service  │
│   (Tauri GUI) │                            │    (Daemon)       │
└──────────────┘                            └──────────────────┘
                                              ├─ Input hooks
                                              ├─ Macro executor
                                              ├─ Config manager
                                              └─ Arduino bridge
```

- **`aurakey.exe`** — Tauri GUI for editing macros, settings, and monitoring. Connects to the daemon on launch.
- **`aurakey-service.exe`** — Standalone background daemon. Listens for hotkeys, executes macros, manages the system tray icon. Persists after the GUI closes.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, TypeScript, Vite |
| UI Components | Radix UI primitives, custom CSS |
| Desktop Shell | Tauri v2 |
| Backend / Daemon | Rust |
| IPC | Windows Named Pipes |
| Input Simulation | Win32 `SendInput` API |
| Hardware Passthrough | Serial (Arduino Leonardo / Pro Micro) |

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

Produces `aurakey.exe`, `aurakey-service.exe`, and MSI/NSIS installers in `src-tauri/target/release/`.

> **Note:** Both `aurakey.exe` and `aurakey-service.exe` must be in the same directory. The GUI auto-launches the service if it isn't already running.

## Configuration

Config is stored in `%APPDATA%/AuraKey/config.toml`. Open it from the app via **Settings → Config Directory → Open**.

## License

MIT
