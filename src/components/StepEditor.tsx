/** StepEditor — Add and edit macro steps with human-readable inputs */

import { useState, useRef, useEffect } from 'react';
import type { StepDef } from '../types/config';
import { KeyCapture } from './KeyCapture';
import { pickCoordinate, listInstalledPrograms, browseProgram } from '../hooks/useTauri';
import type { InstalledProgram } from '../hooks/useTauri';
import { Button } from './primitives/Button';
import { Input } from './primitives/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './primitives/Select';
import { Checkbox } from './primitives/Checkbox';
import { Crosshair, Plus, FolderOpen, Search } from 'lucide-react';

const STEP_TYPES = [
  { value: 'KeyTap', label: 'Key Tap', desc: 'Press and release a key' },
  { value: 'KeyHold', label: 'Key Hold', desc: 'Hold a key down' },
  { value: 'KeyRelease', label: 'Key Release', desc: 'Release a held key' },
  { value: 'KeySequence', label: 'Key Sequence', desc: 'Type a sequence of keys one after another' },
  { value: 'MouseClick', label: 'Mouse Click', desc: 'Click a mouse button' },
  { value: 'MouseHold', label: 'Mouse Hold', desc: 'Hold a mouse button down' },
  { value: 'MouseRelease', label: 'Mouse Release', desc: 'Release a mouse button' },
  { value: 'MouseMoveRelative', label: 'Mouse Move (Relative)', desc: 'Move the cursor by a pixel offset' },
  { value: 'MouseMoveAbsolute', label: 'Mouse Move (Absolute)', desc: 'Move the cursor to exact screen coordinates' },
  { value: 'MouseAbsoluteClick', label: 'Click at Position', desc: 'Move to coordinates and click' },
  { value: 'MouseSteppedDeltaClick', label: 'Stepped Delta Click', desc: 'Move by delta and click (with stepping)' },
  { value: 'MouseScroll', label: 'Mouse Scroll', desc: 'Scroll the mouse wheel' },
  { value: 'Delay', label: 'Wait', desc: 'Pause between steps' },
  { value: 'RepeatBlock', label: 'Repeat Block', desc: 'Repeat the previous N steps' },
  { value: 'Label', label: 'Label', desc: 'Add a comment or visual separator' },
  { value: 'CancelAll', label: 'Cancel All', desc: 'Stop all running macros immediately' },
  { value: 'RunProgram', label: 'Run Program', desc: 'Launch an application or execute a shell command' },
];

const MOUSE_BTNS = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'middle', label: 'Middle' },
  { value: 'x1', label: 'Back (X1)' },
  { value: 'x2', label: 'Forward (X2)' },
];

const SCROLL_DIRS = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

function defaultStep(type: string): StepDef {
  switch (type) {
    case 'KeyTap': return { type: 'KeyTap', key: 0x20, offset_us: 0 };
    case 'KeyHold': return { type: 'KeyHold', key: 0x20, duration_ms: 100, offset_us: 0 };
    case 'KeyRelease': return { type: 'KeyRelease', key: 0x20, offset_us: 0 };
    case 'KeySequence': return { type: 'KeySequence', keys: [], per_key_delay_ms: 30, offset_us: 0 };
    case 'MouseClick': return { type: 'MouseClick', button: 'left', offset_us: 0 };
    case 'MouseHold': return { type: 'MouseHold', button: 'left', duration_ms: 100, offset_us: 0 };
    case 'MouseRelease': return { type: 'MouseRelease', button: 'left', offset_us: 0 };
    case 'MouseMoveRelative': return { type: 'MouseMoveRelative', dx: 0, dy: 0, stepped: false, offset_us: 0 };
    case 'MouseMoveAbsolute': return { type: 'MouseMoveAbsolute', x: 0, y: 0, offset_us: 0 };
    case 'MouseAbsoluteClick': return { type: 'MouseAbsoluteClick', x: 0, y: 0, button: 'left', offset_us: 0 };
    case 'MouseSteppedDeltaClick': return { type: 'MouseSteppedDeltaClick', dx: 0, dy: 0, button: 'left', offset_us: 0 };
    case 'MouseScroll': return { type: 'MouseScroll', direction: 'down', amount: 3, offset_us: 0 };
    case 'Delay': return { type: 'Delay', ms: 100, offset_us: 0 };
    case 'RepeatBlock': return { type: 'RepeatBlock', step_count: 1, repeat_count: 2, offset_us: 0 };
    case 'Label': return { type: 'Label', text: '' };
    case 'CancelAll': return { type: 'CancelAll' };
    case 'RunProgram': return { type: 'RunProgram', command: '', args: '', working_dir: '', wait: false, offset_us: 0 };
    default: return { type: 'Delay', ms: 100, offset_us: 0 };
  }
}

interface StepEditorProps {
  onAdd: (step: StepDef) => void;
}

