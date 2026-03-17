/** BindSetter — Unified keybind capture (keyboard + mouse + gamepad) */

import { useState, useEffect, useCallback } from 'react';
import { vkName } from '../hooks/useTauri';
import { GAMEPAD_BUTTONS, MOUSE_BUTTONS } from '../types/config';
import { Button } from './primitives/Button';
import { Popover, PopoverContent, PopoverTrigger } from './primitives/Popover';
import { ChevronDown } from 'lucide-react';

interface BindSetterProps {
  onCapture: (keys: number[]) => void;
  hasKeys?: boolean;
  autoStart?: boolean;
  onCancel?: () => void;
}

const MOUSE_VK_MAP: Record<number, number> = {
  0: 0x01, 1: 0x04, 2: 0x02, 3: 0x05, 4: 0x06,
};

export function HotkeyRecorder({ onCapture, hasKeys, autoStart, onCancel }: BindSetterProps) {
  const [listening, setListening] = useState(autoStart ?? false);
  const [displayNames, setDisplayNames] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    if (autoStart) setListening(true);
  }, [autoStart]);

  useEffect(() => {
    if (!listening) return;

    const held = new Set<number>();
    let maxCombo: number[] = [];

    const resolve = async (combo: number[]) => {
      const names = await Promise.all(
        combo.map(async (k) => {
          try { return await vkName(k); }
          catch { return `0x${k.toString(16)}`; }
        })
      );
      setDisplayNames(names);
    };

    const addKey = (vk: number) => {
      held.add(vk);
      const combo = [...held];
      if (combo.length >= maxCombo.length) {
        maxCombo = combo;
        resolve(maxCombo);
      }
    };

    const finalize = (vk: number) => {
      held.delete(vk);
      if (held.size === 0 && maxCombo.length > 0) {
        onCapture(maxCombo);
        setListening(false);
        setDisplayNames([]);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); const vk = domKeyToVk(e.code); if (vk !== null) addKey(vk); };
    const onKeyUp = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); const vk = domKeyToVk(e.code); if (vk !== null) finalize(vk); };
    const onMouseDown = (e: MouseEvent) => { const t = e.target as HTMLElement; if (t.closest('[data-bind-cancel]')) return; e.preventDefault(); e.stopPropagation(); const vk = MOUSE_VK_MAP[e.button]; if (vk) addKey(vk); };
    const onMouseUp = (e: MouseEvent) => { const t = e.target as HTMLElement; if (t.closest('[data-bind-cancel]')) return; e.preventDefault(); e.stopPropagation(); const vk = MOUSE_VK_MAP[e.button]; if (vk) finalize(vk); };
    const blockContext = (e: MouseEvent) => { e.preventDefault(); };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('mouseup', onMouseUp, { capture: true });
    window.addEventListener('contextmenu', blockContext, { capture: true });

    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('mousedown', onMouseDown, { capture: true });
      window.removeEventListener('mouseup', onMouseUp, { capture: true });
      window.removeEventListener('contextmenu', blockContext, { capture: true });
    };
  }, [listening, onCapture]);

  useEffect(() => {
    if (!listening) return;
    const cancel = () => { setListening(false); setDisplayNames([]); };
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, [listening]);

  const selectFromDropdown = useCallback((vk: number) => {
    onCapture([vk]);
    setShowDropdown(false);
  }, [onCapture]);

  // ── Recording state ──
  if (listening) {
    return (
      <div className="capture-zone active" style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
        width: '100%',
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: 'rgb(210, 153, 34)',
          animation: 'pulse-dot 1.2s ease-in-out infinite',
        }} />
        {displayNames.length > 0
          ? <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>{displayNames.join(' + ')}</span>
          : <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Press any key, click, or gamepad button…</span>
        }
        <Button data-bind-cancel variant="ghost" size="xs" onClick={() => { setListening(false); setDisplayNames([]); onCancel?.(); }}
          style={{ marginLeft: 'auto', fontSize: 10 }}>Cancel</Button>
      </div>
    );
  }

  // ── Idle state: no keys ──
  if (!hasKeys) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          className="capture-zone"
          onClick={() => setListening(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 12,
            width: '100%',
          }}
        >
          Press to record a key…
        </button>
        <Popover open={showDropdown} onOpenChange={setShowDropdown}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" title="Browse all keys" style={{ height: 28, width: 28, color: 'var(--text-tertiary)', flexShrink: 0 }}>
              <ChevronDown size={12} />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" style={{ width: 280, maxHeight: 320, overflowY: 'auto', padding: 12 }}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6 }}>Mouse</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                {MOUSE_BUTTONS.map(btn => (
                  <Button key={btn.vk} variant="ghost" size="xs" onClick={() => selectFromDropdown(btn.vk)}
                    style={{ height: 28, fontSize: 10, justifyContent: 'flex-start' }}>{btn.label}</Button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6 }}>Gamepad</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                {GAMEPAD_BUTTONS.map(btn => (
                  <Button key={btn.vk} variant="ghost" size="xs" onClick={() => selectFromDropdown(btn.vk)}
                    style={{ height: 28, fontSize: 10, justifyContent: 'flex-start', gap: 6 }}>
                    <img src={`/gamepad/${btn.img}`} alt={btn.name} style={{ width: 16, height: 16 }} />
                    {btn.name}
                  </Button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  // ── Idle state: has keys ──
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        onClick={() => setListening(true)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: 11, color: 'var(--text-tertiary)', padding: '2px 0',
          transition: 'color 120ms',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
      >
        Change
      </button>
      <Popover open={showDropdown} onOpenChange={setShowDropdown}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-xs" title="Browse all keys" style={{ color: 'var(--text-tertiary)' }}>
            <ChevronDown size={10} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" style={{ width: 280, maxHeight: 320, overflowY: 'auto', padding: 12 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6 }}>Mouse</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
              {MOUSE_BUTTONS.map(btn => (
                <Button key={btn.vk} variant="ghost" size="xs" onClick={() => selectFromDropdown(btn.vk)}
                  style={{ height: 28, fontSize: 10, justifyContent: 'flex-start' }}>{btn.label}</Button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6 }}>Gamepad</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
              {GAMEPAD_BUTTONS.map(btn => (
                <Button key={btn.vk} variant="ghost" size="xs" onClick={() => selectFromDropdown(btn.vk)}
                  style={{ height: 28, fontSize: 10, justifyContent: 'flex-start', gap: 6 }}>
                  <img src={`/gamepad/${btn.img}`} alt={btn.name} style={{ width: 16, height: 16 }} />
                  {btn.name}
                </Button>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export { HotkeyRecorder as BindSetter };

function domKeyToVk(code: string): number | null {
  const letterMatch = code.match(/^Key([A-Z])$/);
  if (letterMatch) return letterMatch[1].charCodeAt(0);
  const digitMatch = code.match(/^Digit(\d)$/);
  if (digitMatch) return 0x30 + parseInt(digitMatch[1]);
  const numpadMatch = code.match(/^Numpad(\d)$/);
  if (numpadMatch) return 0x60 + parseInt(numpadMatch[1]);
  const fMatch = code.match(/^F(\d+)$/);
  if (fMatch) return 0x6F + parseInt(fMatch[1]);

  const map: Record<string, number> = {
    Space: 0x20, Enter: 0x0D, Escape: 0x1B, Tab: 0x09,
    Backspace: 0x08, Delete: 0x2E, Insert: 0x2D,
    Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22,
    ArrowUp: 0x26, ArrowDown: 0x28, ArrowLeft: 0x25, ArrowRight: 0x27,
    ShiftLeft: 0xA0, ShiftRight: 0xA1,
    ControlLeft: 0xA2, ControlRight: 0xA3,
    AltLeft: 0xA4, AltRight: 0xA5,
    MetaLeft: 0x5B, MetaRight: 0x5C,
    CapsLock: 0x14, NumLock: 0x90, ScrollLock: 0x91,
    Semicolon: 0xBA, Equal: 0xBB, Comma: 0xBC,
    Minus: 0xBD, Period: 0xBE, Slash: 0xBF,
    Backquote: 0xC0, BracketLeft: 0xDB, Backslash: 0xDC,
    BracketRight: 0xDD, Quote: 0xDE,
    NumpadMultiply: 0x6A, NumpadAdd: 0x6B,
    NumpadSubtract: 0x6D, NumpadDecimal: 0x6E, NumpadDivide: 0x6F,
    NumpadEnter: 0x0D, PrintScreen: 0x2C, Pause: 0x13,
  };
  return map[code] ?? null;
}
