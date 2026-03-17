/** MacroEditor — Main panel for editing a macro */

import { useState, useEffect, useRef } from 'react';
import type { AppConfig, MacroDef, MacroSelection, StepDef } from '../types/config';
import { getGamepadButton, isGamepadVk } from '../types/config';
import { updateMacro, deleteMacro } from '../hooks/useTauri';
import { Keycap } from './Keycap';
import { StepAdder } from './StepEditor';
import { HotkeyRecorder } from './HotkeyRecorder';
import { RecordingPanel } from './RecordingPanel';
import { KeyCapture } from './KeyCapture';
import { TimelineView } from './TimelineView';
import { Button } from './primitives/Button';
import { Input } from './primitives/Input';
import { Switch } from './primitives/Switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './primitives/Select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './primitives/Tooltip';
import { GripVertical, Copy, X, AlertTriangle, Info } from 'lucide-react';

interface MacroEditorProps {
  config: AppConfig;
  selection: MacroSelection;
  onConfigUpdate: (config: AppConfig) => void;
  onClearSelection: () => void;
}

const TRIGGER_MODES = [
  { value: 'press', label: 'Press' },
  { value: 'hold', label: 'Hold' },
  { value: 'toggle', label: 'Toggle' },
  { value: 'double_tap', label: 'Double Tap' },
  { value: 'long_press', label: 'Long Press' },
  { value: 'release', label: 'Release' },
];

const TRIGGER_DESC: Record<string, string> = {
  press: 'Fires the macro once when the key is pressed',
  hold: 'Loops while the key is held down, stops on release',
  toggle: 'First press starts the loop, second press stops it',
  double_tap: 'Fires only on a quick double-press within the timeout window',
  long_press: 'Fires when the key is held past the threshold, ignored on quick taps',
  release: 'Fires when the key is released instead of pressed',
};

const EXEC_MODES = [
  { value: 'sequential', label: 'Sequential' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'continuous', label: 'Continuous' },
];

const EXEC_DESC: Record<string, string> = {
  sequential: 'Steps run one after another in order',
  timeline: 'Steps fire at specific time offsets — multiple can overlap',
  continuous: 'Repeats a pattern in a loop at the set tick rate',
};

const OUTPUT_MODES = [
  { value: 'software', label: 'Software' },
  { value: 'arduino', label: 'Arduino HID' },
];

const OUTPUT_DESC: Record<string, string> = {
  software: 'Simulates input via Windows SendInput — works everywhere, detectable by anti-cheat',
  arduino: 'Sends input through Arduino HID passthrough — hardware-level, undetectable',
};

const PATTERN_MODES = [
  { value: 'key_cycle', label: 'Key Cycle' },
  { value: 'mouse_oscillate', label: 'Mouse Oscillate' },
];

const PATTERN_DESC: Record<string, string> = {
  key_cycle: 'Presses each key in order, one per tick — loops through the list continuously',
  mouse_oscillate: 'Sweeps mouse back and forth with configurable amplitude and vertical pull',
};

const DELAY_PRESETS = [1, 5, 10, 16, 50, 100, 250, 500, 1000];

