# Claude Prompt — AuraKey: Universal Hotkey Daemon
## Standalone Rust Project | Windows | Full-Featured Suite

---

## PROJECT OVERVIEW

Build a **brand new, standalone Rust application for Windows** called **AuraKey** —
a lightweight system tray hotkey daemon with a full-featured egui GUI. The app lets users
bind any key or key combination to a macro sequence (a series of inputs: key presses,
holds, releases, mouse moves, clicks, delays, and more) and listens globally for those
hotkeys to fire the corresponding macro.

This is a greenfield project. No existing codebase is being ported.
The Apex Legends macros described in the benchmark section are used purely as a
**capability reference** — they represent the most nuanced, timing-sensitive sequences
the system must be able to express. They also ship as built-in presets.

---

## CORE CONCEPT

```
User sets:   F8  →  [recorded or manually built sequence of input steps]
Daemon:      listening globally in background as a system tray service
User presses F8 anywhere on Windows
Daemon:      fires the sequence immediately with sub-ms precision
```

Simple. Fast. No scripting language. No interpreter. Pure data-driven input sequences.

---

## CAPABILITY BENCHMARK — APEX LEGENDS MACROS

The following 6 macros define the full feature surface the app must support.
Each one stresses a different capability combination. If the system can express
all 6 correctly, it is feature-complete for any use case.

### 1. Superglide
Presses Crouch then Jump with a precise 1-frame gap (~16ms at 60fps, ~8ms at 120fps).
```
t=0µs       KeyHold(Crouch)
t=16000µs   KeyHold(Jump)
t=17000µs   KeyRelease(Crouch)
t=26000µs   KeyRelease(Jump)
```
**Stresses:** sub-ms timeline scheduling, overlapping key hold/release pairs,
user-configurable frame-rate delay.

### 2. Armor Swap
Holds E for 550ms to open a loot box, releases, moves cursor to a screen position,
clicks, then presses ESC to close.
```
t=0ms       KeyHold(E)
t=550ms     KeyRelease(E)
t=555ms     MouseAbsoluteClick(x, y)   OR   MouseSteppedDeltaClick(dx, dy)
t=600ms     KeyTap(Escape)
```
**Stresses:** long key hold, absolute screen coordinate click, relative stepped
mouse movement, composite move+click step.

### 3. Move & Loot
Holds W, briefly taps S at 5ms, taps E at 51ms, taps Space at 119ms, releases W at 250ms.
All events overlap on a single timeline.
```
t=0µs       KeyHold(W)
t=5000µs    KeyHold(S)
t=6000µs    KeyRelease(S)
t=51000µs   KeyTap(E)
t=119000µs  KeyHold(Space)
t=129000µs  KeyRelease(Space)
t=250000µs  KeyRelease(W)
```
**Stresses:** multi-key parallel timeline, 1ms tap precision, overlapping hold states.

### 4. Jitter Aim
While trigger held: oscillates mouse by alternating delta patterns at ~100Hz.
- Phase A: MouseDelta(+amp, -amp + vertComp)
- Phase B: MouseDelta(-amp, +amp)
- User configurable: amplitude (default 26), vertical comp (default -17), rate (10ms)

**Stresses:** continuous hold mode, per-tick mouse delta, alternating phase pattern,
software SendInput mode.

### 5. Strafe Spam
Cycles through [LCtrl, A, D, Space, C, A, D, A] endlessly at a configurable rate
while trigger is held or toggled.

**Stresses:** continuous cycling key sequence, toggle vs hold trigger modes,
arbitrary user-defined key cycle.

### 6. Quick Actions (Double-Tap Detection)
Two presses of a key within 300ms fires a different macro than a single press.
Double-tap R = reload sequence. Double-tap 3 = holster sequence.

**Stresses:** FSM-based trigger (Idle → WaitingForSecond → fire/expire),
separate macro binding per tap count, configurable timeout.

---

## FULL FEATURE REQUIREMENTS

---

### FEATURE 1 — HOTKEY TRIGGERS

Every macro has one trigger. Supported trigger types:

| Type | Behavior |
|---|---|
| **Single key press** | Fires once when key goes down |
| **Key combination** | All keys in combo held simultaneously (e.g. Ctrl+Shift+F8) |
| **Hold** | Macro runs continuously while held; stops cleanly on release |
| **Toggle** | Press once to start loop, press again to stop |
| **Double-tap** | Two presses within N ms (configurable timeout) |
| **Long press** | Key held for N ms before firing (tap does nothing) |
| **Release** | Fires on key-up instead of key-down |

- Full keyboard coverage: all VK codes, F1–F24, numpad, media keys, browser keys, OEM keys
- Full modifier support: LCtrl, RCtrl, LAlt, RAlt, LShift, RShift, LWin, RWin (left/right distinct)
- A single key can have both a single-tap macro AND a double-tap macro bound simultaneously
  (the FSM determines which fires based on timing)

**Hotkey Recording (Trigger Capture):**
- User clicks "Record Hotkey" button in the editor
- App enters capture mode: the next key or combination the user physically presses
  is captured as the trigger
- Displays live key names as user holds them (e.g. "Ctrl + Shift + F8")
- Confirms on key release or after a short debounce
- Detects and warns if the chosen combo conflicts with an existing macro

---

### FEATURE 2 — SEQUENCE RECORDER

The sequence recorder lets users **perform actions naturally** while the app
records every input event into a macro sequence — which is then displayed as a
fully editable step list.

This is an **optional creation method** alongside manual step building.
Users can also build sequences entirely by hand without recording.

#### Recording Flow

