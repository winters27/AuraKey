/*
 * AuraHID v3 — Generalized Arduino USB HID Emulator
 *
 * A complete, self-contained firmware for ATmega32U4-based boards
 * (Arduino Leonardo, SparkFun Pro Micro) that receives commands over
 * Serial and emits genuine USB HID keyboard and mouse events.
 *
 * Protocol v3 — all commands prefixed with magic byte 0xAA.
 *
 * Hardware: Arduino Leonardo or SparkFun Pro Micro (ATmega32U4)
 * Baud Rate: 115200
 *
 * Installation:
 *   1. Open Arduino IDE
 *   2. Select Board: "Arduino Leonardo" or "SparkFun Pro Micro"
 *   3. Select your COM port
 *   4. Upload this sketch
 *   5. Return to AuraKey Settings and click Connect
 *
 * Backward compatible with AuraHID v2 — all v2 commands still work.
 */

#include <Keyboard.h>
#include <Mouse.h>

// ============================================================================
// VERSION
// ============================================================================
const char* FIRMWARE_VERSION = "AuraHID-v3.0";

// ============================================================================
// CONFIGURATION
// ============================================================================
const unsigned long BAUD_RATE = 115200;
const unsigned int KEY_HOLD_MS = 10;           // Default hold time for tap commands

// ============================================================================
// SECURITY — Magic header byte (commands MUST start with this)
// ============================================================================
const byte MAGIC_HEADER = 0xAA;

// ============================================================================
// PROTOCOL COMMANDS
// ============================================================================

// — Single-byte commands (0xAA + cmd) —
const byte CMD_LCLICK         = 0xF0;  // Left mouse click (press + 10ms + release)
const byte CMD_LPRESS         = 0xF1;  // Left mouse press (hold)
const byte CMD_LRELEASE       = 0xF2;  // Left mouse release
const byte CMD_RCLICK         = 0xE0;  // Right mouse click
const byte CMD_RPRESS         = 0xE1;  // Right mouse press (hold)
const byte CMD_RRELEASE       = 0xE2;  // Right mouse release
const byte CMD_MCLICK         = 0xD0;  // Middle mouse click
const byte CMD_MPRESS         = 0xD1;  // Middle mouse press (hold)
const byte CMD_MRELEASE       = 0xD2;  // Middle mouse release
const byte CMD_RELEASE_ALL    = 0xCF;  // Release all keys + all mouse buttons
const byte CMD_PING           = 0xFE;  // Health check (responds with 0xFE)
const byte CMD_TOGGLE_ENABLED = 0xFF;  // Toggle input processing on/off

// — Multi-byte commands —
const byte CMD_MOUSE_MOVE     = 0xF3;  // [0xAA][0xF3][dx_hi][dx_lo][dy_hi][dy_lo]
const byte CMD_KEY_HOLD       = 0xF4;  // [0xAA][0xF4][vk]
const byte CMD_KEY_RELEASE    = 0xF5;  // [0xAA][0xF5][vk]
const byte CMD_KEY_TAP        = 0xF6;  // [0xAA][0xF6][vk]  (explicit tap command)
const byte CMD_MOUSE_SCROLL   = 0xF7;  // [0xAA][0xF7][amount][direction]
const byte CMD_MOUSE_CLICK_T  = 0xF8;  // [0xAA][0xF8][button][hold_hi][hold_lo]

// ============================================================================
// STATE
// ============================================================================
bool isEnabled = true;
unsigned long lastByteTime = 0;
const unsigned long TIMEOUT_MS = 100;       // Multi-byte command timeout

// Watchdog: auto-release if no serial data for this long while keys are held
const unsigned long WATCHDOG_MS = 500;
bool anyKeysHeld = false;
bool anyMouseHeld = false;

// Protocol state machine
enum State { WAITING_FOR_HEADER, WAITING_FOR_COMMAND };
State currentState = WAITING_FOR_HEADER;

// ============================================================================
// LED FEEDBACK
// ============================================================================
#if defined(__AVR_ATmega32U4__)
  #define HAS_TXRX_LEDS 1
  #define TX_LED_PIN 30
  #define RX_LED_PIN 17
#else
  #define HAS_TXRX_LEDS 0
#endif

