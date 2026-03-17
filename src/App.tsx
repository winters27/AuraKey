/** AuraKey — Main Application Shell */

import { useEffect, useState, useCallback } from 'react';
import type { AppConfig, MacroSelection } from './types/config';
import { getConfig, togglePause, cancelAll } from './hooks/useTauri';
import { TitleBar } from './components/TitleBar';
import { MacroList } from './components/MacroList';
import { MacroEditor } from './components/MacroEditor';
import { SettingsPanel } from './components/SettingsPanel';
import { Button } from './components/primitives/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/primitives/Select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/primitives/DropdownMenu';
import { Settings, Ellipsis, Plus, Pencil, Trash2, StopCircle, Play } from 'lucide-react';
import './index.css';

type RightPanel = 'editor' | 'settings' | 'none';

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [selection, setSelection] = useState<MacroSelection | null>(null);
  const [panel, setPanel] = useState<RightPanel>('none');
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getConfig()
      .then(c => {
        setConfig(c);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load config:', err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!config) return;
    const theme = config.settings.theme;

    const applyTheme = (resolved: 'dark' | 'light') => {
      document.documentElement.setAttribute('data-theme', resolved);
    };

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mq.matches ? 'dark' : 'light');
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } else {
      applyTheme(theme);
    }
  }, [config?.settings.theme]);

  const handleConfigUpdate = useCallback((newConfig: AppConfig) => {
    setConfig(newConfig);
  }, []);

  const handleSelect = useCallback((sel: MacroSelection) => {
    setSelection(sel);
    setPanel('editor');
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelection(null);
    setPanel('none');
  }, []);

  const handleTogglePause = async () => {
    const nowPaused = await togglePause();
    setPaused(nowPaused);
    if (nowPaused) await cancelAll();
  };

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', background: 'var(--bg-base)' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  if (!config) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', background: 'var(--bg-base)' }}>
        <div style={{ color: 'var(--error)', fontSize: 14 }}>Failed to load configuration</div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '280px 1fr',
      gridTemplateRows: '40px 40px 1fr 28px',
      height: '100vh',
    }}>
      {/* ── Title Bar ── */}
      <TitleBar />

      {/* ── Controls Bar ── */}
      <div style={{
        gridColumn: '1 / -1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Select
            value={config.active_profile}
            onValueChange={async (val) => {
              const { setActiveProfile } = await import('./hooks/useTauri');
              await setActiveProfile(val);
              const updated = await getConfig();
              handleConfigUpdate(updated);
            }}
          >
            <SelectTrigger style={{ height: 28, width: 180, fontSize: 12 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {config.profiles.map(p => (
                <SelectItem key={p.name} value={p.name} style={{ fontSize: 12 }}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" style={{ height: 28, width: 28, color: 'var(--text-secondary)' }}>
                <Ellipsis size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" style={{ minWidth: 160 }}>
              <DropdownMenuItem style={{ fontSize: 12, gap: 8 }} onSelect={async () => {
                const name = prompt('New profile name:');
                if (!name?.trim()) return;
                try {
                  const { createProfile } = await import('./hooks/useTauri');
                  const updated = await createProfile(name.trim());
                  handleConfigUpdate(updated);
                  setSelection(null);
                } catch (e: any) { alert(e); }
              }}>
                <Plus size={12} /> New Profile
              </DropdownMenuItem>
              <DropdownMenuItem style={{ fontSize: 12, gap: 8 }} onSelect={async () => {
                const newName = prompt('Rename profile:', config.active_profile);
                if (!newName?.trim() || newName.trim() === config.active_profile) return;
                try {
                  const { renameProfile } = await import('./hooks/useTauri');
                  const updated = await renameProfile(config.active_profile, newName.trim());
                  handleConfigUpdate(updated);
                } catch (e: any) { alert(e); }
              }}>
                <Pencil size={12} /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                style={{ fontSize: 12, gap: 8, color: 'var(--error)' }}
                disabled={config.profiles.length <= 1}
                onSelect={async () => {
                  if (!confirm(`Delete profile "${config.active_profile}"?`)) return;
                  try {
                    const { deleteProfile } = await import('./hooks/useTauri');
                    const updated = await deleteProfile(config.active_profile);
                    handleConfigUpdate(updated);
                    setSelection(null);
                  } catch (e: any) { alert(e); }
                }}
              >
                <Trash2 size={12} /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTogglePause}
            title={paused ? 'Resume macro daemon' : 'Pause daemon & cancel running macros'}
            style={{
              fontSize: 12,
              gap: 4,
              color: paused ? 'var(--success)' : 'var(--error)',
            }}
          >
            {paused
              ? <><Play size={12} /> Start</>
              : <><StopCircle size={12} /> Stop</>}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
            style={{ height: 28, width: 28, color: 'var(--text-secondary)' }}
          >
            <Settings size={14} />
          </Button>
        </div>
      </div>

      {/* ── Sidebar ── */}
      <MacroList
        config={config}
        selection={selection}
        onSelect={handleSelect}
        onConfigUpdate={handleConfigUpdate}
      />

      {/* ── Main Panel ── */}
      <div style={{
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: 24,
        background: 'var(--bg-base)',
        position: 'relative',
      }}>
        {/* Dot grid — main panel only */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, transparent 30%, black 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, transparent 30%, black 100%)',
          pointerEvents: 'none',
          zIndex: 0,
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
        {panel === 'editor' && selection && (
          <MacroEditor
            config={config}
            selection={selection}
            onConfigUpdate={handleConfigUpdate}
            onClearSelection={handleClearSelection}
          />
        )}

        {panel === 'settings' && (
          <SettingsPanel
            config={config}
            onConfigUpdate={handleConfigUpdate}
          />
        )}

        {panel === 'none' && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 16,
            color: 'var(--text-tertiary)',
          }}>
            <div style={{ fontSize: 30, opacity: 0.2 }}>⌨</div>
            <div style={{ fontSize: 13 }}>Select a macro to edit</div>
            <div style={{ fontSize: 11, opacity: 0.6 }}>
              Or create a new one with the + button in the sidebar
            </div>
          </div>
        )}
        </div>
      </div>

      {/* ── Status Bar ── */}
      <div style={{
        gridColumn: '1 / -1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
        fontSize: 11,
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: paused ? 'var(--warning)' : 'var(--success)',
          }} />
          <span>{paused ? 'Paused' : 'Active'}</span>
        </div>
        <div>
          {config.active_profile} · {
            config.profiles
              .find(p => p.name === config.active_profile)
              ?.groups.reduce((sum, g) => sum + g.macros.length, 0) ?? 0
          } macros
        </div>
      </div>
    </div>
  );
}
