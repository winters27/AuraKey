/** AuraKey — Main Application Shell */

import { useEffect, useState, useCallback } from 'react';
import type { AppConfig, MacroSelection } from './types/config';
import { getConfig, togglePause, cancelAll, createMacro, updateMacro, createGroup, arduinoIsConnected, getDaemonEvents } from './hooks/useTauri';
import { TitleBar } from './components/TitleBar';
import { MacroList } from './components/MacroList';
import { MacroEditor } from './components/MacroEditor';
import { SettingsPanel } from './components/SettingsPanel';
import { KeyboardLayout } from './components/KeyboardLayout';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './components/primitives/Tooltip';
import { Button } from './components/primitives/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/primitives/Select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/primitives/DropdownMenu';
import { PromptDialog } from './components/primitives/PromptDialog';
import { Ellipsis, Plus, Pencil, Trash2, Import, Upload, Plug } from 'lucide-react';
import { useRef } from 'react';
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
  const pendingKeyVk = useRef<number | null>(null);
  const [hwConnected, setHwConnected] = useState(false);

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

  // Poll Arduino HID connection status
  useEffect(() => {
    const check = () => arduinoIsConnected().then(setHwConnected).catch(() => setHwConnected(false));
    check();
    const id = setInterval(check, 3000);
    return () => clearInterval(id);
  }, []);

  // Poll daemon events for tray-initiated changes (profile switch, pause)
  useEffect(() => {
    const poll = async () => {
      try {
        const events = await getDaemonEvents();
        for (const evt of events) {
          const e = evt as Record<string, unknown>;
          if ('ConfigChanged' in e || evt === 'ConfigChanged') {
            // Tray switched the active profile — re-fetch config
            const freshConfig = await getConfig();
            setConfig(freshConfig);
            setSelection(null);
            setPanel('none');
          }
          if (typeof e === 'object' && 'PauseChanged' in e) {
            const inner = e.PauseChanged as { paused: boolean };
            setPaused(inner.paused);
          }
        }
      } catch {}
    };
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
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

  // Reset to keyboard screen if the selected macro no longer exists
  useEffect(() => {
    if (panel === 'editor' && selection && config) {
      const profile = config.profiles.find(p => p.name === config.active_profile) ?? config.profiles[0];
      const macro = profile?.groups[selection.groupIdx]?.macros[selection.macroIdx];
      if (!macro) {
        setSelection(null);
        setPanel('none');
      }
    }
  }, [config, panel, selection]);

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
        <div style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>Loading…</div>
      </div>
    );
  }

  if (!config) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', background: 'var(--bg-base)' }}>
        <div style={{ color: 'var(--error)', fontSize: '1rem' }}>Failed to load configuration</div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '20rem 1fr',
      gridTemplateRows: '2.857rem 1fr 2rem',
      height: '100vh',
    }}>
      {/* ── Title Bar (with embedded controls) ── */}
      <TitleBar onLogoClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.571rem' }}>
          <Select
            value={config.active_profile}
            onValueChange={async (val) => {
              const { setActiveProfile } = await import('./hooks/useTauri');
              await setActiveProfile(val);
              const updated = await getConfig();
              handleConfigUpdate(updated);
            }}
          >
            <SelectTrigger style={{ height: '2rem', width: '12.857rem', fontSize: '0.857rem' }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {config.profiles.map(p => (
                <SelectItem key={p.name} value={p.name} style={{ fontSize: '0.857rem' }}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" style={{ height: '2rem', width: '2rem', color: 'var(--text-secondary)', cursor: 'pointer' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
              >                <Ellipsis size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" style={{ minWidth: '11.429rem' }}>
              <DropdownMenuItem style={{ fontSize: '0.857rem', gap: '0.571rem' }} onSelect={() => {
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
              <DropdownMenuItem style={{ fontSize: '0.857rem', gap: '0.571rem' }} onSelect={() => {
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
              <DropdownMenuItem style={{ fontSize: '0.857rem', gap: '0.571rem' }} onSelect={async () => {
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
              <DropdownMenuItem style={{ fontSize: '0.857rem', gap: '0.571rem' }} onSelect={async () => {
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
                style={{ fontSize: '0.857rem', gap: '0.571rem', color: 'var(--error)' }}
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
        padding: '1.714rem',
        background: 'radial-gradient(ellipse 80% 70% at 50% 30%, #0a0b14 0%, #08090f 40%, #070709 100%)',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column' }}>
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

        {panel === 'none' && config && (
          <KeyboardLayout onKeySelect={(vk, _label) => {
            pendingKeyVk.current = vk;
            setPromptTitle('Give your new macro a name');
            setPromptPlaceholder('e.g. Quick Switch, Reload Combo\u2026');
            setPromptDefault('');
            setPromptCallback(() => async (name: string) => {
              try {
                const profile = config.profiles.find(p => p.name === config.active_profile) ?? config.profiles[0];
                let updated: AppConfig = config;
                if (!profile || profile.groups.length === 0) {
                  updated = await createGroup('General');
                  handleConfigUpdate(updated);
                }
                updated = await createMacro(0, name);
                handleConfigUpdate(updated);
                const newProfile = updated.profiles.find(p => p.name === updated.active_profile) ?? updated.profiles[0];
                const macroIdx = newProfile.groups[0].macros.length - 1;
                const newMacro = { ...newProfile.groups[0].macros[macroIdx] };
                const selectedVk = pendingKeyVk.current!;
                newMacro.trigger = { ...newMacro.trigger, keys: [selectedVk], trigger_sets: [[selectedVk]] };
                updated = await updateMacro(0, macroIdx, newMacro);
                handleConfigUpdate(updated);
                setSelection({ groupIdx: 0, macroIdx });
                setPanel('editor');
                pendingKeyVk.current = null;
              } catch (err) {
                console.error('Failed to create macro from keyboard:', err);
              }
              setPromptOpen(false);
            });
            setPromptOpen(true);
          }} />
        )}
        </div>
      </div>

      <TooltipProvider>
      <div style={{
        gridColumn: '1 / -1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1.143rem',
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
        fontSize: '0.786rem',
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.429rem' }}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              onClick={handleTogglePause}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.429rem',
                cursor: 'pointer',
                transition: 'opacity 150ms ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              <span style={{
                width: '0.429rem', height: '0.429rem', borderRadius: '50%',
                background: paused ? 'var(--warning)' : 'var(--success)',
                boxShadow: paused ? '0 0 6px var(--warning)' : '0 0 6px var(--success)',
              }} />
              <span>{paused ? 'Paused' : 'Active'}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            {paused ? 'Click to resume' : 'Click to pause'}
          </TooltipContent>
        </Tooltip>

          <span style={{ width: 1, height: '0.714rem', background: 'var(--border)' }} />

          <Tooltip>
            <TooltipTrigger asChild>
              <div
                onClick={() => {
                  setSelection(null);
                  setPanel('settings');
                  setTimeout(() => document.getElementById('arduino-hid')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.429rem',
                  cursor: 'pointer',
                  transition: 'opacity 150ms ease',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                <Plug size={11} style={{
                  color: hwConnected ? 'var(--success)' : 'var(--text-tertiary)',
                  transition: 'all 300ms ease',
                }} />
                <span style={{ color: hwConnected ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
                  {hwConnected ? 'AuraHID' : 'No AuraHID'}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top">{hwConnected ? 'AuraHID connected & active' : 'AuraHID not connected'}</TooltipContent>
          </Tooltip>
        </div>
        <div>
          {config.active_profile} · {
            config.profiles
              .find(p => p.name === config.active_profile)
              ?.groups.reduce((sum, g) => sum + g.macros.length, 0) ?? 0
          } macros
        </div>
      </div>
      </TooltipProvider>

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