export function StepAdder({ onAdd }: StepEditorProps) {
  const [selectedType, setSelectedType] = useState('KeyTap');
  const [draft, setDraft] = useState<StepDef>(defaultStep('KeyTap'));

  const changeType = (type: string) => { setSelectedType(type); setDraft(defaultStep(type)); };
  const handleAdd = () => { onAdd(draft); setDraft(defaultStep(selectedType)); };

  return (
    <div style={{ background: 'linear-gradient(137deg, #111214 4.87%, #0c0d0f 75.88%)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, boxShadow: 'inset 0 1px 0 0 var(--border-highlight)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <Select value={selectedType} onValueChange={changeType}>
          <SelectTrigger style={{ width: 200, maxWidth: '100%', height: 32, fontSize: 13 }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STEP_TYPES.map(t => (
              <SelectItem key={t.value} value={t.value} style={{ fontSize: 13 }}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="primary" onClick={handleAdd} style={{ height: 32, fontSize: 12, gap: 4 }}>
          <Plus size={14} /> Add Step
        </Button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 20, lineHeight: 1.4 }}>
        {STEP_TYPES.find(t => t.value === selectedType)?.desc}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '16px 20px' }}>
        <StepFields step={draft} onChange={setDraft} />
      </div>
    </div>
  );
}

function StepFields({ step, onChange }: { step: StepDef; onChange: (step: StepDef) => void }) {
  switch (step.type) {
    case 'KeyTap':
      return <KeyCapture label="Key" vk={step.key} onChange={v => onChange({ ...step, key: v })} />;
    case 'KeyHold':
      return (<>
        <KeyCapture label="Key" vk={step.key} onChange={v => onChange({ ...step, key: v })} />
        <NumField label="Duration (ms)" value={step.duration_ms} onChange={v => onChange({ ...step, duration_ms: v })} />
      </>);
    case 'KeyRelease':
      return <KeyCapture label="Key" vk={step.key} onChange={v => onChange({ ...step, key: v })} />;
    case 'KeySequence':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 8, display: 'block' }}>Keys in sequence</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              {step.keys.map((k, i) => (
                <KeyCapture key={i} vk={k} onChange={v => { const keys = [...step.keys]; keys[i] = v; onChange({ ...step, keys }); }} />
              ))}
              <Button variant="ghost" size="sm" onClick={() => onChange({ ...step, keys: [...step.keys, 0x20] })}
                style={{ height: 32, fontSize: 12, color: 'var(--text-secondary)' }}>+ Key</Button>
            </div>
          </div>
          <NumField label="Delay between keys (ms)" value={step.per_key_delay_ms} onChange={v => onChange({ ...step, per_key_delay_ms: v })} />
        </div>
      );
    case 'MouseClick':
    case 'MouseRelease':
      return <SelectField label="Button" value={step.button} options={MOUSE_BTNS} onChange={v => onChange({ ...step, button: v })} />;
    case 'MouseHold':
      return (<>
        <SelectField label="Button" value={step.button} options={MOUSE_BTNS} onChange={v => onChange({ ...step, button: v })} />
        <NumField label="Duration (ms)" value={step.duration_ms} onChange={v => onChange({ ...step, duration_ms: v })} />
      </>);
    case 'MouseMoveRelative':
      return (<>
        <NumField label="X offset (px)" value={step.dx} onChange={v => onChange({ ...step, dx: v })} />
        <NumField label="Y offset (px)" value={step.dy} onChange={v => onChange({ ...step, dy: v })} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center', height: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Checkbox id="stepped" checked={step.stepped} onCheckedChange={c => onChange({ ...step, stepped: c === true })} />
            <label htmlFor="stepped" style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>Stepped</label>
          </div>
        </div>
      </>);
    case 'MouseMoveAbsolute':
      return (<>
        <NumField label="X position (px)" value={step.x} onChange={v => onChange({ ...step, x: v })} />
        <NumField label="Y position (px)" value={step.y} onChange={v => onChange({ ...step, y: v })} />
        <Button variant="ghost" size="sm" title="Pick from screen" onClick={async () => { try { const [x, y] = await pickCoordinate(); onChange({ ...step, x, y }); } catch {} }}
          style={{ height: 32, fontSize: 12, color: 'var(--text-secondary)', gap: 4 }}>
          <Crosshair size={11} /> Pick
        </Button>
      </>);
    case 'MouseAbsoluteClick':
      return (<>
        <NumField label="X position (px)" value={step.x} onChange={v => onChange({ ...step, x: v })} />
        <NumField label="Y position (px)" value={step.y} onChange={v => onChange({ ...step, y: v })} />
        <Button variant="ghost" size="sm" title="Pick from screen" onClick={async () => { try { const [x, y] = await pickCoordinate(); onChange({ ...step, x, y }); } catch {} }}
          style={{ height: 32, fontSize: 12, color: 'var(--text-secondary)', gap: 4 }}>
          <Crosshair size={11} /> Pick
        </Button>
        <SelectField label="Button" value={step.button} options={MOUSE_BTNS} onChange={v => onChange({ ...step, button: v })} />
      </>);
    case 'MouseSteppedDeltaClick':
      return (<>
        <NumField label="X offset (px)" value={step.dx} onChange={v => onChange({ ...step, dx: v })} />
        <NumField label="Y offset (px)" value={step.dy} onChange={v => onChange({ ...step, dy: v })} />
        <SelectField label="Button" value={step.button} options={MOUSE_BTNS} onChange={v => onChange({ ...step, button: v })} />
      </>);
    case 'MouseScroll':
      return (<>
        <SelectField label="Direction" value={step.direction} options={SCROLL_DIRS} onChange={v => onChange({ ...step, direction: v })} />
        <NumField label="Scroll amount" value={step.amount} onChange={v => onChange({ ...step, amount: v })} />
      </>);
    case 'Delay':
      return <NumField label="Wait duration (ms)" value={step.ms} onChange={v => onChange({ ...step, ms: v })} />;
    case 'RepeatBlock':
      return (<>
        <NumField label="Steps to repeat" value={step.step_count} onChange={v => onChange({ ...step, step_count: v })} />
        <NumField label="Times" value={step.repeat_count} onChange={v => onChange({ ...step, repeat_count: v })} />
      </>);
    case 'Label':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
          <label style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Label text</label>
          <Input value={step.text} onChange={e => onChange({ ...step, text: e.target.value })} placeholder="Comment or separator..." style={{ height: 32, fontSize: 13 }} />
        </div>
      );
    case 'CancelAll':
      return <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>No parameters — stops all running macros when this step executes.</div>;
    case 'RunProgram':
      return <RunProgramFields step={step} onChange={onChange} />;
    default: return null;
  }
}

