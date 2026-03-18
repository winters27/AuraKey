/** PromptDialog — Frosted-glass modal for naming prompts */

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
        background: 'rgba(7, 8, 10, 0.2)',
        backdropFilter: 'blur(12px)',
        animation: 'fade-in 150ms ease',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'linear-gradient(160deg, rgba(16, 17, 22, 0.95) 0%, rgba(10, 11, 15, 0.98) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '0.857rem',
          padding: '1.714rem',
          width: '24rem',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.03) inset, 0 0 80px rgba(45, 212, 191, 0.03)',
          animation: 'slide-up 200ms var(--ease-out)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          fontSize: '1.071rem',
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: '1.143rem',
          letterSpacing: '-0.01em',
        }}>
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
          style={{
            marginBottom: '1.143rem',
            height: '2.571rem',
            fontSize: '0.929rem',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.571rem' }}>
          <Button variant="ghost" size="sm" onClick={onCancel} style={{ fontSize: '0.857rem' }}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} style={{ fontSize: '0.857rem' }}
            disabled={!value.trim()}>
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
