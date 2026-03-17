/** TitleBar — Custom frameless window title bar */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';

const appWindow = getCurrentWindow();

export function TitleBar() {
  return (
    <div
      style={{
        gridColumn: '1 / -1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-sidebar)',
        borderBottom: '1px solid var(--border)',
        userSelect: 'none',
      }}
      data-tauri-drag-region
    >
      {/* Branding */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px' }}>
        <img src="/aura-logo.png" alt="AuraKey" style={{ width: 16, height: 16, opacity: 0.8 }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>AuraKey</span>
        <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>v0.1.0</span>
      </div>

      {/* Window Controls */}
      <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <WindowButton onClick={() => appWindow.minimize()}>
          <Minus size={14} />
        </WindowButton>
        <WindowButton onClick={() => appWindow.toggleMaximize()}>
          <Square size={12} />
        </WindowButton>
        <WindowButton onClick={() => appWindow.close()} isClose>
          <X size={14} />
        </WindowButton>
      </div>
    </div>
  );
}

function WindowButton({ children, onClick, isClose }: {
  children: React.ReactNode;
  onClick: () => void;
  isClose?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 46,
        height: '100%',
        background: 'transparent',
        border: 'none',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'background-color 100ms, color 100ms',
      }}
      onMouseEnter={(e) => {
        if (isClose) {
          e.currentTarget.style.background = '#c42b1c';
          e.currentTarget.style.color = 'white';
        } else {
          e.currentTarget.style.background = 'var(--bg-surface-hover)';
          e.currentTarget.style.color = 'var(--text-primary)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--text-secondary)';
      }}
    >
      {children}
    </button>
  );
}