function RunProgramFields({ step, onChange }: { step: Extract<StepDef, { type: 'RunProgram' }>; onChange: (s: StepDef) => void }) {
  const [programs, setPrograms] = useState<InstalledProgram[]>([]);
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listInstalledPrograms().then(setPrograms).catch(() => {});
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = programs.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.path.toLowerCase().includes(search.toLowerCase())
  );

  const handleBrowse = async () => {
    try {
      const path = await browseProgram();
      if (path) onChange({ ...step, command: path });
    } catch {}
  };

  const basename = step.command ? step.command.split(/[\\/]/).pop() || step.command : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
      {/* Program selector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Program</label>
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
              <Input
                value={showDropdown ? search : (basename || search)}
                placeholder="Search installed programs..."
                style={{ height: 32, fontSize: 13, paddingLeft: 28 }}
                onFocus={() => { setShowDropdown(true); setSearch(''); }}
                onChange={e => { setSearch(e.target.value); setShowDropdown(true); }}
              />
            </div>
            <Button variant="ghost" size="sm" onClick={handleBrowse}
              style={{ height: 32, fontSize: 12, color: 'var(--text-secondary)', gap: 4, flexShrink: 0 }}>
              <FolderOpen size={13} /> Browse
            </Button>
          </div>

          {showDropdown && filtered.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
              maxHeight: 200, overflowY: 'auto',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 6, marginTop: 4,
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            }}>
              {filtered.map((p, i) => (
                <div key={i}
                  style={{
                    padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                    borderBottom: i < filtered.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => {
                    onChange({ ...step, command: p.path });
                    setSearch(p.name);
                    setShowDropdown(false);
                  }}
                >
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.path}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {step.command && (
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {step.command}
          </div>
        )}
      </div>

      {/* Args + Working Dir */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 140 }}>
          <label style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Arguments</label>
          <Input value={step.args} onChange={e => onChange({ ...step, args: e.target.value })} placeholder="--flag value" style={{ height: 32, fontSize: 13 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 140 }}>
          <label style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Working Directory</label>
          <Input value={step.working_dir} onChange={e => onChange({ ...step, working_dir: e.target.value })} placeholder="Optional" style={{ height: 32, fontSize: 13 }} />
        </div>
      </div>

      {/* Wait checkbox */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox id="run-wait" checked={step.wait} onCheckedChange={c => onChange({ ...step, wait: c === true })} />
        <label htmlFor="run-wait" style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>Wait for exit</label>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>— blocks the macro until the program closes</span>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 90 }}>
      <label style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</label>
      <Input type="number" value={value} onChange={e => { const n = Number(e.target.value); if (!isNaN(n)) onChange(n); }}
        style={{ width: 120, maxWidth: '100%', height: 32, fontSize: 13 }} />
    </div>
  );
}

function SelectField({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 120 }}>
      <label style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger style={{ width: 140, maxWidth: '100%', height: 32, fontSize: 13 }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o.value} value={o.value} style={{ fontSize: 13 }}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