1. User clicks **"Record Sequence"** in the macro editor
2. A countdown overlay appears (3... 2... 1... Recording)
3. App enters global input hook mode, capturing all keyboard and mouse events:
   - Key down → `KeyHold` step with timestamp
   - Key up → `KeyRelease` step with timestamp
   - Mouse move → `MouseDelta` step (accumulated, not every raw event)
   - Left/right/middle click → `MouseClick` step with screen coordinates
   - Scroll → `ScrollDelta` step
4. User performs the desired sequence naturally
5. User presses the configured **stop key** (default: F12, configurable) to end recording
6. Recording stops. App switches to **Post-Recording Review Panel**

#### Post-Recording Review Panel

After recording stops, the captured sequence is presented as an editable step list
BEFORE being saved. The user can review and fine-tune everything:

- **Step list view**: each captured event is shown as a row with:
  - Step number, type icon, key/coordinate/delta values
  - Timestamp (ms from recording start) shown inline
  - Editable fields for every parameter (same fields as the manual step editor)
  - Delete button per step
  - Drag handles to reorder steps

- **Timeline visualization**: a horizontal timeline bar above the step list shows
  all steps plotted by their recorded timestamps. Steps can be dragged along the
  timeline to shift their offset. Overlapping steps are shown stacked.

- **Timing controls** (applied to the whole recording or selected steps):
  - **Normalize delays**: collapses all delays below a threshold (e.g. <5ms) to 0
  - **Scale timing**: multiply all delays by a factor (e.g. 0.5x = 2× faster)
  - **Quantize**: snap all offsets to the nearest N ms grid
  - **Remove mouse movement**: strips all MouseDelta steps (keep only clicks + keys)
  - **Deduplicate**: merges redundant hold/release pairs that cancel immediately

- **Execution mode auto-detect**: if any steps overlap in time, suggest Timeline mode.
  Otherwise default to Sequential mode. User can override.

- **Test button**: plays back the current edited sequence immediately so the user
  can verify it before saving

- **"Save as Macro"** button: saves the reviewed sequence to the macro editor,
  where the user can set the trigger hotkey and finalize

#### Recording Engine Details

- Uses a low-level Windows input hook (`SetWindowsHookEx` with `WH_KEYBOARD_LL`
  and `WH_MOUSE_LL`) running on a dedicated thread
- Records raw timestamps using `Instant` with µs precision
- Mouse movement accumulation: consecutive `WM_MOUSEMOVE` events within 16ms are
  merged into a single delta to avoid thousands of tiny steps
- Click coordinates: captured as absolute screen pixel positions
- Key holds: key-down and key-up are recorded separately so hold durations are
  preserved exactly as the user performed them
- The stop key is consumed and NOT recorded into the sequence
- Maximum recording duration: 60 seconds (configurable, with visual countdown timer)

---

### FEATURE 3 — MOUSE COORDINATE SYSTEM

Mouse steps involving absolute screen positions have a full coordinate capture
and editing system. Users never need to manually figure out pixel positions.

#### Coordinate Capture (Screen Picker)

For any step that takes an absolute screen coordinate (MouseAbsoluteClick,
MouseMoveAbsolute), the user can click **"Pick on Screen"**:

1. App minimizes / hides the GUI window
2. The screen dims with a semi-transparent overlay
3. A crosshair cursor follows the mouse in real time
4. Coordinate display in corner: "X: 1243  Y: 876" updating live
5. User clicks anywhere on screen → coordinates are captured
6. App restores the GUI window and fills in the x/y fields automatically
7. A thumbnail preview shows a small screenshot of the captured region (64×64px
   around the click point) so the user can visually confirm what they clicked

#### Coordinate Editing

After capture (or for manually entered coordinates):
- x and y are editable number fields with spinner arrows
- A **"Re-pick"** button re-opens the screen picker to update the coordinates
- A **"Test Click"** button briefly hides the window and fires just that one step
  so the user can verify the click lands correctly
- Coordinate display shows both absolute pixels AND normalized 0–65535 values
  side by side (since Win32 SendInput uses normalized space internally)

#### Relative vs Absolute Mode Toggle

For every mouse movement step, a toggle selects:
- **Absolute**: x, y are pixel coordinates on screen. Pick button available.
- **Relative**: dx, dy are signed pixel offsets from current cursor position.
  Stepped mode option: splits large deltas into ~30px chunks with 1ms gaps
  to avoid Windows per-event movement capping.

#### Multi-Monitor Awareness

- Screen picker works across all monitors
- Coordinates are stored as absolute pixels in the primary monitor's coordinate space
- A monitor selector dropdown shows detected displays with their bounds
- Virtual desktop offset is applied automatically (e.g. second monitor at x=1920)

---

### FEATURE 4 — MACRO STEP BUILDER (Manual)

When not recording, users build sequences step by step manually.

Full set of step types:

| Step Type | Parameters | Notes |
|---|---|---|
| **Key Tap** | Key (picker), hold duration ms (default 10) | Full press + release |
| **Key Hold** | Key (picker) | Press down, no release |
| **Key Release** | Key (picker) | Release a held key |
| **Key Sequence** | List of keys, per-key delay ms | Multiple taps in order |
| **Mouse Move (Relative)** | dx, dy px, mode: hw/sw, stepped toggle | |
| **Mouse Move (Absolute)** | x, y px, Pick button | |
| **Mouse Click** | button: L/R/Middle, mode: hw/sw | |
| **Mouse Move + Click (Absolute)** | x, y px, Pick button, button selector | Composite step |
| **Mouse Move + Click (Stepped)** | dx, dy px, button selector | Chunked relative move |
| **Mouse Scroll** | direction: up/down/left/right, amount (notches) | |
| **Delay** | ms (spinner, min 0, max 60000) | Pure wait |
| **Repeat Block** | N steps back, X times | Loops previous N steps |
| **Label / Comment** | text string | Visual annotation only, not executed |
| **Cancel All** | — | Fires cancellation signal to abort any running macro |

