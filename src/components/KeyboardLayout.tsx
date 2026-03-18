/**
 * KeyboardLayout — Interactive QWERTY keyboard for the empty-state panel.
 * Clicking any key creates a new macro with that key pre-set as the trigger.
 * Physical keypresses visually depress the corresponding virtual keys.
 */

import { useEffect, useState, useCallback } from 'react';
import { vkName } from '../hooks/useTauri';

/* ── Windows Virtual-Key codes ── */
const VK = {
  ESC: 0x1B,
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73,
  F5: 0x74, F6: 0x75, F7: 0x76, F8: 0x77,
  F9: 0x78, F10: 0x79, F11: 0x7A, F12: 0x7B,
  BACKTICK: 0xC0, K1: 0x31, K2: 0x32, K3: 0x33, K4: 0x34,
  K5: 0x35, K6: 0x36, K7: 0x37, K8: 0x38, K9: 0x39, K0: 0x30,
  MINUS: 0xBD, EQUALS: 0xBB, BACKSPACE: 0x08,
  TAB: 0x09,
  Q: 0x51, W: 0x57, E: 0x45, R: 0x52, T: 0x54,
  Y: 0x59, U: 0x55, I: 0x49, O: 0x4F, P: 0x50,
  LBRACKET: 0xDB, RBRACKET: 0xDD, BACKSLASH: 0xDC,
  CAPS: 0x14,
  A: 0x41, S: 0x53, D: 0x44, F: 0x46, G: 0x47,
  H: 0x48, J: 0x4A, K: 0x4B, L: 0x4C,
  SEMICOLON: 0xBA, QUOTE: 0xDE, ENTER: 0x0D,
  LSHIFT: 0xA0,
  Z: 0x5A, X: 0x58, C: 0x43, V: 0x56, B: 0x42,
  N: 0x4E, M: 0x4D, COMMA: 0xBC, PERIOD: 0xBE, SLASH: 0xBF,
  RSHIFT: 0xA1,
  LCTRL: 0xA2, LWIN: 0x5B, LALT: 0xA4,
  SPACE: 0x20,
  RALT: 0xA5, RCTRL: 0xA3,
  LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28,
  INSERT: 0x2D, DELETE: 0x2E, HOME: 0x24, END: 0x23,
  PGUP: 0x21, PGDN: 0x22,
  PRTSC: 0x2C, SCRLK: 0x91, PAUSE: 0x13,
} as const;

/**
 * Map browser KeyboardEvent.code → Windows VK code.
 * event.code distinguishes left/right modifiers which keyCode doesn't.
 */
const CODE_TO_VK: Record<string, number> = {
  Escape: VK.ESC,
  F1: VK.F1, F2: VK.F2, F3: VK.F3, F4: VK.F4,
  F5: VK.F5, F6: VK.F6, F7: VK.F7, F8: VK.F8,
  F9: VK.F9, F10: VK.F10, F11: VK.F11, F12: VK.F12,
  Backquote: VK.BACKTICK,
  Digit1: VK.K1, Digit2: VK.K2, Digit3: VK.K3, Digit4: VK.K4,
  Digit5: VK.K5, Digit6: VK.K6, Digit7: VK.K7, Digit8: VK.K8,
  Digit9: VK.K9, Digit0: VK.K0,
  Minus: VK.MINUS, Equal: VK.EQUALS, Backspace: VK.BACKSPACE,
  Tab: VK.TAB,
  KeyQ: VK.Q, KeyW: VK.W, KeyE: VK.E, KeyR: VK.R, KeyT: VK.T,
  KeyY: VK.Y, KeyU: VK.U, KeyI: VK.I, KeyO: VK.O, KeyP: VK.P,
  BracketLeft: VK.LBRACKET, BracketRight: VK.RBRACKET, Backslash: VK.BACKSLASH,
  CapsLock: VK.CAPS,
  KeyA: VK.A, KeyS: VK.S, KeyD: VK.D, KeyF: VK.F, KeyG: VK.G,
  KeyH: VK.H, KeyJ: VK.J, KeyK: VK.K, KeyL: VK.L,
  Semicolon: VK.SEMICOLON, Quote: VK.QUOTE, Enter: VK.ENTER,
  ShiftLeft: VK.LSHIFT, ShiftRight: VK.RSHIFT,
  KeyZ: VK.Z, KeyX: VK.X, KeyC: VK.C, KeyV: VK.V, KeyB: VK.B,
  KeyN: VK.N, KeyM: VK.M,
  Comma: VK.COMMA, Period: VK.PERIOD, Slash: VK.SLASH,
  ControlLeft: VK.LCTRL, ControlRight: VK.RCTRL,
  MetaLeft: VK.LWIN, MetaRight: VK.LWIN,
  AltLeft: VK.LALT, AltRight: VK.RALT,
  Space: VK.SPACE,
  ArrowLeft: VK.LEFT, ArrowUp: VK.UP, ArrowRight: VK.RIGHT, ArrowDown: VK.DOWN,
  Insert: VK.INSERT, Delete: VK.DELETE, Home: VK.HOME, End: VK.END,
  PageUp: VK.PGUP, PageDown: VK.PGDN,
  PrintScreen: VK.PRTSC, ScrollLock: VK.SCRLK, Pause: VK.PAUSE,
};