export function MacroEditor({ config, selection, onConfigUpdate, onClearSelection }: MacroEditorProps) {
  const profile = config.profiles.find(p => p.name === config.active_profile) ?? config.profiles[0];
  if (!profile) return null;

  const group = profile.groups[selection.groupIdx];
  if (!group) return null;
  const originalMacro = group.macros[selection.macroIdx];
  if (!originalMacro) return null;

  const [draft, setDraft] = useState<MacroDef>(structuredClone(originalMacro));
  const [dirty, setDirty] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Conflict detection
  const conflicts = (() => {
    const found: string[] = [];
    const draftSets = (draft.trigger.trigger_sets || []).map(c => JSON.stringify([...c].sort()));
    if (draftSets.length === 0) return found;
    for (const g of profile.groups) {
      for (const m of g.macros) {
        if (m.id === draft.id) continue;
        if (!m.enabled) continue;
        const mSets = (m.trigger.trigger_sets || []).map(c => JSON.stringify([...c].sort()));
        for (const dc of draftSets) {
          if (mSets.includes(dc)) {
            found.push(m.name);
            break;
          }
        }
      }
    }
    return found;
  })();

  useEffect(() => {
    const p = config.profiles.find(pr => pr.name === config.active_profile) ?? config.profiles[0];
    const m = p?.groups[selection.groupIdx]?.macros[selection.macroIdx];
    if (m) {
      setDraft(structuredClone(m));
      setDirty(false);
    }
  }, [selection.groupIdx, selection.macroIdx, config]);

  const update = (patch: Partial<MacroDef>) => {
    setDraft(d => ({ ...d, ...patch }));
    setDirty(true);
  };

  const handleSave = async () => {
    const updated = await updateMacro(selection.groupIdx, selection.macroIdx, draft);
    onConfigUpdate(updated);
    setDirty(false);
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${draft.name}"?`)) return;
    const updated = await deleteMacro(selection.groupIdx, selection.macroIdx);
    onConfigUpdate(updated);
    onClearSelection();
  };

  // ── Step helpers ──
  const humanButton = (b: string) => {
    const map: Record<string, string> = { left: 'Left', right: 'Right', middle: 'Middle', x1: 'Back', x2: 'Forward' };
    return map[b] ?? b;
  };

  const MODIFIER_VKS = new Set([0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C, 0x10, 0x11, 0x12]);
  const isModifier = (vk: number) => MODIFIER_VKS.has(vk);

  const isModifierWrapStart = (idx: number): boolean => {
    const step = draft.steps[idx];
    if (step.type !== 'KeyHold' || !isModifier(step.key)) return false;
    for (let j = idx + 2; j < draft.steps.length; j++) {
      const rel = draft.steps[j];
      if (rel.type === 'KeyRelease' && rel.key === step.key) return true;
      if (rel.type === 'KeyHold' || rel.type === 'KeyRelease') continue;
      break;
    }
    return false;
  };

  const isModifierWrapEnd = (idx: number): boolean => {
    const step = draft.steps[idx];
    if (step.type !== 'KeyRelease' || !isModifier(step.key)) return false;
    for (let j = idx - 1; j >= 0; j--) {
      const hold = draft.steps[j];
      if (hold.type === 'KeyHold' && hold.key === step.key) return true;
      if (hold.type === 'KeyTap') break;
    }
    return false;
  };

  const activeModifiers = (idx: number): number[] => {
    const mods: number[] = [];
    for (let j = 0; j < idx; j++) {
      const s = draft.steps[j];
      if (s.type === 'KeyHold' && isModifier(s.key)) mods.push(s.key);
      if (s.type === 'KeyRelease' && isModifier(s.key)) {
        const mi = mods.indexOf(s.key);
        if (mi >= 0) mods.splice(mi, 1);
      }
    }
    return mods;
  };

  const stepKeys = (step: StepDef, idx: number): React.ReactNode => {
    if (step.type === 'KeyHold' && isModifier(step.key) && isModifierWrapStart(idx)) return null;
    if (step.type === 'KeyRelease' && isModifier(step.key) && isModifierWrapEnd(idx)) return null;

    switch (step.type) {
      case 'KeyTap': {
        const mods = activeModifiers(idx);
        if (mods.length > 0) {
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {mods.map((mk, i) => (
                <span key={`mod-${mk}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Keycap vk={mk} />
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>+</span>
                </span>
              ))}
              <Keycap vk={step.key} />
            </span>
          );
        }
        return <Keycap vk={step.key} />;
      }
      case 'KeyHold':
      case 'KeyRelease':
        return <Keycap vk={step.key} />;
      case 'KeySequence':
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {step.keys.map((vk, i) => (
              <span key={`${vk}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>→</span>}
                <Keycap vk={vk} />
              </span>
            ))}
          </span>
        );
      default:
        return null;
    }
  };

  const stepIsCollapsed = (step: StepDef, idx: number): boolean => {
    if (step.type === 'KeyHold' && isModifier(step.key) && isModifierWrapStart(idx)) return true;
    if (step.type === 'KeyRelease' && isModifier(step.key) && isModifierWrapEnd(idx)) return true;
    return false;
  };

  const stepDetail = (step: StepDef): string => {
    switch (step.type) {
      case 'KeyTap': case 'KeyHold': case 'KeyRelease': case 'KeySequence': return '';
      case 'MouseMoveRelative': return `(${step.dx}, ${step.dy})${step.stepped ? ' stepped' : ''}`;
      case 'MouseMoveAbsolute': return `to (${step.x}, ${step.y})`;
      case 'MouseClick': return `${humanButton(step.button)}`;
      case 'MouseHold': return `${humanButton(step.button)}`;
      case 'MouseRelease': return `${humanButton(step.button)}`;
      case 'MouseAbsoluteClick': return `${humanButton(step.button)} at (${step.x}, ${step.y})`;
      case 'MouseSteppedDeltaClick': return `${humanButton(step.button)} Δ(${step.dx}, ${step.dy})`;
      case 'MouseScroll': return `${step.direction} ×${step.amount}`;
      case 'Delay': return '';
      case 'RepeatBlock': return `${step.step_count} steps × ${step.repeat_count}`;
      case 'Label': return step.text;
      case 'CancelAll': return '';
      case 'RunProgram': return step.command ? step.command.split(/[\\/]/).pop() || step.command : 'No program set';
    }
  };

  const stepTypeName = (step: StepDef): string => {
    const map: Record<string, string> = {
      KeyTap: 'Tap', KeyHold: 'Hold', KeyRelease: 'Release',
      KeySequence: 'Sequence', MouseClick: 'Click', MouseHold: 'Hold',
      MouseRelease: 'Release', MouseMoveRelative: 'Move',
      MouseMoveAbsolute: 'Move To', MouseAbsoluteClick: 'Click At',
      MouseSteppedDeltaClick: 'Stepped Click', MouseScroll: 'Scroll',
      Delay: 'Wait', RepeatBlock: 'Repeat', Label: 'Label', CancelAll: 'Cancel',
      RunProgram: 'Run',
    };
    return map[step.type] ?? step.type;
  };

  const removeStep = (idx: number) => {
    const steps = [...draft.steps];
    steps.splice(idx, 1);
    update({ steps });
  };

  const addStep = (step: StepDef) => {
    update({ steps: [...draft.steps, step] });
  };

  const duplicateStep = (idx: number) => {
    const steps = [...draft.steps];
    steps.splice(idx + 1, 0, structuredClone(steps[idx]));
    update({ steps });
  };

  const updateStep = (idx: number, newStep: StepDef) => {
    const steps = [...draft.steps];
    steps[idx] = newStep;
    update({ steps });
  };

  const addDelayPreset = (ms: number) => {
    addStep({ type: 'Delay', ms, offset_us: 0 });
  };

  // ── Pointer-based reorder ──
  const [dropIndicator, setDropIndicator] = useState<number | null>(null);
  const dropIndicatorRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const dragFromRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const getDropIndex = (clientY: number): number | null => {
    if (!listRef.current) return null;
    const items = listRef.current.querySelectorAll<HTMLElement>('[data-step-idx]');
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return items.length;
  };

  const setDrop = (pos: number | null) => {
    dropIndicatorRef.current = pos;
    setDropIndicator(pos);
  };

  const handlePointerDown = (idx: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const tag = (e.target as HTMLElement).closest('button, input, select, textarea');
    if (tag) return;
    e.preventDefault();

    dragFromRef.current = idx;
    draggingRef.current = false;

    const startY = e.clientY;

    const onMove = (me: PointerEvent) => {
      if (!draggingRef.current && Math.abs(me.clientY - startY) < 4) return;
      if (!draggingRef.current) {
        draggingRef.current = true;
        setDragIdx(idx);
      }
      const dropPos = getDropIndex(me.clientY);
      setDrop(dropPos);
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      if (draggingRef.current && dragFromRef.current !== null) {
        const fromIdx = dragFromRef.current;
        const current = dropIndicatorRef.current;

        if (current !== null) {
          let toIdx = current;
          if (fromIdx < toIdx) toIdx -= 1;
          if (fromIdx !== toIdx) {
            setDraft(prev => {
              const steps = [...prev.steps];
              const [moved] = steps.splice(fromIdx, 1);
              steps.splice(toIdx, 0, moved);
              return { ...prev, steps };
            });
            setDirty(true);
          }
        }
      }

      dragFromRef.current = null;
      draggingRef.current = false;
      setDrop(null);
      setDragIdx(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  return (
    <TooltipProvider>
    <div style={{ width: '100%', maxWidth: 720, margin: '0 auto', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <input
          style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', background: 'transparent', border: 'none', outline: 'none', padding: 0, width: '100%', letterSpacing: '-0.01em', fontFamily: 'inherit' }}
          value={draft.name}
          placeholder="Macro Name"
          onChange={e => update({ name: e.target.value })}
        />
        <div style={{ display: 'flex', gap: 12, marginLeft: 16, flexShrink: 0 }}>
          {dirty && (
            <Button size="sm" variant="primary" onClick={handleSave} style={{ fontSize: 12 }}>
              Save
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleDelete} style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            Delete
          </Button>
        </div>
      </div>

      {/* ── Trigger ── */}
      <Section title="Trigger" first>
        {(draft.trigger.trigger_sets || []).map((chord, chordIdx) => (
          <div key={chordIdx} style={{ marginBottom: 12, paddingBottom: 12, ...(chordIdx < (draft.trigger.trigger_sets?.length ?? 1) - 1 ? { borderBottom: '1px solid var(--border-subtle)' } : {}) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              {chordIdx > 0 && <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 24, textAlign: 'center' }}>OR</span>}
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', minWidth: 48 }}>{chordIdx === 0 ? 'Hotkey:' : ''}</span>

              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                {chord.map((vk, vkIdx) => {
                  const gpBtn = getGamepadButton(vk);
                  if (gpBtn) {
                    return (
                      <img
                        key={vkIdx}
                        src={`/gamepad/${gpBtn.img}`}
                        alt={gpBtn.name}
                        title={`${gpBtn.name} (click to remove)`}
                        style={{ width: 36, height: 36, cursor: 'pointer', filter: 'brightness(0.9)', opacity: 0.9 }}
                        onClick={() => {
                          const newChord = chord.filter((_, i) => i !== vkIdx);
                          const newSets = [...draft.trigger.trigger_sets];
                          if (newChord.length === 0) { newSets.splice(chordIdx, 1); }
                          else { newSets[chordIdx] = newChord; }
                          update({ trigger: { ...draft.trigger, trigger_sets: newSets } });
                        }}
                      />
                    );
                  }
                  return <Keycap key={vkIdx} vk={vk} />;
                })}
                {chord.length > 1 && chord.some(v => isGamepadVk(v)) && chord.some(v => !isGamepadVk(v)) && (
                  <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 600 }}>COMBO</span>
                )}
                {chord.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>No keys set</span>}
              </div>

              <HotkeyRecorder
                onCapture={(keys: number[]) => {
                  const newSets = [...draft.trigger.trigger_sets];
                  newSets[chordIdx] = keys;
                  update({ trigger: { ...draft.trigger, trigger_sets: newSets } });
                }}
              />

              {(draft.trigger.trigger_sets || []).length > 1 && (
                <Button variant="ghost" size="icon-xs" style={{ color: 'var(--text-tertiary)' }}
                  onClick={() => {
                    const newSets = draft.trigger.trigger_sets.filter((_, i) => i !== chordIdx);
                    update({ trigger: { ...draft.trigger, trigger_sets: newSets } });
                  }}
                >
                  <X size={10} />
                </Button>
              )}
            </div>
          </div>
        ))}

        <Button variant="ghost" size="sm" style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, gap: 4 }}
          onClick={() => {
            const newSets = [...(draft.trigger.trigger_sets || []), []];
            update({ trigger: { ...draft.trigger, trigger_sets: newSets } });
          }}
        >
          + Add OR trigger
        </Button>

        {conflicts.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--warning)', background: 'rgba(210,153,34,0.1)', border: '1px solid rgba(210,153,34,0.2)', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
            <AlertTriangle size={14} />
            <span>Hotkey conflict with: <strong>{conflicts.join(', ')}</strong></span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
          <Switch
            checked={draft.trigger.passthrough}
            onCheckedChange={v => update({ trigger: { ...draft.trigger, passthrough: v } })}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 2 }}>Passthrough</label>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.4, display: 'block' }}>
              {draft.trigger.passthrough
                ? 'Key press is forwarded to the active app and fires the macro'
                : "Key press is intercepted — only the macro fires, apps won't receive the input"}
            </span>
            {(draft.trigger.trigger_sets || []).some(c => c.some(v => isGamepadVk(v))) && (
              <span style={{ display: 'block', fontSize: 11, color: 'var(--warning)', lineHeight: 1.4, marginTop: 4 }}>
                Gamepad buttons always pass through (XInput is read-only). This toggle only affects keyboard keys.
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Mode</label>
            <Select value={draft.trigger.mode} onValueChange={v => update({ trigger: { ...draft.trigger, mode: v as MacroDef['trigger']['mode'] } })}>
              <SelectTrigger style={{ width: 160, height: 32, fontSize: 13 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIGGER_MODES.map(m => <SelectItem key={m.value} value={m.value} style={{ fontSize: 13 }}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {draft.trigger.mode === 'double_tap' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Timeout (ms)</label>
              <Input type="number" style={{ width: 100, height: 32, fontSize: 13 }}
                value={draft.trigger.timeout_ms}
                onChange={e => update({ trigger: { ...draft.trigger, timeout_ms: Number(e.target.value) } })} />
            </div>
          )}

          {draft.trigger.mode === 'long_press' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Hold Time (ms)</label>
              <Input type="number" style={{ width: 100, height: 32, fontSize: 13 }}
                value={draft.trigger.long_press_ms}
                onChange={e => update({ trigger: { ...draft.trigger, long_press_ms: Number(e.target.value) } })} />
            </div>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8, display: 'block', lineHeight: 1.4 }}>{TRIGGER_DESC[draft.trigger.mode]}</span>
      </Section>

      {/* ── Execution ── */}
      <Section title="Execution">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Mode</label>
            <Select value={draft.execution.mode} onValueChange={v => update({ execution: { ...draft.execution, mode: v as MacroDef['execution']['mode'] } })}>
              <SelectTrigger style={{ width: 160, height: 32, fontSize: 13 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXEC_MODES.map(m => <SelectItem key={m.value} value={m.value} style={{ fontSize: 13 }}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Output</label>
            <Select value={draft.output_mode} onValueChange={v => update({ output_mode: v as MacroDef['output_mode'] })}>
              <SelectTrigger style={{ width: 160, height: 32, fontSize: 13 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTPUT_MODES.map(m => <SelectItem key={m.value} value={m.value} style={{ fontSize: 13 }}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {draft.execution.mode === 'continuous' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Tick Rate (ms)</label>
              <Input type="number" style={{ width: 100, height: 32, fontSize: 13 }}
                value={draft.execution.rate_ms}
                onChange={e => update({ execution: { ...draft.execution, rate_ms: Number(e.target.value) } })} />
            </div>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block', lineHeight: 1.4 }}>{EXEC_DESC[draft.execution.mode]}</span>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block', lineHeight: 1.4, marginTop: 4 }}>{OUTPUT_DESC[draft.output_mode]}</span>

        {/* Continuous Pattern Config */}
        {draft.execution.mode === 'continuous' && (
          <div style={{ marginTop: 20, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Pattern</label>
              <Select value={draft.execution.pattern} onValueChange={v => update({ execution: { ...draft.execution, pattern: v as 'key_cycle' | 'mouse_oscillate' } })}>
                <SelectTrigger style={{ width: 180, height: 32, fontSize: 13 }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PATTERN_MODES.map(m => <SelectItem key={m.value} value={m.value} style={{ fontSize: 13 }}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block', marginBottom: 12 }}>{PATTERN_DESC[draft.execution.pattern]}</span>

            {draft.execution.pattern === 'key_cycle' && (
              <div style={{ marginTop: 16, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 12, display: 'block' }}>Cycle Keys</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  {draft.execution.cycle_keys.map((vk, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Keycap vk={vk} />
                      <Button variant="ghost" size="icon-xs" title="Remove" style={{ color: 'var(--text-tertiary)' }}
                        onClick={() => {
                          const keys = [...draft.execution.cycle_keys];
                          keys.splice(i, 1);
                          update({ execution: { ...draft.execution, cycle_keys: keys } });
                        }}>
                        <X size={10} />
                      </Button>
                    </div>
                  ))}
                  <KeyCapture vk={0} label=""
                    onChange={(vk) => {
                      if (vk === 0) return;
                      update({ execution: { ...draft.execution, cycle_keys: [...draft.execution.cycle_keys, vk] } });
                    }} />
                </div>
              </div>
            )}

            {draft.execution.pattern === 'mouse_oscillate' && (
              <div style={{ marginTop: 16, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 12, display: 'block' }}>Mouse Oscillation</label>

                {/* Preview */}
                <div style={{ background: 'var(--bg-base)', borderRadius: 8, padding: 10, marginBottom: 12, border: '1px solid var(--border)' }}>
                  <svg viewBox="0 0 240 120" style={{ width: '100%', height: 170, display: 'block' }}>
                    {(() => {
                      const W = 240, H = 120;
                      const amp = Math.abs(draft.execution.amplitude || 0);
                      const comp = draft.execution.vertical_comp ?? 0;
                      const steps = 10;
                      const maxSpread = 80;
                      const xSpread = amp > 0 ? Math.min(amp / 50 * maxSpread, maxSpread) : 2;
                      const driftPerStep = comp !== 0 ? Math.min(Math.abs(comp) / 20 * 3, 5) * (comp < 0 ? 1 : -1) : 0;
                      const cx = W / 2;
                      const padTop = 14, padBot = 14;
                      const usableH = H - padTop - padBot;
                      const stepH = usableH / (steps - 1);
                      const pts: [number, number][] = [];
                      for (let i = 0; i < steps; i++) {
                        const px = cx + (i % 2 === 0 ? -xSpread : xSpread);
                        const py = padTop + i * stepH + i * driftPerStep;
                        pts.push([px, Math.max(padTop, Math.min(py, H - padBot))]);
                      }
                      const gridDots: React.ReactElement[] = [];
                      const gridSpace = 20;
                      for (let gx = gridSpace; gx < W; gx += gridSpace) {
                        for (let gy = gridSpace; gy < H; gy += gridSpace) {
                          gridDots.push(<circle key={`${gx}-${gy}`} cx={gx} cy={gy} r="0.6" fill="var(--text-tertiary)" opacity="0.2" />);
                        }
                      }
                      return (
                        <>
                          {gridDots}
                          <line x1={cx} y1="0" x2={cx} y2={H} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,4" />
                          {amp > 0 && (
                            <>
                              <line x1={cx - xSpread} y1="0" x2={cx - xSpread} y2={H} stroke="var(--accent)" strokeWidth="0.3" opacity="0.15" />
                              <line x1={cx + xSpread} y1="0" x2={cx + xSpread} y2={H} stroke="var(--accent)" strokeWidth="0.3" opacity="0.15" />
                              <text x={cx - xSpread} y={H - 3} fill="var(--accent)" fontSize="7" fontFamily="var(--font-mono)" textAnchor="middle" opacity="0.5">−{amp}</text>
                              <text x={cx + xSpread} y={H - 3} fill="var(--accent)" fontSize="7" fontFamily="var(--font-mono)" textAnchor="middle" opacity="0.5">+{amp}</text>
                            </>
                          )}
                          <polyline fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" opacity="0.9" points={pts.map(p => `${p[0]},${p[1]}`).join(' ')} />
                          {pts.map((p, i) => (
                            <circle key={i} cx={p[0]} cy={p[1]} r={i === 0 ? 3 : 1.5} fill={i === 0 ? 'var(--accent)' : 'rgba(45,212,191,0.5)'} />
                          ))}
                          {comp !== 0 && (
                            <text x="4" y="11" fill="var(--warning)" fontSize="7" fontFamily="var(--font-mono)" opacity="0.8">
                              recoil {comp < 0 ? '↓' : '↑'} {Math.abs(comp)}px/tick
                            </text>
                          )}
                          {amp === 0 && comp === 0 && (
                            <text x={cx} y={H / 2 + 3} fill="var(--text-tertiary)" fontSize="8" fontFamily="var(--font-mono)" textAnchor="middle" opacity="0.4">
                              set values to preview
                            </text>
                          )}
                        </>
                      );
                    })()}
                  </svg>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>X Jitter (px)</label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info size={12} style={{ color: 'var(--text-tertiary)', cursor: 'help' }} />
                        </TooltipTrigger>
                        <TooltipContent side="top" style={{ maxWidth: 200, fontSize: 12 }}>
                          Oscillates mouse left/right each tick. Value of 26 → moves +26px then −26px alternating.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input type="number" style={{ width: 80, height: 32, fontSize: 13 }}
                      value={draft.execution.amplitude} min={0}
                      onChange={e => update({ execution: { ...draft.execution, amplitude: Number(e.target.value) } })} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Recoil Comp (px)</label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info size={12} style={{ color: 'var(--text-tertiary)', cursor: 'help' }} />
                        </TooltipTrigger>
                        <TooltipContent side="top" style={{ maxWidth: 200, fontSize: 12 }}>
                          Applies a constant vertical pull each tick. Negative = pulls aim downward (recoil compensation). Positive = pulls aim upward.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input type="number" style={{ width: 80, height: 32, fontSize: 13 }}
                      value={draft.execution.vertical_comp}
                      onChange={e => update({ execution: { ...draft.execution, vertical_comp: Number(e.target.value) } })} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ── Steps ── */}
      <Section title={`Steps (${draft.steps.length})`}>
        {draft.steps.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '16px 0' }}>
            No steps defined. Add steps below or record a sequence.
          </div>
        ) : (
          <>
            {draft.execution.mode === 'timeline' && (
              <TimelineView
                steps={draft.steps}
                selectedStep={null}
                onSelectStep={() => {}}
                onOffsetChange={(idx, newOffset) => {
                  const steps = [...draft.steps];
                  const step = { ...steps[idx] } as any;
                  step.offset_us = newOffset;
                  steps[idx] = step;
                  update({ steps });
                }}
              />
            )}
            <div ref={listRef} style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
              {draft.steps.map((step, idx) => (
                <div key={`step-wrapper-${idx}`} style={{ position: 'relative', borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
                  {dropIndicator === idx && dragIdx !== null && dragIdx !== idx && (
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'var(--accent)', zIndex: 20 }} />
                  )}
                  <StepRow
                    idx={idx}
                    isCollapsed={stepIsCollapsed(step, idx)}
                    isDragging={dragIdx === idx}
                    onPointerDown={handlePointerDown(idx)}
                    stepTypeName={stepTypeName(step)}
                    stepKeysNode={stepKeys(step, idx)}
                    stepDetailText={stepDetail(step)}
                    onDuplicate={() => duplicateStep(idx)}
                    onRemove={() => removeStep(idx)}
                    timingContent={
                      (step.type === 'Delay' || step.type === 'KeyHold' || step.type === 'MouseHold' || step.type === 'KeySequence') ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 8px' }}>
                          {step.type === 'Delay' && <TimingField label="Duration" value={step.ms} unit="ms" onChange={v => updateStep(idx, { ...step, ms: v })} />}
                          {step.type === 'KeyHold' && <TimingField label="Duration" value={step.duration_ms} unit="ms" onChange={v => updateStep(idx, { ...step, duration_ms: v })} />}
                          {step.type === 'MouseHold' && <TimingField label="Duration" value={step.duration_ms} unit="ms" onChange={v => updateStep(idx, { ...step, duration_ms: v })} />}
                          {step.type === 'KeySequence' && <TimingField label="Per Key" value={step.per_key_delay_ms} unit="ms" onChange={v => updateStep(idx, { ...step, per_key_delay_ms: v })} />}
                        </div>
                      ) : null
                    }
                  />
                  {dropIndicator === idx + 1 && idx === draft.steps.length - 1 && dragIdx !== null && (
                    <div style={{ height: 2, background: 'var(--accent)' }} />
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Delay presets */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Quick delay:</span>
          {DELAY_PRESETS.map(ms => (
            <Button key={ms} variant="ghost" size="xs" style={{ fontSize: 10, color: 'var(--text-secondary)' }}
              onClick={() => addDelayPreset(ms)}>
              {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
            </Button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24, marginBottom: 12 }}>
          <RecordingPanel
            stopKey={config.settings.stop_key}
            countdownSecs={config.settings.recording_countdown_secs}
            onAccept={(steps) => update({ steps: [...draft.steps, ...steps] })}
            onClose={() => {}}
          />
        </div>

        <div style={{ marginTop: 32, borderTop: '1px solid var(--border)', paddingTop: 24 }}>
          <StepAdder onAdd={addStep} />
        </div>
      </Section>
    </div>
    </TooltipProvider>
  );
}

/** Step row — inline styled */
function StepRow({ idx, isCollapsed, isDragging, onPointerDown, stepTypeName, stepKeysNode, stepDetailText, onDuplicate, onRemove, timingContent }: {
  idx: number; isCollapsed: boolean; isDragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  stepTypeName: string; stepKeysNode: React.ReactNode; stepDetailText: string;
  onDuplicate: () => void; onRemove: () => void; timingContent: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  if (isCollapsed) return null;

  return (
    <div
      data-step-idx={idx}
      style={{
        display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 10,
        background: hovered ? 'var(--bg-surface-hover)' : 'var(--bg-surface)',
        transition: 'background-color 100ms',
        ...(isDragging ? { opacity: 0.4, transform: 'scale(0.95)' } : {}),
      }}
      onPointerDown={onPointerDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', minWidth: 0 }}>
        <span style={{ color: 'var(--text-tertiary)', cursor: 'grab', flexShrink: 0 }} title="Drag to reorder"><GripVertical size={14} /></span>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', width: 16, textAlign: 'center', flexShrink: 0 }}>{idx + 1}</span>
        <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--text-primary)', minWidth: 70, flexShrink: 0 }}>{stepTypeName}</span>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, overflow: 'hidden' }}>
          <div style={{ flexShrink: 0 }}>{stepKeysNode}</div>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{stepDetailText}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, opacity: hovered ? 1 : 0, transition: 'opacity 100ms' }}>
          <Button variant="ghost" size="icon-xs" title="Duplicate" onClick={onDuplicate} style={{ color: 'var(--text-tertiary)' }}>
            <Copy size={12} />
          </Button>
          <Button variant="ghost" size="icon-xs" title="Remove" onClick={onRemove} style={{ color: 'var(--text-tertiary)' }}>
            <X size={12} />
          </Button>
        </div>
      </div>
      {timingContent}
    </div>
  );
}

/** Section heading — flat Raycast-style with border-t separator */
function Section({ title, children, first }: { title: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div style={{
      marginBottom: 32,
      ...(first ? {} : { borderTop: '1px solid var(--border)', paddingTop: 24 }),
    }}>
      <div style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

/** Compact inline timing field */
function TimingField({ label, value, unit, onChange }: {
  label: string; value: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{label}</span>
      <input
        type="number"
        style={{
          width: 64, height: 20, fontSize: 10, fontFamily: 'var(--font-mono)',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '0 4px', color: 'var(--text-primary)', outline: 'none',
        }}
        value={value}
        min={0}
        onChange={e => onChange(Number(e.target.value))}
        onClick={e => e.stopPropagation()}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
      />
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{unit}</span>
    </div>
  );
}