**Key Picker:**
- Dropdown searchable by name ("Space", "F8", "NumPad0", etc.)
- OR: click "Capture" button, press the desired key, VK code auto-fills
- Displays both the friendly name and raw VK hex code
- Groups: Letters, Numbers, Function Keys, Numpad, Modifiers, Navigation, Media, OEM

**Step Parameter Fields by Type:**
- Keys: key picker + optional hold_ms spinner
- Mouse coords: number fields + Pick button + Re-pick + Test Click
- Delays: ms spinner with preset buttons (1ms, 10ms, 16ms, 50ms, 100ms, 500ms, 1000ms)
- Repeat: step count selector + repeat count spinner

---

### FEATURE 5 — TIMING MODES

#### Sequential Mode
- Each step has `delay_after_ms`
- Steps execute one at a time, in order
- Best for simple macros, easy to understand

#### Timeline Mode
- Each step has `offset_us` (microseconds from t=0)
- Steps execute in parallel — multiple keys active simultaneously
- Sub-ms precision: hybrid `thread::sleep` (>2ms) + `spin_loop` hint (≤2ms)
- Runs on a dedicated OS thread (not Tokio) for maximum precision
- Required for Superglide, Armor Swap, Move & Loot

**Timeline Editor View** (visual mode for timeline macros):
- Horizontal scrollable timeline, 1px = configurable time unit (µs or ms)
- Each step is a colored bar starting at its offset, width = duration
- Drag bars left/right to adjust offset
- Drag right edge of bar to adjust hold duration
- Zoom in/out (mouse wheel)
- Overlapping steps are stacked vertically with color coding by type
- Snap-to-grid toggle (1ms, 5ms, 16ms grid options)
- Playhead cursor shows progress during Test playback

#### Continuous Mode
- Runs on a worker thread at a tick rate (configurable ms)
- Two continuous patterns:
  - **Key Cycle**: cycles through a user-defined list of keys at the tick rate
  - **Mouse Oscillate**: alternating delta phases (Phase A / Phase B) at tick rate
    with configurable amplitude, vertical comp, and rate
- Hold trigger: runs while key held, stops and releases on key-up
- Toggle trigger: press to start, press again to stop
- Visual indicator in tray icon and macro list row when a continuous macro is active

---

### FEATURE 6 — MACRO ORGANIZATION

**Groups / Folders:**
- Macros can be organized into named groups (e.g. "Apex Legends", "Productivity", "Gaming")
- Groups can be collapsed/expanded in the list
- Group-level enable/disable toggle (disables all macros in group at once)
- Drag macros between groups

**Profiles:**
- A profile is a named collection of active groups
- Users can create multiple profiles (e.g. "Gaming", "Work", "Streaming")
- Profile switcher in tray menu and top of main window
- Switching profiles reloads the daemon with only that profile's macros active
- Profiles stored as separate TOML files in the config directory

**Macro States:**
- Enabled / Disabled toggle per macro (daemon ignores disabled macros)
- Favorite star for quick access
- Last-used timestamp displayed

---

### FEATURE 7 — FULL GUI LAYOUT (egui)

#### System Tray
- App runs headless in tray — no taskbar entry when window is closed
- Right-click tray menu:
  - Open AuraKey
  - Profile switcher submenu (switch profiles without opening full window)
  - Pause All / Resume All
  - Active macro indicator (shows name if a continuous macro is currently running)
  - Quit
- Tray icon states:
  - Green = active, listening
  - Yellow = paused
  - Red = error (conflict or crash)
  - Pulsing = a continuous macro is currently executing