/** Key definition: VK code + unit width (1u = standard key) */
interface KeyDef {
  vk: number;
  w?: number;  // width in units, default 1
}

/** Keyboard rows */
const ROWS: KeyDef[][] = [
  // Function row
  [
    { vk: VK.ESC },
    { vk: VK.F1 }, { vk: VK.F2 }, { vk: VK.F3 }, { vk: VK.F4 },
    { vk: VK.F5 }, { vk: VK.F6 }, { vk: VK.F7 }, { vk: VK.F8 },
    { vk: VK.F9 }, { vk: VK.F10 }, { vk: VK.F11 }, { vk: VK.F12 },
    { vk: VK.PRTSC }, { vk: VK.SCRLK }, { vk: VK.PAUSE },
  ],
  // Number row
  [
    { vk: VK.BACKTICK }, { vk: VK.K1 }, { vk: VK.K2 }, { vk: VK.K3 },
    { vk: VK.K4 }, { vk: VK.K5 }, { vk: VK.K6 }, { vk: VK.K7 },
    { vk: VK.K8 }, { vk: VK.K9 }, { vk: VK.K0 },
    { vk: VK.MINUS }, { vk: VK.EQUALS },
    { vk: VK.BACKSPACE, w: 2 },
  ],
  // QWERTY row
  [
    { vk: VK.TAB, w: 1.5 },
    { vk: VK.Q }, { vk: VK.W }, { vk: VK.E }, { vk: VK.R }, { vk: VK.T },
    { vk: VK.Y }, { vk: VK.U }, { vk: VK.I }, { vk: VK.O }, { vk: VK.P },
    { vk: VK.LBRACKET }, { vk: VK.RBRACKET },
    { vk: VK.BACKSLASH, w: 1.5 },
  ],
  // Home row
  [
    { vk: VK.CAPS, w: 1.75 },
    { vk: VK.A }, { vk: VK.S }, { vk: VK.D }, { vk: VK.F }, { vk: VK.G },
    { vk: VK.H }, { vk: VK.J }, { vk: VK.K }, { vk: VK.L },
    { vk: VK.SEMICOLON }, { vk: VK.QUOTE },
    { vk: VK.ENTER, w: 2.25 },
  ],
  // Bottom row
  [
    { vk: VK.LSHIFT, w: 2.25 },
    { vk: VK.Z }, { vk: VK.X }, { vk: VK.C }, { vk: VK.V }, { vk: VK.B },
    { vk: VK.N }, { vk: VK.M },
    { vk: VK.COMMA }, { vk: VK.PERIOD }, { vk: VK.SLASH },
    { vk: VK.RSHIFT, w: 2.75 },
  ],
  // Space row
  [
    { vk: VK.LCTRL, w: 1.5 },
    { vk: VK.LWIN, w: 1.25 },
    { vk: VK.LALT, w: 1.25 },
    { vk: VK.SPACE, w: 6.25 },
    { vk: VK.RALT, w: 1.25 },
    { vk: VK.RCTRL, w: 1.5 },
    { vk: VK.LEFT }, { vk: VK.UP }, { vk: VK.DOWN }, { vk: VK.RIGHT },
  ],
];

/** Abbreviated labels for keys whose vkName is too long for a 1u cap */
const SHORT_LABELS: Record<number, string> = {
  [VK.ESC]: 'Esc',
  [VK.BACKSPACE]: 'Bksp',
  [VK.TAB]: 'Tab',
  [VK.CAPS]: 'Caps',
  [VK.ENTER]: 'Enter',
  [VK.LSHIFT]: 'Shift',
  [VK.RSHIFT]: 'Shift',
  [VK.LCTRL]: 'Ctrl',
  [VK.RCTRL]: 'Ctrl',
  [VK.LALT]: 'Alt',
  [VK.RALT]: 'Alt',
  [VK.LWIN]: 'Win',
  [VK.SPACE]: 'Space',
  [VK.INSERT]: 'Ins',
  [VK.DELETE]: 'Del',
  [VK.HOME]: 'Home',
  [VK.END]: 'End',
  [VK.PGUP]: 'PgUp',
  [VK.PGDN]: 'PgDn',
  [VK.PRTSC]: 'PrtSc',
  [VK.SCRLK]: 'ScrLk',
  [VK.PAUSE]: 'Pause',
  [VK.LEFT]: '\u2190',
  [VK.RIGHT]: '\u2192',
  [VK.UP]: '\u2191',
  [VK.DOWN]: '\u2193',
  [VK.BACKTICK]: '`',
  [VK.MINUS]: '\u2212',
  [VK.EQUALS]: '=',
  [VK.LBRACKET]: '[',
  [VK.RBRACKET]: ']',
  [VK.BACKSLASH]: '\\',
  [VK.SEMICOLON]: ';',
  [VK.QUOTE]: "'",
  [VK.COMMA]: ',',
  [VK.PERIOD]: '.',
  [VK.SLASH]: '/',
};

