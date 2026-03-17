/** PromptDialog — Themed modal replacement for window.prompt() */

import { useState, useEffect, useRef } from 'react';
import { Button } from './Button';
import { Input } from './Input';

interface PromptDialogProps {
  open: boolean;
  title: string;
  placeholder?: string;
  defaultValue?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({ open, title, placeholder, defaultValue = '', onConfirm, onCancel }: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, defaultValue]);

  if (!open) return null;

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        animation: 'fade-in 150ms ease',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-highlight)',
          borderRadius: 12,
          padding: '20px 24px',
          width: 340,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
          animation: 'slide-up 200ms var(--ease-out)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 14 }}>
          {title}
        </div>
        <Input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={placeholder}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onCancel();
          }}
          style={{ marginBottom: 16, height: 36, fontSize: 13 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={onCancel} style={{ fontSize: 12 }}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} style={{ fontSize: 12 }}
            disabled={!value.trim()}>
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