void startupAnimation() {
#if HAS_TXRX_LEDS
  for (int i = 0; i < 3; i++) {
    digitalWrite(TX_LED_PIN, LOW);
    digitalWrite(RX_LED_PIN, HIGH);
    delay(80);
    digitalWrite(TX_LED_PIN, HIGH);
    digitalWrite(RX_LED_PIN, LOW);
    delay(80);
  }
  digitalWrite(TX_LED_PIN, HIGH);
  digitalWrite(RX_LED_PIN, HIGH);
  delay(200);
  // Final flash to signal v3 ready
  digitalWrite(TX_LED_PIN, LOW);
  digitalWrite(RX_LED_PIN, LOW);
  delay(150);
  digitalWrite(TX_LED_PIN, HIGH);
  digitalWrite(RX_LED_PIN, HIGH);
#endif
}

void blinkActivity() {
#if HAS_TXRX_LEDS
  digitalWrite(TX_LED_PIN, LOW);
#endif
}

void endActivityBlink() {
#if HAS_TXRX_LEDS
  digitalWrite(TX_LED_PIN, HIGH);
#endif
}

void blinkError() {
#if HAS_TXRX_LEDS
  digitalWrite(RX_LED_PIN, LOW);
  delay(30);
  digitalWrite(RX_LED_PIN, HIGH);
#endif
}

void blinkWatchdog() {
#if HAS_TXRX_LEDS
  for (int i = 0; i < 5; i++) {
    digitalWrite(TX_LED_PIN, LOW);
    digitalWrite(RX_LED_PIN, LOW);
    delay(50);
    digitalWrite(TX_LED_PIN, HIGH);
    digitalWrite(RX_LED_PIN, HIGH);
    delay(50);
  }
#endif
}

// ============================================================================
// SETUP
// ============================================================================
void setup() {
#if HAS_TXRX_LEDS
  pinMode(TX_LED_PIN, OUTPUT);
  pinMode(RX_LED_PIN, OUTPUT);
  digitalWrite(TX_LED_PIN, HIGH);
  digitalWrite(RX_LED_PIN, HIGH);
#endif

  Serial.begin(BAUD_RATE);
  Keyboard.begin();
  Mouse.begin();

  delay(500);
  startupAnimation();
}

