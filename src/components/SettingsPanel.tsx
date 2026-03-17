import { useState, useEffect, useRef, useCallback } from 'react';
import type { AppConfig, AppSettings } from '../types/config';
import { saveSettings, arduinoConnect, arduinoDisconnect, arduinoPing, arduinoIsConnected, arduinoListPorts, openConfigDir, saveFirmware } from '../hooks/useTauri';
import { save } from '@tauri-apps/plugin-dialog';
import { KeyCapture } from './KeyCapture';
import { Button } from './primitives/Button';
import { Input } from './primitives/Input';
import { Switch } from './primitives/Switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './primitives/Select';
import { Separator } from './primitives/Separator';
import { FolderOpen, Circle, Zap, Download, RefreshCw } from 'lucide-react';

interface SettingsPanelProps {
  config: AppConfig;
  onConfigUpdate: (config: AppConfig) => void;
}

export function SettingsPanel({ config, onConfigUpdate }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings>(structuredClone(config.settings));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSettingsRef = useRef<AppSettings>(settings);

  const [arduinoConnected, setArduinoConnected] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [pingStatus, setPingStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [arduinoError, setArduinoError] = useState('');
  const [availablePorts, setAvailablePorts] = useState<string[]>([]);

  useEffect(() => {
    setSettings(structuredClone(config.settings));
    latestSettingsRef.current = structuredClone(config.settings);
  }, [config]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        persistSettings(latestSettingsRef.current);
      }
    };
  }, []);

  const persistSettings = useCallback(async (s: AppSettings) => {
    try {
      await saveSettings(s);
      onConfigUpdate({ ...config, settings: s });
    } catch (e) { console.error('Failed to save settings:', e); }
  }, [config, onConfigUpdate]);

  const patchImmediate = useCallback((p: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...p };
      latestSettingsRef.current = next;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = null;
      persistSettings(next);
      return next;
    });
  }, [persistSettings]);

  const patchDebounced = useCallback((p: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...p };
      latestSettingsRef.current = next;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        persistSettings(next);
        debounceRef.current = null;
      }, 500);
      return next;
    });
  }, [persistSettings]);

  const refreshPorts = () => {
    arduinoListPorts().then(setAvailablePorts).catch(() => {});
  };

  useEffect(() => {
    arduinoIsConnected().then(setArduinoConnected).catch(() => {});
    refreshPorts();
  }, []);

  const handleConnect = async () => {
    try {
      setArduinoError('');
      await arduinoConnect(settings.arduino.port);
      setArduinoConnected(true);
    } catch (e: any) {
      setArduinoError(e?.toString() ?? 'Connection failed');
      setArduinoConnected(false);
    }
  };

  const handleDisconnect = async () => {
    await arduinoDisconnect();
    setArduinoConnected(false);
    setPingMs(null);
    setPingStatus('idle');
  };

  const handlePing = async () => {
    try {
      const ms = await arduinoPing();
      setPingMs(ms);
      setPingStatus('ok');
      setArduinoError('');
    } catch {
      setPingMs(null);
      setPingStatus('fail');
      setArduinoError('Ping failed — no response from Arduino');
    }
    setTimeout(() => setPingStatus('idle'), 2500);
  };

  const handleDownloadFirmware = async () => {
    try {
      setArduinoError('');
      const path = await save({
        defaultPath: 'AuraHID_v3.ino',
        filters: [{ name: 'Arduino Sketch', extensions: ['ino'] }],
      });
      if (!path) return;
      await saveFirmware(path);
    } catch (e: any) { setArduinoError(e?.toString() ?? 'Save failed'); }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Settings</h2>
      </div>

      {/* ── Recording ── */}
      <SettingsSection title="Recording" icon="⏺">
        <SettingsRow label="Stop Key" sub="Key to stop sequence recording">
          <KeyCapture vk={settings.stop_key} onChange={v => patchImmediate({ stop_key: v })} />
        </SettingsRow>
        <SettingsRow label="Countdown" sub="Seconds before recording starts">
          <Input type="number" value={settings.recording_countdown_secs} min={0} max={10} style={{ width: 80, height: 32, fontSize: 12 }}
            onChange={e => patchDebounced({ recording_countdown_secs: Number(e.target.value) })} />
        </SettingsRow>
        <SettingsRow label="Max Duration" sub="Maximum recording length (seconds)">
          <Input type="number" value={settings.max_recording_secs} min={1} max={300} style={{ width: 80, height: 32, fontSize: 12 }}
            onChange={e => patchDebounced({ max_recording_secs: Number(e.target.value) })} />
        </SettingsRow>
        <SettingsRow label="Mouse Accumulation" sub="Merge mouse moves within this window (ms)" noBorder>
          <Input type="number" value={settings.mouse_accumulate_ms} min={1} max={100} style={{ width: 80, height: 32, fontSize: 12 }}
            onChange={e => patchDebounced({ mouse_accumulate_ms: Number(e.target.value) })} />
        </SettingsRow>
      </SettingsSection>

      {/* ── Defaults ── */}
      <SettingsSection title="Defaults" icon="⚙">
        <SettingsRow label="Execution Mode" sub="Default mode for new macros">
          <Select value={settings.default_execution} onValueChange={v => patchImmediate({ default_execution: v })}>
            <SelectTrigger style={{ width: 140, height: 32, fontSize: 12 }}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sequential" style={{ fontSize: 12 }}>Sequential</SelectItem>
              <SelectItem value="timeline" style={{ fontSize: 12 }}>Timeline</SelectItem>
              <SelectItem value="continuous" style={{ fontSize: 12 }}>Continuous</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Tick Rate" sub="Default continuous macro tick rate (ms)" noBorder>
          <Input type="number" value={settings.default_tick_rate_ms} min={1} max={1000} style={{ width: 80, height: 32, fontSize: 12 }}
            onChange={e => patchDebounced({ default_tick_rate_ms: Number(e.target.value) })} />
        </SettingsRow>
      </SettingsSection>

      {/* ── Application ── */}
      <SettingsSection title="Application" icon="🖥">
        <SettingsRow label="Launch with Windows" sub="Start AuraKey at login">
          <Switch checked={settings.launch_with_windows} onCheckedChange={v => patchImmediate({ launch_with_windows: v })} />
        </SettingsRow>
        <SettingsRow label="Start Minimized" sub="Start minimized to system tray">
          <Switch checked={settings.start_minimized} onCheckedChange={v => patchImmediate({ start_minimized: v })} />
        </SettingsRow>
        <SettingsRow label="Theme" sub="Color mode">
          <Select value={settings.theme} onValueChange={v => patchImmediate({ theme: v as AppSettings['theme'] })}>
            <SelectTrigger style={{ width: 120, height: 32, fontSize: 12 }}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="dark" style={{ fontSize: 12 }}>Dark</SelectItem>
              <SelectItem value="light" style={{ fontSize: 12 }}>Light</SelectItem>
              <SelectItem value="system" style={{ fontSize: 12 }}>System</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Config Directory" sub="Open config folder in Explorer" noBorder>
          <Button variant="ghost" size="sm" onClick={openConfigDir} style={{ height: 28, fontSize: 12, color: 'var(--text-secondary)', gap: 4 }}>
            <FolderOpen size={12} /> Open
          </Button>
        </SettingsRow>
      </SettingsSection>

      {/* ── Arduino HID ── */}
      <SettingsSection title="Arduino HID Passthrough" icon="🔌">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Circle size={8} fill={arduinoConnected ? 'var(--success)' : 'var(--text-tertiary)'} style={{ color: arduinoConnected ? 'var(--success)' : 'var(--text-tertiary)' }} />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{arduinoConnected ? 'Connected' : 'Disconnected'}</span>
            {arduinoConnected && settings.arduino.port && (
              <span style={{ fontSize: 10, background: 'var(--bg-surface-hover)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', fontFamily: 'var(--font-mono)' }}>{settings.arduino.port}</span>
            )}
          </div>
          {arduinoConnected && (
            <Button variant="ghost" size="sm" onClick={handlePing} style={{
              height: 28, fontSize: 12, gap: 4,
              color: pingStatus === 'ok' ? 'var(--success)' : pingStatus === 'fail' ? 'var(--error)' : 'var(--text-secondary)',
            }}>
              <Zap size={12} />
              {pingStatus === 'ok' ? `${pingMs}ms ✓` : pingStatus === 'fail' ? 'Failed ✗' : pingMs !== null ? `Ping (${pingMs}ms)` : 'Ping'}
            </Button>
          )}
        </div>

        {arduinoError && (
          <div style={{ fontSize: 12, color: 'var(--error)', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.2)', borderRadius: 4, padding: '8px 12px', marginBottom: 12 }}>{arduinoError}</div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Select value={settings.arduino.port || ''} onValueChange={v => patchImmediate({ arduino: { ...settings.arduino, port: v } })}>
            <SelectTrigger style={{ flex: 1, height: 32, fontSize: 12 }}><SelectValue placeholder="No ports found" /></SelectTrigger>
            <SelectContent>
              {settings.arduino.port && !availablePorts.includes(settings.arduino.port) && (
                <SelectItem value={settings.arduino.port} style={{ fontSize: 12 }}>{settings.arduino.port}</SelectItem>
              )}
              {availablePorts.map(p => (
                <SelectItem key={p} value={p} style={{ fontSize: 12 }}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={refreshPorts} title="Refresh ports" style={{ height: 32, width: 32, color: 'var(--text-secondary)' }}>
            <RefreshCw size={12} />
          </Button>
          {!arduinoConnected ? (
            <Button size="sm" variant="primary" onClick={handleConnect} disabled={!settings.arduino.port} style={{ height: 32, fontSize: 12 }}>Connect</Button>
          ) : (
            <Button variant="destructive" size="sm" onClick={handleDisconnect} style={{ height: 32, fontSize: 12 }}>Disconnect</Button>
          )}
        </div>

        <Separator />

        <SettingsRow label="Auto-connect" sub="Reconnect on daemon startup">
          <Switch checked={settings.arduino.auto_connect} onCheckedChange={v => patchImmediate({ arduino: { ...settings.arduino, auto_connect: v } })} />
        </SettingsRow>
        <SettingsRow label="Fallback to Software" sub="Use SendInput when Arduino disconnects" noBorder>
          <Switch checked={settings.arduino.fallback_to_software} onCheckedChange={v => patchImmediate({ arduino: { ...settings.arduino, fallback_to_software: v } })} />
        </SettingsRow>

        <Separator />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>AuraHID v3 Firmware</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>Arduino Leonardo / Pro Micro sketch for hardware-level HID passthrough</div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleDownloadFirmware} style={{ height: 28, fontSize: 12, color: 'var(--text-secondary)', gap: 4 }}>
            <Download size={12} /> Save .ino
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}

function SettingsSection({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32, borderTop: '1px solid var(--border)', paddingTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function SettingsRow({ label, sub, children, noBorder }: { label: string; sub?: string; children: React.ReactNode; noBorder?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0',
      ...(noBorder ? {} : { borderBottom: '1px solid var(--border-subtle)' }),
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.5 }}>{sub}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
    </div>
  );
}