#### Main Window Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  AuraKey          [Profile: Gaming ▼]    [⏸ Pause All]  [⚙ Settings] │
├──────────────────┬──────────────────────────────────────────────────┤
│  MACRO LIST      │  MACRO EDITOR                                    │
│                  │                                                  │
│  🔍 Search       │  Name: [Superglide              ]                │
│                  │  Trigger: [Ctrl+Space] [🔴 Record]               │
│  ▼ Apex Legends  │  Mode: (•) Press  ( ) Hold  ( ) Toggle  ( ) 2x  │
│   ✓ Superglide   │  Execution: (•) Timeline  ( ) Sequential        │
│   ✓ Armor Swap   │                                                  │
│   ✓ Move & Loot  │  ┌── Steps ─────────────────────────────────┐   │
│   ✓ Jitter Aim   │  │ [+Add Step]  [⏺ Record Sequence]         │   │
│   ✓ Strafe Spam  │  │                                           │   │
│   ✓ Quick Acts   │  │ ≡ 1 │ KeyHold   │ C          │ t=0µs   🗑 │   │
│                  │  │ ≡ 2 │ KeyHold   │ Space      │ t=16ms  🗑 │   │
│  ▶ Productivity  │  │ ≡ 3 │ KeyRelease│ C          │ t=17ms  🗑 │   │
│  ▶ Streaming     │  │ ≡ 4 │ KeyRelease│ Space      │ t=26ms  🗑 │   │
│                  │  │                                           │   │
│  [+ New Macro]   │  └───────────────────────────────────────────┘   │
│  [+ New Group]   │                                                  │
│                  │  [Timeline View 📊]  [▶ Test]  [💾 Save]  [✕]   │
│  [Import][Export]│                                                  │
└──────────────────┴──────────────────────────────────────────────────┘
```

#### Macro Editor — Detailed Panels

**Step Editor Row** (per step):
- Drag handle (≡) on left
- Step type dropdown (icon + name)
- Parameter fields (contextual per type — see Step Types above)
- For key steps: Key picker with Capture button
- For mouse coordinate steps: x/y fields + [Pick 🎯] + [Re-pick] + [Test Click]
- Delay/offset field (ms or µs depending on execution mode)
- Duplicate button (⧉)
- Delete button (🗑)

**Timeline Visual Editor** (shown when execution mode = Timeline):
- Horizontal timeline with step bars
- Appears below the step list, collapsible
- Drag-to-adjust offsets and durations
- Color legend: blue=key, green=mouse, orange=delay

**Recording Review Panel** (shown after sequence recording):
- Full-width panel replaces step list temporarily
- Step list with all captured events
- Timeline bar above with drag-adjustable positions
- Timing controls toolbar: Normalize | Scale | Quantize | Strip Mouse | Dedup
- "Accept & Edit" → transfers to main step editor
- "Discard" → returns to empty step editor

**Coordinate Picker Overlay** (full-screen, shown when Pick 🎯 is clicked):
- Semi-transparent dark overlay over entire screen (all monitors)
- Bright crosshair cursor following mouse
- Live coordinate label near cursor: "X: 1243  Y: 876"
- Small 64×64 magnified preview box in corner showing pixels under cursor
- Click anywhere → captures coordinates, closes overlay, returns to GUI
- ESC → cancels without capturing

#### Settings Panel (⚙)
- Stop key for sequence recording (default: F12)
- Recording countdown duration (1–5 seconds)
- Mouse movement accumulation threshold (ms, default 16)
- Max recording duration (seconds)
- Default execution mode for new macros
- Default tick rate for continuous macros (ms)
- Startup behavior: launch with Windows, start minimized to tray
- Theme: Dark / Light / System
- Config directory path (open in Explorer button)

---

### FEATURE 8 — IMPORT / EXPORT

- **Export**: saves selected macros (or all) to a `.akg` file (TOML with a header comment)
- **Import**: opens file picker, merges macros into current config
  - Conflict resolution: if a macro with same name exists, prompt: Skip / Replace / Rename
- **Share format**: `.akg` files are human-readable TOML, community-shareable
- **Clipboard**: copy/paste a single macro as TOML text (for sharing in forums/Discord)
- **Presets pack**: ships with a built-in "Apex Legends" preset group containing all 6
  benchmark macros, importable with one click from a built-in library panel

---

### FEATURE 9 — SAFETY & RELIABILITY

- **Conflict detection**: warns if two macros share the same trigger combo
- **Emergency stop**: a global kill hotkey (default: Ctrl+Alt+F12) immediately
  cancels all running macros and releases all held keys, regardless of state
- **Panic release**: on app crash or forced close, a cleanup routine fires
  `release_all_held_keys()` before exit to prevent stuck keys
- **Cancellation**: every macro execution checks an atomic cancellation flag between
  steps — max cancellation latency = longest single step delay
- **No overlapping one-shots**: an atomic guard prevents two one-shot/timeline
  macros from running simultaneously
- **Timeout guard**: if a macro runs longer than a configurable max duration
  (default 10 seconds), it is force-cancelled automatically
- **Input loop guard**: continuous macros cannot trigger themselves recursively

---

### FEATURE 10 — ARDUINO HID PASSTHROUGH

#### Overview

AuraKey supports an **optional Arduino-based hardware passthrough mode** where all
keyboard and mouse input generated by macros is routed through a physically connected
Arduino (Leonardo or Pro Micro, ATmega32U4) acting as a native USB HID device, instead
of using Windows' software `SendInput` API.

This is a **per-macro setting** — each macro can individually choose:
- **Software mode** (default): SendInput / Win32 API. No hardware required.
- **Arduino HID mode**: commands serialized and sent to the Arduino over COM port,
  which re-emits them as real USB HID events indistinguishable from a physical keyboard/mouse.

The Arduino firmware is bundled inside the AuraKey binary as an embedded asset and
can be **downloaded directly from the Settings panel** as a `.ino` file, ready to flash
with the Arduino IDE. No separate download or external repository needed.

---

#### Why Hardware Passthrough?

Software `SendInput` calls are tagged by Windows as synthetic input and can be detected
by games, anti-cheat systems, or applications that inspect input source flags. A hardware
Arduino appears to the OS and all software as a genuine physical USB keyboard/mouse —
the input is electrically and logically indistinguishable from a real device.

Users who need this level of hardware authenticity (competitive gaming, anti-detection,
hardware testing) can enable Arduino mode. Users who don't need it use Software mode with
zero setup required.

---

#### Supported Hardware

- Arduino Leonardo
- SparkFun Pro Micro (ATmega32U4)
- Any ATmega32U4-based board with native USB HID support
- Connected via USB to any available COM port
- Baud rate: 115200

---

#### Generalized Firmware — AuraHID v3

The bundled firmware is a **generalized, fully-featured HID emulator** built on the
reference design (Aura HID v2). It extends the protocol to cover every input action
AuraKey can generate.

**Reference design notes (from existing Aura HID v2 firmware):**
- Magic header security (0xAA prefix on all commands prevents garbage data from
  triggering inputs)
- State machine parser (WAITING_FOR_HEADER → WAITING_FOR_COMMAND)
- 100ms byte timeout for multi-byte commands
- 500ms watchdog that auto-releases all held keys if serial goes silent
- LED feedback on TX/RX pins for activity and errors
- VK-to-HID translation table (handles F1–F12, arrows, modifiers, space, etc.)
- Toggle enable/disable via 0xFF command
- Ping/health check via 0xFE command

**New in v3 — Extended Protocol:**

The v3 firmware extends the command set to full coverage of all MacroAction types:

```
PROTOCOL v3 — all commands prefixed with magic byte 0xAA