// ============================================================================
// VK-TO-HID TRANSLATION TABLE (Extended v3)
// ============================================================================
byte translateVkToHid(byte vk) {
  switch (vk) {
    // --- Modifiers ---
    case 0xA0: return KEY_LEFT_SHIFT;    // VK_LSHIFT
    case 0xA1: return KEY_RIGHT_SHIFT;   // VK_RSHIFT
    case 0x10: return KEY_LEFT_SHIFT;    // VK_SHIFT (generic)
    case 0xA2: return KEY_LEFT_CTRL;     // VK_LCONTROL
    case 0xA3: return KEY_RIGHT_CTRL;    // VK_RCONTROL
    case 0x11: return KEY_LEFT_CTRL;     // VK_CONTROL (generic)
    case 0xA4: return KEY_LEFT_ALT;      // VK_LMENU (LAlt)
    case 0xA5: return KEY_RIGHT_ALT;     // VK_RMENU (RAlt/AltGr)
    case 0x12: return KEY_LEFT_ALT;      // VK_MENU (generic)
    case 0x5B: return KEY_LEFT_GUI;      // VK_LWIN
    case 0x5C: return KEY_RIGHT_GUI;     // VK_RWIN

    // --- Lock keys ---
    case 0x14: return KEY_CAPS_LOCK;
    case 0x90: return 0x53;              // VK_NUMLOCK  → HID NumLock
    case 0x91: return 0x47;              // VK_SCROLL   → HID ScrollLock

    // --- Function keys F1-F12 ---
    case 0x70: return KEY_F1;
    case 0x71: return KEY_F2;
    case 0x72: return KEY_F3;
    case 0x73: return KEY_F4;
    case 0x74: return KEY_F5;
    case 0x75: return KEY_F6;
    case 0x76: return KEY_F7;
    case 0x77: return KEY_F8;
    case 0x78: return KEY_F9;
    case 0x79: return KEY_F10;
    case 0x7A: return KEY_F11;
    case 0x7B: return KEY_F12;

    // --- F13-F24 (extended, if board supports) ---
    case 0x7C: return KEY_F13;
    case 0x7D: return KEY_F14;
    case 0x7E: return KEY_F15;
    case 0x7F: return KEY_F16;
    case 0x80: return KEY_F17;
    case 0x81: return KEY_F18;
    case 0x82: return KEY_F19;
    case 0x83: return KEY_F20;
    case 0x84: return KEY_F21;
    case 0x85: return KEY_F22;
    case 0x86: return KEY_F23;
    case 0x87: return KEY_F24;

    // --- Navigation ---
    case 0x1B: return KEY_ESC;
    case 0x09: return KEY_TAB;
    case 0x08: return KEY_BACKSPACE;
    case 0x0D: return KEY_RETURN;
    case 0x2D: return KEY_INSERT;
    case 0x2E: return KEY_DELETE;
    case 0x24: return KEY_HOME;
    case 0x23: return KEY_END;
    case 0x21: return KEY_PAGE_UP;
    case 0x22: return KEY_PAGE_DOWN;
    case 0x25: return KEY_LEFT_ARROW;
    case 0x26: return KEY_UP_ARROW;
    case 0x27: return KEY_RIGHT_ARROW;
    case 0x28: return KEY_DOWN_ARROW;

    // --- Special ---
    case 0x20: return ' ';               // VK_SPACE
    case 0x2C: return 0x46;              // VK_PRINT → HID PrintScreen

    // --- Numpad ---
    case 0x60: return 0x62;  // Numpad 0
    case 0x61: return 0x59;  // Numpad 1
    case 0x62: return 0x5A;  // Numpad 2
    case 0x63: return 0x5B;  // Numpad 3
    case 0x64: return 0x5C;  // Numpad 4
    case 0x65: return 0x5D;  // Numpad 5
    case 0x66: return 0x5E;  // Numpad 6
    case 0x67: return 0x5F;  // Numpad 7
    case 0x68: return 0x60;  // Numpad 8
    case 0x69: return 0x61;  // Numpad 9
    case 0x6A: return 0x55;  // Numpad *
    case 0x6B: return 0x57;  // Numpad +
    case 0x6D: return 0x56;  // Numpad -
    case 0x6E: return 0x63;  // Numpad .
    case 0x6F: return 0x54;  // Numpad /

    // --- OEM keys ---
    case 0xBA: return ';';   // VK_OEM_1
    case 0xBB: return '=';   // VK_OEM_PLUS
    case 0xBC: return ',';   // VK_OEM_COMMA
    case 0xBD: return '-';   // VK_OEM_MINUS
    case 0xBE: return '.';   // VK_OEM_PERIOD
    case 0xBF: return '/';   // VK_OEM_2
    case 0xC0: return '`';   // VK_OEM_3
    case 0xDB: return '[';   // VK_OEM_4
    case 0xDC: return '\\';  // VK_OEM_5
    case 0xDD: return ']';   // VK_OEM_6
    case 0xDE: return '\'';  // VK_OEM_7

    default:
      // Letters A-Z (0x41-0x5A): convert to lowercase for Arduino Keyboard
      if (vk >= 0x41 && vk <= 0x5A) {
        return vk + 0x20;  // 'A'→'a', 'W'→'w', etc.
      }
      // Numbers 0-9 (0x30-0x39): pass through as ASCII
      if (vk >= 0x30 && vk <= 0x39) {
        return vk;
      }
      return vk;
  }
}

// ============================================================================
// HELPER: Wait for N bytes with timeout
// ============================================================================
bool waitForBytes(int count) {
  unsigned long waitStart = millis();
  while (Serial.available() < count) {
    if (millis() - waitStart > TIMEOUT_MS) {
      currentState = WAITING_FOR_HEADER;
      return false;
    }
  }
  return true;
}

// ============================================================================
// HELPER: Mouse button operations
// ============================================================================
void pressMouseButton(byte button) {
  switch (button) {
    case 0x01: Mouse.press(MOUSE_LEFT);   break;
    case 0x02: Mouse.press(MOUSE_RIGHT);  break;
    case 0x03: Mouse.press(MOUSE_MIDDLE); break;
  }
}

void releaseMouseButton(byte button) {
  switch (button) {
    case 0x01: Mouse.release(MOUSE_LEFT);   break;
    case 0x02: Mouse.release(MOUSE_RIGHT);  break;
    case 0x03: Mouse.release(MOUSE_MIDDLE); break;
  }
}

