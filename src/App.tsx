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
import { PromptDialog } from './components/primitives/PromptDialog';
import { Settings, Ellipsis, Plus, Pencil, Trash2, Import, Upload } from 'lucide-react';
import './index.css';

type RightPanel = 'editor' | 'settings' | 'none';

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [selection, setSelection] = useState<MacroSelection | null>(null);
  const [panel, setPanel] = useState<RightPanel>('none');
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptTitle, setPromptTitle] = useState('');
  const [promptPlaceholder, setPromptPlaceholder] = useState('');
  const [promptDefault, setPromptDefault] = useState('');
  const [promptCallback, setPromptCallback] = useState<((v: string) => void) | null>(null);

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

  // Disable default browser context menu globally
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // Allow default context menu on text inputs for copy/paste
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
    };
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  // Disable dev tools shortcuts (F12, Ctrl+Shift+I, Ctrl+Shift+J)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F12') { e.preventDefault(); return; }
      if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j')) { e.preventDefault(); return; }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
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
      gridTemplateRows: '40px 1fr 28px',
      height: '100vh',
    }}>
      {/* ── Title Bar (with embedded controls) ── */}
      <TitleBar>
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
              <Button variant="ghost" size="icon" style={{ height: 28, width: 28, color: 'var(--text-secondary)', cursor: 'pointer' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
              >                <Ellipsis size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" style={{ minWidth: 160 }}>
              <DropdownMenuItem style={{ fontSize: 12, gap: 8 }} onSelect={() => {
                setPromptTitle('New Profile');
                setPromptPlaceholder('Profile name');
                setPromptDefault('');
                setPromptCallback(() => async (name: string) => {
                  try {
                    const { createProfile } = await import('./hooks/useTauri');
                    const updated = await createProfile(name);
                    handleConfigUpdate(updated);
                    setSelection(null);
                  } catch (e: any) { alert(e); }
                  setPromptOpen(false);
                });
                setPromptOpen(true);
              }}>
                <Plus size={12} /> New Profile
              </DropdownMenuItem>
              <DropdownMenuItem style={{ fontSize: 12, gap: 8 }} onSelect={() => {
                setPromptTitle('Rename Profile');
                setPromptPlaceholder('Profile name');
                setPromptDefault(config.active_profile);
                setPromptCallback(() => async (newName: string) => {
                  if (newName === config.active_profile) { setPromptOpen(false); return; }
                  try {
                    const { renameProfile } = await import('./hooks/useTauri');
                    const updated = await renameProfile(config.active_profile, newName);
                    handleConfigUpdate(updated);
                  } catch (e: any) { alert(e); }
                  setPromptOpen(false);
                });
                setPromptOpen(true);
              }}>
                <Pencil size={12} /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem style={{ fontSize: 12, gap: 8 }} onSelect={async () => {
                const { open } = await import('@tauri-apps/plugin-dialog');
                const { importMacros } = await import('./hooks/useTauri');
                const file = await open({
                  title: 'Import Profile / Macros',
                  filters: [{ name: 'AuraKey Files', extensions: ['akg', 'toml', 'json'] }],
                  multiple: false,
                });
                if (!file) return;
                try {
                  const updated = await importMacros(file, 0);
                  handleConfigUpdate(updated);
                } catch (e: any) { alert(`Import failed: ${e}`); }
              }}>
                <Import size={12} /> Import
              </DropdownMenuItem>
              <DropdownMenuItem style={{ fontSize: 12, gap: 8 }} onSelect={async () => {
                const { save } = await import('@tauri-apps/plugin-dialog');
                const { exportProfile } = await import('./hooks/useTauri');
                const file = await save({
                  title: 'Export Profile',
                  defaultPath: `${config.active_profile}.akg`,
                  filters: [{ name: 'AuraKey Profile', extensions: ['akg'] }],
                });
                if (!file) return;
                try { await exportProfile(file); }
                catch (e: any) { alert(`Export failed: ${e}`); }
              }}>
                <Upload size={12} /> Export
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
            variant={paused ? 'outline' : 'outline'}
            size="sm"
            onClick={handleTogglePause}
            title={paused ? 'Resume macro daemon' : 'Pause daemon & cancel running macros'}
            style={{
              fontSize: 12,
              gap: 6,
              cursor: 'pointer',
              color: 'var(--text-primary)',
              ...(paused
                ? { background: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.25)' }
                : { background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.25)' }
              ),
            }}
          >
            {paused ? (
              <>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--success)',
                  display: 'inline-block', flexShrink: 0,
                }} />
                Start
              </>
            ) : (
              <>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: '#ef4444',
                  display: 'inline-block', flexShrink: 0,
                  animation: 'pulse-dot 2s ease-in-out infinite',
                }} />
                Stop
              </>
            )}
          </Button>

          <style>{`@keyframes pulse-dot { 0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239,68,68,0.5); } 50% { opacity: 0.7; box-shadow: 0 0 8px 3px rgba(239,68,68,0.3); } }`}</style>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
            style={{ height: 28, width: 28, color: 'var(--text-secondary)', cursor: 'pointer' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
          >
            <Settings size={14} />
          </Button>
        </div>
      </TitleBar>

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
        background: 'radial-gradient(ellipse 80% 70% at 50% 30%, #0a0b14 0%, #08090f 40%, #070709 100%)',
        position: 'relative',
      }}>
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
            boxShadow: paused ? '0 0 6px var(--warning)' : '0 0 6px var(--success)',
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

      <PromptDialog
        open={promptOpen}
        title={promptTitle}
        placeholder={promptPlaceholder}
        defaultValue={promptDefault}
        onConfirm={(v) => promptCallback?.(v)}
        onCancel={() => setPromptOpen(false)}
      />
    </div>
  );
}
