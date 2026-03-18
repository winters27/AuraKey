/** TitleBar — Custom frameless window title bar */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './primitives/Tooltip';

const appWindow = getCurrentWindow();

export function TitleBar({ children, onLogoClick }: { children?: React.ReactNode; onLogoClick?: () => void }) {
  return (
    <div
      style={{
        gridColumn: '1 / -1',
        display: 'flex',
        alignItems: 'center',
        background: 'var(--bg-sidebar)',
        borderBottom: '1px solid var(--border)',
        userSelect: 'none',
      }}
    >
      {/* Branding */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 0.857rem', flexShrink: 0 }} data-tauri-drag-region>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <img
                src="/aura-logo.png"
                alt="AuraKey"
                onClick={onLogoClick}
                style={{
                  width: '1.286rem', height: '1.286rem',
                  opacity: 0.8,
                  cursor: onLogoClick ? 'pointer' : 'default',
                  transition: 'opacity 150ms ease',
                }}
                onMouseEnter={e => { if (onLogoClick) e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '0.8'; }}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span style={{ fontWeight: 600 }}>AuraKey</span>
              <span style={{ opacity: 0.5, marginLeft: '0.429rem', fontFamily: 'var(--font-mono)', fontSize: '0.714rem' }}>v0.1.0</span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Embedded Controls */}
      {children ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.571rem', minWidth: 0 }} data-tauri-drag-region>
          {children}
        </div>
      ) : (
        <div style={{ flex: 1, alignSelf: 'stretch' }} data-tauri-drag-region />
      )}

      {/* Window Controls */}
      <div style={{ display: 'flex', alignItems: 'center', height: '100%', flexShrink: 0 }}>
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
        width: '3.286rem',
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