// ============================================================================
// COMMAND EXECUTION
// ============================================================================
void executeCommand(byte cmdByte) {

  // --- PING (always responds, even when disabled) ---
  if (cmdByte == CMD_PING) {
    Serial.write(0xFE);
    blinkActivity();
    delay(20);
    endActivityBlink();
    return;
  }

  // --- TOGGLE ---
  if (cmdByte == CMD_TOGGLE_ENABLED) {
    isEnabled = !isEnabled;
#if HAS_TXRX_LEDS
    for (int i = 0; i < 2; i++) {
      digitalWrite(TX_LED_PIN, LOW);
      digitalWrite(RX_LED_PIN, LOW);
      delay(100);
      digitalWrite(TX_LED_PIN, HIGH);
      digitalWrite(RX_LED_PIN, HIGH);
      delay(100);
    }
#endif
    return;
  }

  // All remaining commands require enabled state
  if (!isEnabled) return;

  // Ignore null bytes
  if (cmdByte == 0x00) return;

  // --- RELEASE ALL (0xCF) ---
  if (cmdByte == CMD_RELEASE_ALL) {
    blinkActivity();
    Keyboard.releaseAll();
    Mouse.release(MOUSE_LEFT);
    Mouse.release(MOUSE_RIGHT);
    Mouse.release(MOUSE_MIDDLE);
    anyKeysHeld = false;
    anyMouseHeld = false;
    endActivityBlink();
    return;
  }

  // --- LEFT MOUSE ---
  if (cmdByte == CMD_LCLICK) {
    blinkActivity();
    Mouse.press(MOUSE_LEFT);
    delay(KEY_HOLD_MS);
    Mouse.release(MOUSE_LEFT);
    endActivityBlink();
    return;
  }
  if (cmdByte == CMD_LPRESS) {
    blinkActivity();
    Mouse.press(MOUSE_LEFT);
    anyMouseHeld = true;
    endActivityBlink();
    return;
  }
  if (cmdByte == CMD_LRELEASE) {
    blinkActivity();
    Mouse.release(MOUSE_LEFT);
    endActivityBlink();
    return;
  }

  // --- RIGHT MOUSE ---
  if (cmdByte == CMD_RCLICK) {
    blinkActivity();
    Mouse.press(MOUSE_RIGHT);
    delay(KEY_HOLD_MS);
    Mouse.release(MOUSE_RIGHT);
    endActivityBlink();
    return;
  }
  if (cmdByte == CMD_RPRESS) {
    blinkActivity();
    Mouse.press(MOUSE_RIGHT);
    anyMouseHeld = true;
    endActivityBlink();
    return;
  }
  if (cmdByte == CMD_RRELEASE) {
    blinkActivity();
    Mouse.release(MOUSE_RIGHT);
    endActivityBlink();
    return;
  }

  // --- MIDDLE MOUSE ---
  if (cmdByte == CMD_MCLICK) {
    blinkActivity();
    Mouse.press(MOUSE_MIDDLE);
    delay(KEY_HOLD_MS);
    Mouse.release(MOUSE_MIDDLE);
    endActivityBlink();
    return;
  }
  if (cmdByte == CMD_MPRESS) {
    blinkActivity();
    Mouse.press(MOUSE_MIDDLE);
    anyMouseHeld = true;
    endActivityBlink();
    return;
  }
  if (cmdByte == CMD_MRELEASE) {
    blinkActivity();
    Mouse.release(MOUSE_MIDDLE);
    endActivityBlink();
    return;
  }

  // --- MOUSE MOVE: [0xF3][dx_hi][dx_lo][dy_hi][dy_lo] ---
  if (cmdByte == CMD_MOUSE_MOVE) {
    if (!waitForBytes(4)) return;
    int16_t dx = (Serial.read() << 8) | Serial.read();
    int16_t dy = (Serial.read() << 8) | Serial.read();
    blinkActivity();
    // Mouse.move only accepts -128 to 127 per call, so split large moves
    while (dx != 0 || dy != 0) {
      int8_t mx = constrain(dx, -127, 127);
      int8_t my = constrain(dy, -127, 127);
      Mouse.move(mx, my);
      dx -= mx;
      dy -= my;
    }
    endActivityBlink();
    return;
  }

  // --- KEY HOLD: [0xF4][vk] ---
  if (cmdByte == CMD_KEY_HOLD) {
    if (!waitForBytes(1)) return;
    byte vk = Serial.read();
    byte hidKey = translateVkToHid(vk);
    blinkActivity();
    Keyboard.press(hidKey);
    anyKeysHeld = true;
    endActivityBlink();
    return;
  }

  // --- KEY RELEASE: [0xF5][vk] ---
  if (cmdByte == CMD_KEY_RELEASE) {
    if (!waitForBytes(1)) return;
    byte vk = Serial.read();
    byte hidKey = translateVkToHid(vk);
    blinkActivity();
    Keyboard.release(hidKey);
    endActivityBlink();
    return;
  }

  // --- KEY TAP (explicit): [0xF6][vk] ---
  if (cmdByte == CMD_KEY_TAP) {
    if (!waitForBytes(1)) return;
    byte vk = Serial.read();
    byte hidKey = translateVkToHid(vk);
    blinkActivity();
    Keyboard.press(hidKey);
    delay(KEY_HOLD_MS);
    Keyboard.release(hidKey);
    endActivityBlink();
    return;
  }

  // --- MOUSE SCROLL: [0xF7][amount][direction] ---
  if (cmdByte == CMD_MOUSE_SCROLL) {
    if (!waitForBytes(2)) return;
    byte amount = Serial.read();
    byte direction = Serial.read();
    blinkActivity();
    switch (direction) {
      case 0x01: Mouse.move(0, 0, amount);   break;  // Scroll up
      case 0x02: Mouse.move(0, 0, -amount);  break;  // Scroll down
      // Horizontal scroll not supported by standard Arduino Mouse library
      case 0x03: break;  // Left (no-op)
      case 0x04: break;  // Right (no-op)
    }
    endActivityBlink();
    return;
  }

  // --- MOUSE CLICK TIMED: [0xF8][button][hold_hi][hold_lo] ---
  if (cmdByte == CMD_MOUSE_CLICK_T) {
    if (!waitForBytes(3)) return;
    byte button = Serial.read();
    uint16_t holdMs = (Serial.read() << 8) | Serial.read();
    blinkActivity();
    pressMouseButton(button);
    delay(holdMs);
    releaseMouseButton(button);
    endActivityBlink();
    return;
  }

  // --- DEFAULT: VK TAP SHORTHAND (0x01–0xBF) —
  // Backward compatible with v2: any VK code sent as the command byte
  // is treated as a key tap (press + hold + release).
  if (cmdByte >= 0x01 && cmdByte <= 0xBF) {
    byte hidKey = translateVkToHid(cmdByte);
    blinkActivity();
    Keyboard.press(hidKey);
    delay(KEY_HOLD_MS);
    Keyboard.release(hidKey);
    endActivityBlink();
    return;
  }

  // Unknown command — blink error
  blinkError();
}