─── Single-byte commands ───────────────────────────────────────────
0xAA 0xFE           Ping          → Arduino responds 0xFE (health check)
0xAA 0xFF           Toggle        → enable/disable all input processing
0xAA 0xF0           LClick        → left mouse press + 10ms + release
0xAA 0xF1           LPress        → left mouse press (hold)
0xAA 0xF2           LRelease      → left mouse release
0xAA 0xE0           RClick        → right mouse press + 10ms + release
0xAA 0xE1           RPress        → right mouse press (hold)
0xAA 0xE2           RRelease      → right mouse release
0xAA 0xD0           MClick        → middle mouse click
0xAA 0xD1           MPress        → middle mouse press (hold)
0xAA 0xD2           MRelease      → middle mouse release
0xAA 0xCF           ReleaseAll    → Keyboard.releaseAll() + release all mouse buttons

─── Multi-byte commands ────────────────────────────────────────────
0xAA 0xF3 [dx_hi] [dx_lo] [dy_hi] [dy_lo]
    MouseMove      → Mouse.move(dx, dy) — signed 16-bit, big-endian

0xAA 0xF4 [vk]
    KeyHold        → Keyboard.press(translateVkToHid(vk)) — no release

0xAA 0xF5 [vk]
    KeyRelease     → Keyboard.release(translateVkToHid(vk))

0xAA 0xF6 [vk]
    KeyTap         → Keyboard.press + 10ms + Keyboard.release

0xAA 0xF7 [amount] [direction]
    MouseScroll    → Mouse.move(0, 0, scroll_amount)
                     direction: 0x01=up, 0x02=down, 0x03=left, 0x04=right
                     amount: 1–127 (scroll notches)

0xAA 0xF8 [button] [hold_hi] [hold_lo]
    MouseClickTimed → press button, hold for N ms (16-bit), release
                      button: 0x01=left, 0x02=right, 0x03=middle

─── VK Tap shorthand (0x01–0xBF) ──────────────────────────────────
0xAA [vk_code]     → KeyTap shorthand for vk codes 0x01–0xBF
                     Keyboard.press(translate(vk)) + 10ms + release
                     Same as v2 behavior — backward compatible
```

**Extended VK Translation Table (v3 additions over v2):**

The `translateVkToHid()` function is expanded to cover all keys AuraKey can generate:

```
F13–F24         → KEY_F13 through KEY_F24 (if board supports)
VK_NUMPAD0-9    → '0'–'9' via numpad HID codes
VK_MULTIPLY     → '*'
VK_ADD          → '+'
VK_SUBTRACT     → '-'
VK_DECIMAL      → '.'
VK_DIVIDE       → '/'
VK_LWIN/RWIN    → KEY_LEFT_GUI / KEY_RIGHT_GUI
VK_RCONTROL     → KEY_RIGHT_CTRL
VK_RMENU        → KEY_RIGHT_ALT (AltGr)
VK_RSHIFT       → KEY_RIGHT_SHIFT
VK_VOLUME_UP    → KEY_MEDIA_VOLUME_INC (if supported)
VK_VOLUME_DOWN  → KEY_MEDIA_VOLUME_DEC
VK_MEDIA_PLAY_PAUSE → KEY_MEDIA_PLAY_PAUSE
VK_PRINT        → KEY_PRINT_SCREEN (if supported)
VK_PAUSE        → KEY_PAUSE
VK_SCROLL       → KEY_SCROLL_LOCK
VK_NUMLOCK      → KEY_NUM_LOCK
VK_OEM_1        → ';' / ':'
VK_OEM_PLUS     → '=' / '+'
VK_OEM_COMMA    → ',' / '<'
VK_OEM_MINUS    → '-' / '_'
VK_OEM_PERIOD   → '.' / '>'
VK_OEM_2        → '/' / '?'
VK_OEM_3        → '`' / '~'
VK_OEM_4        → '[' / '{'
VK_OEM_5        → '\\' / '|'
VK_OEM_6        → ']' / '}'
VK_OEM_7        → '\'' / '"'
```

**Watchdog behavior (same as v2, preserved):**
- If no serial data received for 500ms and any key/button is held →
  `Keyboard.releaseAll()` + release all mouse buttons automatically
- Flash TX+RX LEDs 5 times to signal watchdog trigger
- Prevents stuck keys if host PC crashes or AuraKey is force-killed

---

#### Rust Integration — `arduino.rs`

A new module `src/arduino.rs` manages the serial connection to the Arduino:

```
arduino.rs
├── ArduinoConnection struct
│   ├── port: SerialPort (serialport crate)
│   ├── connected: AtomicBool
│   └── port_name: String
├── ArduinoConnection::connect(port_name) → Result<Self>
│   ├── Opens COM port at 115200 baud
│   ├── Sends ping (0xAA 0xFE), waits for 0xFE response
│   └── Confirms firmware is AuraHID v3 compatible
├── ArduinoConnection::disconnect()
├── send_key_tap(vk) → Result<()>          → [0xAA, vk]
├── send_key_hold(vk) → Result<()>         → [0xAA, 0xF4, vk]
├── send_key_release(vk) → Result<()>      → [0xAA, 0xF5, vk]
├── send_mouse_delta(dx, dy) → Result<()>  → [0xAA, 0xF3, dx_hi, dx_lo, dy_hi, dy_lo]
├── send_mouse_click(btn) → Result<()>     → [0xAA, 0xF0/0xE0/0xD0]
├── send_mouse_press(btn) → Result<()>     → [0xAA, 0xF1/0xE1/0xD1]
├── send_mouse_release(btn) → Result<()>   → [0xAA, 0xF2/0xE2/0xD2]
├── send_mouse_scroll(dir, amt) → Result<()> → [0xAA, 0xF7, amt, dir]
├── release_all() → Result<()>             → [0xAA, 0xCF]
├── ping() → Result<bool>                  → [0xAA, 0xFE] → expect 0xFE
├── toggle_enabled() → Result<()>          → [0xAA, 0xFF]
├── list_ports() → Vec<PortInfo>           → enumerates available COM ports
└── ArduinoError enum (NotConnected, Timeout, WrongFirmware, SerialError)
```

**Auto-reconnect:** A background thread pings the Arduino every 2 seconds. If the
ping fails, it marks the connection as lost and attempts reconnect on the same port.
The GUI shows connection status live.

---

#### Input Dispatch Layer

`input.rs` is the unified dispatch layer. Every send function checks the **output mode**
for the current macro before deciding how to send:

```rust
pub enum OutputMode {
    Software,              // Win32 SendInput (default)
    Arduino,               // Route through ArduinoConnection
}

