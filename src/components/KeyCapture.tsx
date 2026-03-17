/** KeyCapture — Press-a-key binding widget */

import { useState, useEffect, useRef } from 'react';
import { vkName } from '../hooks/useTauri';
import { Button } from './primitives/Button';
import { HotkeyRecorder } from './HotkeyRecorder';

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

  if (listening) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {label && <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</label>}
        <HotkeyRecorder
          autoStart
          onCapture={(keys) => {
            if (keys.length > 0) onChange(keys[keys.length - 1]);
            setListening(false);
          }}
          onCancel={() => setListening(false)}
        />
      </div>
    );
  }

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
          background: 'radial-gradient(75% 75% at 50% 92%, rgb(18, 18, 18) 0px, rgb(13, 13, 13) 100%)',
          border: 'none',
          color: 'rgb(255, 255, 255)',
          borderRadius: 6,
          boxShadow:
            'rgba(0,0,0,0.4) 0px 1px 0px 1.5px, rgb(0,0,0) 0px 0px 0.5px 0.5px, rgba(0,0,0,0.25) 0px 1px 1px 0.5px inset, rgba(255,255,255,0.2) 0px 1px 1px 0.5px inset',
          textShadow: 'rgba(0,0,0,0.1) 0px 0.5px 0.5px',
        }}
      >
        {displayName}
      </Button>
    </div>
  );
}