// ============================================================================
// MAIN LOOP
// ============================================================================
void loop() {
  // Timeout: reset state machine if waiting too long for second byte
  if (currentState == WAITING_FOR_COMMAND) {
    if (millis() - lastByteTime > TIMEOUT_MS) {
      currentState = WAITING_FOR_HEADER;
    }
  }

  // WATCHDOG: If no serial data for 500ms and anything is held, release all
  if ((anyKeysHeld || anyMouseHeld) && lastByteTime > 0 &&
      (millis() - lastByteTime > WATCHDOG_MS)) {
    Keyboard.releaseAll();
    Mouse.release(MOUSE_LEFT);
    Mouse.release(MOUSE_RIGHT);
    Mouse.release(MOUSE_MIDDLE);
    anyKeysHeld = false;
    anyMouseHeld = false;
    blinkWatchdog();
  }

  // Process incoming serial data
  if (Serial.available() > 0) {
    byte inByte = Serial.read();
    lastByteTime = millis();

    switch (currentState) {
      case WAITING_FOR_HEADER:
        if (inByte == MAGIC_HEADER) {
          currentState = WAITING_FOR_COMMAND;
        } else {
          blinkError();
        }
        break;

      case WAITING_FOR_COMMAND:
        executeCommand(inByte);
        currentState = WAITING_FOR_HEADER;
        break;
    }
  }
}