// All send functions accept an OutputMode parameter:
pub fn send_key_tap(vk: u32, mode: OutputMode) {
    match mode {
        OutputMode::Software => winapi_key_tap(vk),
        OutputMode::Arduino  => ARDUINO.send_key_tap(vk),
    }
}
```

The `MacroDef` config struct gains a new field:
```toml
output_mode = "software"   # software | arduino
```

Per-macro output mode is set in the macro editor with a toggle:
`[💻 Software]  [🔌 Arduino HID]`

If Arduino is selected but not connected, the macro falls back to Software mode
and shows a warning badge in the macro list.

---

#### Arduino Settings Panel (in GUI Settings)

A dedicated **"Arduino HID"** section in the Settings panel:

```
┌─── Arduino HID Passthrough ──────────────────────────────────────────┐
│                                                                        │
│  Status:  🟢 Connected — COM4 (AuraHID v3)                            │
│           OR  🔴 Disconnected   OR  🟡 Searching...                    │
│                                                                        │
│  COM Port:  [COM4 ▼]  [🔄 Refresh]  [Connect]  [Disconnect]           │
│                                                                        │
│  Auto-connect on startup:  [✓]                                         │
│  Fallback to software if disconnected:  [✓]                            │
│                                                                        │
│  Firmware:  ─────────────────────────────────────────────────────     │
│  [ 📥 Download AuraHID_v3.ino ]                                        │
│                                                                        │
│  Flash instructions:                                                   │
│  1. Open Arduino IDE                                                   │
│  2. Select board: Arduino Leonardo or SparkFun Pro Micro               │
│  3. Select your COM port                                               │
│  4. Open downloaded .ino file                                          │
│  5. Click Upload                                                       │
│  6. Return here and click Connect                                      │
│                                                                        │
│  [▶ Send Test Ping]   Last ping: 2ms                                   │
│  [🔑 Send Test Keystroke (A)]   [🖱 Send Test Click]                   │
└────────────────────────────────────────────────────────────────────────┘
```

**Download button behavior:**
- The `AuraHID_v3.ino` firmware source is embedded in the AuraKey binary as a
  compile-time `include_str!` asset
- Clicking Download opens a native save-file dialog (via `rfd`) defaulting to
  `AuraHID_v3.ino` and writes the embedded string to disk
- No network request, no external dependency — firmware always ships with the app

**Test buttons:**
- "Send Test Ping": sends 0xAA 0xFE, shows round-trip latency in ms
- "Send Test Keystroke": sends 0xAA 0x41 (KeyTap A) — user sees 'a' typed
- "Send Test Click": sends 0xAA 0xF0 (left click at current cursor position)

---

#### Per-Macro Output Mode in Editor

In the Macro Editor right panel, below the execution mode selector:

```
Output:  ( ) Software SendInput   (•) Arduino HID
          [Status: 🟢 COM4]
```

If Arduino is not connected:
```
Output:  ( ) Software SendInput   (•) Arduino HID ⚠
          [Arduino not connected — will fall back to Software]
```

---

#### Config Schema Addition

```toml
[settings.arduino]
enabled = true
port = "COM4"
auto_connect = true
fallback_to_software = true

# Per-macro field:
[[profiles.list.groups.macros]]
name = "Superglide"
output_mode = "arduino"   # software | arduino (default: software)
```

---

#### Bundled Firmware File — `assets/AuraHID_v3.ino`

The complete generalized firmware source is stored at `assets/AuraHID_v3.ino`
and embedded at compile time via `include_str!("../assets/AuraHID_v3.ino")`.

It must be a complete, self-contained Arduino sketch that:
- Implements all v3 protocol commands listed above
- Includes the full extended VK translation table
- Preserves all v2 safety features (magic header, watchdog, timeout, LED feedback)
- Has clear inline comments explaining every command byte
- Has a version constant `const char* FIRMWARE_VERSION = "AuraHID-v3.0";` at the top
- Compiles cleanly for Arduino Leonardo and SparkFun Pro Micro with zero warnings
- Is written for users who may be new to Arduino — comments explain the purpose
  of each section in plain language

---

## ARCHITECTURE

```
main.rs
├── Initializes config (load or create default with Apex presets)
├── Spawns tokio runtime
├── Spawns daemon thread
├── Spawns recorder thread (idle until recording starts)
├── Runs eframe GUI on main thread
└── Wires channels: GUI ↔ daemon, GUI ↔ recorder

