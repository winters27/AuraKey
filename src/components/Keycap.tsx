/** Keycap — Flat neutral key badge */

import { useEffect, useState } from 'react';
import { vkName } from '../hooks/useTauri';

interface KeycapProps {
  vk: number;
  size?: 'sm' | 'lg';
}

export function Keycap({ vk, size }: KeycapProps) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (vk === 0) { setLabel('None'); return; }
    vkName(vk).then(setLabel).catch(() => setLabel(`0x${vk.toString(16).toUpperCase()}`));
  }, [vk]);

  return <span className={`keycap${size ? ` keycap--${size}` : ''}`}>{label}</span>;
}

/** Row of keycaps, joined by + */
export function KeycapRow({ keys }: { keys: number[] }) {
  if (!keys || keys.length === 0) {
    return <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>—</span>;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {keys.map((vk, i) => (
        <span key={`${vk}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          {i > 0 && <span style={{ fontSize: 10, color: 'var(--text-tertiary)', margin: '0 2px' }}>+</span>}
          <Keycap vk={vk} />
        </span>
      ))}
    </span>
  );
}
