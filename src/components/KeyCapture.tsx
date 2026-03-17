/** KeyCapture — Press-a-key binding widget */

import { useState, useEffect, useRef } from 'react';
import { vkName } from '../hooks/useTauri';
import { Button } from './primitives/Button';

interface KeyCaptureProps {
  vk: number;
  onChange: (vk: number) => void;
  label?: string;
}

export function KeyCapture({ vk, onChange, label }: KeyCaptureProps) {
  const [listening, setListening] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (vk === 0) { setDisplayName('None'); return; }
    vkName(vk).then(setDisplayName).catch(() => setDisplayName(`Key ${vk}`));
  }, [vk]);

  useEffect(() => {
    if (!listening) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      const mapped = domKeyToVk(e.code, e.key);
      if (mapped !== null) onChange(mapped);
      setListening(false);
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [listening, onChange]);

  useEffect(() => {
    if (!listening) return;
    const cancel = () => setListening(false);
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, [listening]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</label>}
      <Button
        ref={btnRef}
        variant="ghost"
        size="sm"
        onClick={() => setListening(true)}
        style={{
          height: 28, fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
          minWidth: 32, padding: '0 8px',
          ...(listening
            ? {
                background: 'var(--accent-muted)',
                border: '1px solid var(--accent)',
                color: 'var(--accent)',
                boxShadow: '0 0 0 3px var(--accent-muted)',
              }
            : {
                background: 'radial-gradient(75% 75% at 50% 92%, rgb(18, 18, 18) 0px, rgb(13, 13, 13) 100%)',
                border: 'none',
                color: 'rgb(255, 255, 255)',
                borderRadius: 6,
                boxShadow:
                  'rgba(0,0,0,0.4) 0px 1px 0px 1.5px, rgb(0,0,0) 0px 0px 0.5px 0.5px, rgba(0,0,0,0.25) 0px 1px 1px 0.5px inset, rgba(255,255,255,0.2) 0px 1px 1px 0.5px inset',
                textShadow: 'rgba(0,0,0,0.1) 0px 0.5px 0.5px',
              }
          ),
        }}
      >
        {listening ? '⌨ Press a key…' : displayName}
      </Button>
    </div>
  );
}

function domKeyToVk(code: string, _key: string): number | null {
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