daemon.rs
├── global-hotkey crate event loop on dedicated thread
├── Receives config reload messages from GUI (crossbeam channel)
├── Dispatches on hotkey match:
│   ├── press/one-shot  → spawn_oneshot() or spawn_timeline()
│   ├── hold            → starts tick loop, watches for key-up to stop
│   ├── toggle          → flips atomic, starts/stops tick loop
│   ├── double-tap      → DoubleTapFsm per trigger key
│   └── long-press      → timer that fires if key held > threshold
├── Tracks all active continuous macro handles (for cancel-on-reload)
└── Broadcasts macro execution events back to GUI (for status display)

recorder.rs
├── Low-level Windows hooks: WH_KEYBOARD_LL + WH_MOUSE_LL
├── Captures timestamped input events into a Vec<RawEvent>
├── Mouse move accumulator: merges consecutive moves within 16ms
├── Stops on stop-key press
├── Post-processing: normalize, convert to MacroStep list
└── Sends completed RecordingResult to GUI via channel

input.rs  ← unified dispatch layer
├── OutputMode enum { Software, Arduino }
├── send_key_tap(vk, mode)
├── send_key_hold(vk, mode)
├── send_key_release(vk, mode)
├── send_mouse_delta(dx, dy, mode)            ← routes to HW, SW, or Arduino
├── send_mouse_delta_software(dx, dy)         ← SendInput only
├── send_mouse_delta_stepped(dx, dy, chunk)   ← chunked SendInput
├── send_mouse_absolute(x, y)
├── send_mouse_absolute_click(x, y)
├── send_mouse_click(mode)
├── send_mouse_click_software()
├── send_mouse_scroll(direction, amount, mode)
└── release_all_held_keys(mode)               ← releases on both channels if needed

arduino.rs  ← NEW
├── ArduinoConnection { port, connected, port_name }
├── connect(port_name) → Result — pings firmware to verify AuraHID v3
├── disconnect()
├── send_key_tap/hold/release(vk)
├── send_mouse_delta(dx, dy)
├── send_mouse_click/press/release(button)
├── send_mouse_scroll(direction, amount)
├── release_all()
├── ping() → Result<latency_ms>
├── list_ports() → Vec<PortInfo>
├── auto_reconnect_loop() — background thread, 2s ping interval
└── FIRMWARE_ASSET: &str = include_str!("../assets/AuraHID_v3.ino")

executor.rs
├── MacroAction enum (all step types including Scroll, RepeatBlock, Comment)
├── MacroStep { action, delay_after_ms }
├── MacroTimeline { events: Vec<TimelineEvent> } sorted by offset_us
├── execute_sequence() — async, sequential, cancellable
├── execute_timeline_blocking() — dedicated OS thread, hybrid sleep+spin
├── spawn_oneshot() — fire-and-forget, ONESHOT_RUNNING guard
├── spawn_timeline() — dedicated thread, ONESHOT_RUNNING guard
├── ContinuousState — per-macro tick loop state (KeyCycle | MouseOscillate)
├── MACRO_CANCEL: AtomicBool
├── ONESHOT_RUNNING: AtomicBool
└── spawn_continuous_loop(state, trigger_held: Arc<AtomicBool>)

config.rs
├── AppConfig (global settings: stop key, theme, startup, etc.)
├── Profile { name, groups: Vec<MacroGroup> }
├── MacroGroup { name, enabled, macros: Vec<MacroDef> }
├── MacroDef { name, enabled, trigger: TriggerConfig, steps: Vec<StepDef> }
├── TriggerConfig { keys, mode, timeout_ms, long_press_ms }
├── StepDef (tagged enum matching MacroAction, with offset_us or delay_ms)
├── load_profile(path) / save_profile(path)
├── list_profiles(config_dir)
└── default_apex_presets() → Profile

gui.rs
├── App state struct (current profile, selected macro, editor state)
├── MacroListPanel::show()
├── MacroEditorPanel::show()
│   ├── TriggerRow (hotkey badge + record button)
│   ├── StepListEditor (drag-to-reorder, per-step rows)
│   ├── TimelineVisualEditor (horizontal bar chart, drag offsets)
│   └── ContinuousPatternEditor (key cycle list OR oscillate params)
├── RecordingReviewPanel::show()
│   ├── CapturedStepList (editable)
│   ├── TimelineBar (draggable step positions)
│   └── TimingControlsToolbar
├── CoordinatePicker (full-screen overlay window)
│   ├── screen capture for magnifier preview
│   ├── live coordinate label
│   └── click → capture → return coordinates
├── SettingsPanel::show()
│   └── ArduinoPanel::show()    ← port selector, connect, download firmware, test buttons
├── ProfileSwitcher
└── TrayMenuBuilder
```

---

## CONFIG SCHEMA (TOML)

```toml
# AuraKey config — aurakey.toml

[settings]
stop_key = "F12"
emergency_stop = "Ctrl+Alt+F12"
recording_countdown_secs = 3
mouse_accumulate_ms = 16
max_recording_secs = 60
default_execution = "sequential"
default_tick_rate_ms = 10
launch_with_windows = false
start_minimized = true
theme = "dark"

[profiles]
active = "Gaming"