/** Single interactive key button */
function KeyButton({ vk, width, pressed, onClick }: {
  vk: number;
  width: number;
  pressed: boolean;
  onClick: (vk: number, label: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [hover, setHover] = useState(false);

  useEffect(() => {
    // Use short label if available, otherwise resolve via backend
    if (SHORT_LABELS[vk] !== undefined) {
      setLabel(SHORT_LABELS[vk]);
      return;
    }
    vkName(vk).then(setLabel).catch(() => setLabel(`0x${vk.toString(16).toUpperCase()}`));
  }, [vk]);

  // 1u = 2.571rem (matches keycap height)
  const unit = 2.571;
  const isActive = pressed || hover;

  return (
    <button
      onClick={() => onClick(vk, label)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="keycap"
      style={{
        width: `${width * unit}rem`,
        height: `${unit}rem`,
        cursor: 'pointer',
        fontSize: width > 2 ? '0.714rem' : '0.786rem',
        transition: 'all 80ms ease',
        transform: pressed
          ? 'translateY(1px)'
          : hover ? 'translateY(-1px)' : undefined,
        boxShadow: pressed
          ? 'rgba(0, 0, 0, 0.5) 0px 0px 0px 1px, rgba(0, 0, 0, 0.3) 0px 1px 1px 0.5px inset, rgba(255, 255, 255, 0.1) 0px 1px 1px 0.5px inset'
          : hover
            ? 'rgba(45, 212, 191, 0.15) 0px 0px 12px 2px, rgba(0, 0, 0, 0.4) 0px 2px 0px 1.5px, rgb(0, 0, 0) 0px 0px 0.5px 0.5px, rgba(0, 0, 0, 0.25) 0px 1px 1px 0.5px inset, rgba(255, 255, 255, 0.2) 0px 1px 1px 0.5px inset'
            : undefined,
        borderColor: isActive ? 'rgba(45, 212, 191, 0.2)' : undefined,
        background: pressed ? 'rgba(45, 212, 191, 0.08)' : undefined,
        padding: 0,
        margin: 0,
        flexShrink: 0,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {label}
    </button>
  );
}

interface KeyboardLayoutProps {
  onKeySelect: (vk: number, label: string) => void;
}

export function KeyboardLayout({ onKeySelect }: KeyboardLayoutProps) {
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set());

  // Listen for physical key presses/releases
  useEffect(() => {
    const handleDown = (e: KeyboardEvent) => {
      const vk = CODE_TO_VK[e.code];
      if (vk !== undefined) {
        e.preventDefault();
        setPressedKeys(prev => {
          if (prev.has(vk)) return prev;
          const next = new Set(prev);
          next.add(vk);
          return next;
        });
      }
    };
    const handleUp = (e: KeyboardEvent) => {
      const vk = CODE_TO_VK[e.code];
      if (vk !== undefined) {
        setPressedKeys(prev => {
          if (!prev.has(vk)) return prev;
          const next = new Set(prev);
          next.delete(vk);
          return next;
        });
      }
    };
    // Clear all keys when window loses focus (prevents stuck keys)
    const handleBlur = () => setPressedKeys(new Set());

    window.addEventListener('keydown', handleDown);
    window.addEventListener('keyup', handleUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleDown);
      window.removeEventListener('keyup', handleUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const handleClick = useCallback((vk: number, label: string) => {
    onKeySelect(vk, label);
  }, [onKeySelect]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      minHeight: '100%',
      gap: '1.5rem',
      userSelect: 'none',
    }}>
      {/* Keyboard container */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.286rem',
        padding: '1.143rem',
      }}>
        {ROWS.map((row, ri) => (
          <div key={ri} style={{
            display: 'flex',
            gap: '0.286rem',
            justifyContent: 'center',
          }}>
            {row.map((key) => (
              <KeyButton
                key={key.vk}
                vk={key.vk}
                width={key.w ?? 1}
                pressed={pressedKeys.has(key.vk)}
                onClick={handleClick}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Hint */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.429rem',
      }}>
        <div style={{
          fontSize: '0.929rem',
          color: 'var(--text-secondary)',
          fontWeight: 500,
        }}>
          Click any key to create a macro
        </div>
        <div style={{
          fontSize: '0.786rem',
          color: 'var(--text-tertiary)',
        }}>
          The selected key will be set as the trigger
        </div>
      </div>
    </div>
  );
}