[[profiles.list]]
name = "Gaming"

  [[profiles.list.groups]]
  name = "Apex Legends"
  enabled = true

    [[profiles.list.groups.macros]]
    name = "Superglide"
    enabled = true

      [profiles.list.groups.macros.trigger]
      keys = ["LControl", "Space"]
      mode = "press"   # press | hold | toggle | double_tap | long_press | release

      [profiles.list.groups.macros.execution]
      mode = "timeline"   # sequential | timeline | continuous

      [[profiles.list.groups.macros.steps]]
      type = "KeyHold"
      key = "C"
      offset_us = 0

      [[profiles.list.groups.macros.steps]]
      type = "KeyHold"
      key = "Space"
      offset_us = 16000

      [[profiles.list.groups.macros.steps]]
      type = "KeyRelease"
      key = "C"
      offset_us = 17000

      [[profiles.list.groups.macros.steps]]
      type = "KeyRelease"
      key = "Space"
      offset_us = 26000

    [[profiles.list.groups.macros]]
    name = "Armor Swap"
    enabled = true

      [profiles.list.groups.macros.trigger]
      keys = ["F9"]
      mode = "press"

      [profiles.list.groups.macros.execution]
      mode = "timeline"

      [[profiles.list.groups.macros.steps]]
      type = "KeyHold"
      key = "E"
      offset_us = 0

      [[profiles.list.groups.macros.steps]]
      type = "KeyRelease"
      key = "E"
      offset_us = 550000

      [[profiles.list.groups.macros.steps]]
      type = "MouseAbsoluteClick"
      x = 960
      y = 540
      offset_us = 555000

      [[profiles.list.groups.macros.steps]]
      type = "KeyTap"
      key = "Escape"
      offset_us = 600000

    [[profiles.list.groups.macros]]
    name = "Jitter Aim"
    enabled = true

      [profiles.list.groups.macros.trigger]
      keys = ["F8"]
      mode = "hold"

      [profiles.list.groups.macros.execution]
      mode = "continuous"
      pattern = "MouseOscillate"
      amplitude = 26
      vertical_comp = -17
      rate_ms = 10

    [[profiles.list.groups.macros]]
    name = "Strafe Spam"
    enabled = true

      [profiles.list.groups.macros.trigger]
      keys = ["F7"]
      mode = "toggle"

      [profiles.list.groups.macros.execution]
      mode = "continuous"
      pattern = "KeyCycle"
      keys = ["LControl", "A", "D", "Space", "C", "A", "D", "A"]
      rate_ms = 30
```

---

## TECH STACK

| Crate | Purpose |
|---|---|
| `egui` + `eframe` | GUI window (immediate mode, pure Rust) |
| `global-hotkey` | System-wide hotkey registration + event loop |
| `tray-icon` | System tray icon + context menu |
| `serde` + `toml` | Config serialization |
| `crossbeam-channel` | GUI ↔ daemon ↔ recorder ↔ arduino thread messaging |
| `tokio` | Async runtime for sequential macro execution |
| `winapi` or `windows` crate | SendInput, SetCursorPos, WH_KEYBOARD_LL, WH_MOUSE_LL, GetCursorPos, VK constants |
| `serialport` | Cross-platform serial COM port access for Arduino connection |
| `screenshots` or `win32` GDI | Screen capture for coordinate picker magnifier |
| `rfd` | Native file picker dialogs (Import/Export, firmware save) |
| `dirs` | Config directory resolution |

---

## IMPLEMENTATION CONSTRAINTS

1. **Single binary** — one `.exe`, no installer, no DLLs, no runtime
2. **No scripting runtime** — macros are pure data structs, not executable code
3. **Windows only** — Win32 APIs throughout, no cross-platform abstraction
4. **Minimal footprint** — target <10MB binary, <20MB RAM idle
5. **Sub-ms timing** — timeline mode must use hybrid sleep + spin-wait (not just sleep)
6. **Safe cancellation** — every execution path checks atomic cancel flag; always
   calls `release_all_held_keys()` on cancel, completion, or error
7. **No overlapping one-shots** — ONESHOT_RUNNING atomic guard is mandatory
8. **Stuck key prevention** — on any panic, drop impl fires release_all_held_keys()
9. **Apex presets ship on first run** — `macros.toml` created with all 6 presets
   if no config exists, so users have working examples immediately

---

## DELIVERABLES (in order)

1. `Cargo.toml` — all deps, feature flags, Windows subsystem config
2. `src/config.rs` — full serde schema, load/save, default Apex presets, arduino config
3. `src/input.rs` — unified dispatch layer with OutputMode, all Win32 + Arduino routing
4. `src/arduino.rs` — serial connection, full v3 protocol impl, auto-reconnect, ping
5. `src/executor.rs` — MacroAction, MacroStep, MacroTimeline, all execution fns + atomics
6. `src/recorder.rs` — Windows input hooks, event capture, post-processing pipeline
7. `src/daemon.rs` — hotkey listener, dispatch, continuous loop, FSM triggers
8. `src/gui/mod.rs` — top-level GUI app struct, eframe integration
9. `src/gui/macro_list.rs` — left panel, groups, search, profile switcher
10. `src/gui/macro_editor.rs` — right panel, step list, trigger row, mode selectors, output mode toggle
11. `src/gui/step_editor.rs` — per-step-type parameter rows, key picker, coord fields
12. `src/gui/timeline_editor.rs` — visual timeline bar with drag-to-adjust
13. `src/gui/recording_review.rs` — post-record panel, timing controls, accept/discard
14. `src/gui/coordinate_picker.rs` — full-screen overlay, magnifier, click capture
15. `src/gui/settings.rs` — settings panel including full Arduino HID panel
16. `src/main.rs` — wires all threads, channels, tray, runtime, arduino auto-connect
17. `assets/AuraHID_v3.ino` — complete generalized Arduino firmware (embedded in binary)
18. `assets/macros.toml` — example config with all 6 Apex presets fully expressed

Write production-quality, well-commented Rust. `#[derive(Debug, Clone, Serialize, Deserialize)]`
on all config types. Named constants for all VK codes. Doc comments on every public item.
Prefer explicit error handling (`anyhow` or `thiserror`) over `.unwrap()` in production paths.
