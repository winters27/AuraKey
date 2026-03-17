/** MacroEditor — Main panel for editing a macro */

import { useState, useEffect, useRef } from 'react';
import type { AppConfig, MacroDef, MacroSelection, StepDef } from '../types/config';
import { getGamepadButton } from '../types/config';
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
  { value: 'hold', label: 'Hold Down' },
  { value: 'toggle', label: 'Toggle On / Off' },
  { value: 'double_tap', label: 'Double Tap' },
  { value: 'long_press', label: 'Long Press' },
  { value: 'release', label: 'Key Up' },
];

const TRIGGER_DESC: Record<string, string> = {
  press: 'Fires the macro once when the key is pressed',
  hold: 'Repeats the pattern below while held, stops on release',
  toggle: 'First press starts the pattern below, second press stops it',
  double_tap: 'Fires only on a quick double-press within the timeout window',
  long_press: 'Fires when the key is held past the threshold, ignored on quick taps',
  release: 'Fires when the key is released instead of pressed',
};

const EXEC_MODES = [
  { value: 'sequential', label: 'In Order' },
  { value: 'timeline', label: 'Timed' },
];

const EXEC_DESC: Record<string, string> = {
  sequential: 'Steps run one after another in order',
  timeline: 'Steps fire at specific time offsets — multiple can overlap',
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

  // ── Progressive disclosure: derive execution path from trigger mode ──
  const isContinuous = draft.trigger.mode === 'hold' || draft.trigger.mode === 'toggle';
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [addingAlternate, setAddingAlternate] = useState(false);
  const [rebindIdx, setRebindIdx] = useState<number | null>(null);

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

  // Full draft reset when switching to a different macro
  useEffect(() => {
    const p = config.profiles.find(pr => pr.name === config.active_profile) ?? config.profiles[0];
    const m = p?.groups[selection.groupIdx]?.macros[selection.macroIdx];
    if (m) {
      setDraft(structuredClone(m));
      setDirty(false);
    }
  }, [selection.groupIdx, selection.macroIdx]);

  // Merge external changes (e.g. sidebar toggle) without clobbering unsaved edits
  useEffect(() => {
    const p = config.profiles.find(pr => pr.name === config.active_profile) ?? config.profiles[0];
    const m = p?.groups[selection.groupIdx]?.macros[selection.macroIdx];
    if (!m) return;

    if (!dirty) {
      // No unsaved changes — safe to fully sync from server state
      setDraft(structuredClone(m));
    } else {
      // Unsaved changes exist — only merge fields that can change externally
      setDraft(d => ({ ...d, enabled: m.enabled }));
    }
  }, [config]);

  const update = (patch: Partial<MacroDef>) => {
    // Auto-sync execution.mode when trigger mode changes
    if (patch.trigger && patch.trigger.mode) {
      const newTriggerMode = patch.trigger.mode;
      const willBeContinuous = newTriggerMode === 'hold' || newTriggerMode === 'toggle';
      const wasContinuous = draft.trigger.mode === 'hold' || draft.trigger.mode === 'toggle';
      if (willBeContinuous && !wasContinuous) {
        // Switching TO continuous — set execution.mode for config consistency
        patch = { ...patch, execution: { ...draft.execution, ...patch.execution, mode: 'continuous' as any } };
      } else if (!willBeContinuous && wasContinuous) {
        // Switching FROM continuous — reset to sequential
        patch = { ...patch, execution: { ...draft.execution, ...patch.execution, mode: 'sequential' as any } };
      }
    }
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

  const stepSentenceNode = (step: StepDef, idx: number): { before: React.ReactNode; after: React.ReactNode } => {
    const N = (value: number, onChange: (v: number) => void) => (
      <input
        type="number"
        value={value}
        onChange={e => { const n = Number(e.target.value); if (!isNaN(n)) onChange(n); }}
        onClick={e => e.stopPropagation()}
        style={{
          width: 56, height: 26, fontSize: 12, textAlign: 'center',
          background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
          borderRadius: 4, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
          outline: 'none', padding: '0 4px',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
      />
    );
    const t = (s: string) => <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{s}</span>;

    switch (step.type) {
      case 'KeyTap': return { before: null, after: null };
      case 'KeyHold': return { before: null, after: <>{t('for')} {N(step.duration_ms, v => updateStep(idx, { ...step, duration_ms: v }))} {t('ms')}</> };
      case 'KeyRelease': return { before: null, after: null };
      case 'KeySequence': return { before: null, after: <>{t('with')} {N(step.per_key_delay_ms, v => updateStep(idx, { ...step, per_key_delay_ms: v }))} {t('ms gap')}</> };
      case 'MouseClick': return { before: <>{t(humanButton(step.button))}</>, after: null };
      case 'MouseHold': return { before: <>{t(humanButton(step.button))}</>, after: <>{t('for')} {N(step.duration_ms, v => updateStep(idx, { ...step, duration_ms: v }))} {t('ms')}</> };
      case 'MouseRelease': return { before: <>{t(humanButton(step.button))}</>, after: null };
      case 'MouseMoveRelative': return { before: null, after: <>{t('by')} {N(step.dx, v => updateStep(idx, { ...step, dx: v }))}{t(',')} {N(step.dy, v => updateStep(idx, { ...step, dy: v }))} {t('px' + (step.stepped ? ' stepped' : ''))}</> };
      case 'MouseMoveAbsolute': return { before: null, after: <>{N(step.x, v => updateStep(idx, { ...step, x: v }))}{t(',')} {N(step.y, v => updateStep(idx, { ...step, y: v }))}</> };
      case 'MouseAbsoluteClick': return { before: null, after: <>{N(step.x, v => updateStep(idx, { ...step, x: v }))}{t(',')} {N(step.y, v => updateStep(idx, { ...step, y: v }))} {t('with ' + humanButton(step.button))}</> };
      case 'MouseSteppedDeltaClick': return { before: null, after: <>{t('Δ')} {N(step.dx, v => updateStep(idx, { ...step, dx: v }))}{t(',')} {N(step.dy, v => updateStep(idx, { ...step, dy: v }))} {t('with ' + humanButton(step.button))}</> };
      case 'MouseScroll': return { before: null, after: <>{t(step.direction)} {N(step.amount, v => updateStep(idx, { ...step, amount: v }))} {t('notches')}</> };
      case 'Delay': return { before: null, after: <>{t('for')} {N(step.ms, v => updateStep(idx, { ...step, ms: v }))} {t('ms')}</> };
      case 'RepeatBlock': return { before: null, after: <>{t('last')} {N(step.step_count, v => updateStep(idx, { ...step, step_count: v }))} {t('steps ×')} {N(step.repeat_count, v => updateStep(idx, { ...step, repeat_count: v }))} {t('times')}</> };
      case 'Label': return { before: null, after: <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic', fontSize: 11 }}>{step.text || 'Empty label'}</span> };
      case 'CancelAll': return { before: null, after: <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>all macros</span> };
      case 'RunProgram': return { before: null, after: <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{step.command ? (step.command.split(/[\\\/]/).pop() || step.command) : 'No program set'}</span> };
    }
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
      <div style={{ marginBottom: 32, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <input
            style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', background: 'transparent', border: 'none', outline: 'none', padding: 0, width: '100%', letterSpacing: '-0.01em', fontFamily: 'inherit' }}
            value={draft.name}
            placeholder="Macro Name"
            onChange={e => update({ name: e.target.value })}
          />
        </div>
        {/* Output mode — cross-cutting, always visible */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Output via</span>
          {OUTPUT_MODES.map(m => (
            <button
              key={m.value}
              onClick={() => update({ output_mode: m.value as MacroDef['output_mode'] })}
              style={{
                fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                transition: 'all 120ms',
                background: draft.output_mode === m.value ? 'var(--accent)' : 'transparent',
                color: draft.output_mode === m.value ? 'var(--bg-base)' : 'var(--text-tertiary)',
              }}
            >
              {m.label}
            </button>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <Info size={11} style={{ color: 'var(--text-tertiary)', cursor: 'help' }} />
            </TooltipTrigger>
            <TooltipContent side="bottom" style={{ maxWidth: 240, fontSize: 11 }}>
              {OUTPUT_DESC[draft.output_mode]}
            </TooltipContent>
          </Tooltip>

          <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 4px' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Switch
              checked={draft.trigger.passthrough}
              onCheckedChange={v => update({ trigger: { ...draft.trigger, passthrough: v } })}
            />
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {draft.trigger.passthrough ? 'Key + macro both fire' : 'Only macro fires'}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info size={11} style={{ color: 'var(--text-tertiary)', cursor: 'help', marginLeft: 2 }} />
              </TooltipTrigger>
              <TooltipContent side="bottom" style={{ maxWidth: 240, fontSize: 11 }}>
                {draft.trigger.passthrough
                  ? 'The key press is sent to the active app AND the macro runs. Example: pressing Space will type a space and trigger the macro.'
                  : 'The key press is blocked from reaching apps — only the macro runs. Example: pressing Space won\'t type a space, it just triggers the macro.'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* ── Trigger ── */}
      <Section title="Activation Key" first>
        {/* All trigger sets inline — clickable to rebind */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minHeight: 36, marginBottom: 8 }}>
          {(draft.trigger.trigger_sets || []).map((chord, chordIdx) => (
            <div key={chordIdx} style={{ display: 'contents' }}>
              {chordIdx > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500, margin: '0 2px' }}>or</span>
              )}
              {rebindIdx === chordIdx ? (
                /* Recording inline — replaces the keycaps */
                <div style={{ display: 'inline-flex', minWidth: 180 }}>
                  <HotkeyRecorder
                    hasKeys={false}
                    autoStart
                    onCapture={(keys: number[]) => {
                      const newSets = [...draft.trigger.trigger_sets];
                      newSets[chordIdx] = keys;
                      update({ trigger: { ...draft.trigger, trigger_sets: newSets } });
                      setRebindIdx(null);
                    }}
                    onCancel={() => setRebindIdx(null)}
                  />
                </div>
              ) : chord.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic', cursor: 'pointer' }}
                  onClick={() => setRebindIdx(chordIdx)}>…</span>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', borderRadius: 6, padding: '2px 4px', position: 'relative', background: 'transparent' }}
                      onClick={() => setRebindIdx(chordIdx)}
                    >
                      {chord.map((vk, vkIdx) => {
                        const gpBtn = getGamepadButton(vk);
                        if (gpBtn) {
                          return (
                            <img key={`${chordIdx}-${vkIdx}`} src={`/gamepad/${gpBtn.img}`} alt={gpBtn.name}
                              style={{ width: 32, height: 32, filter: 'brightness(0.9)', opacity: 0.9, pointerEvents: 'none' }} />
                          );
                        }
                        return <Keycap key={`${chordIdx}-${vkIdx}`} vk={vk} size="lg" />;
                      })}
                      {(draft.trigger.trigger_sets || []).length > 1 && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            const newSets = draft.trigger.trigger_sets.filter((_, i) => i !== chordIdx);
                            update({ trigger: { ...draft.trigger, trigger_sets: newSets } });
                          }}
                          style={{
                            position: 'absolute', top: -6, right: -6,
                            width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '50%',
                            cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 10, lineHeight: 1,
                            transition: 'all 120ms', opacity: 0,
                          }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--error)'; e.currentTarget.style.borderColor = 'var(--error)'; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                          className="keybind-remove"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Click to rebind</TooltipContent>
                </Tooltip>
              )}
            </div>
          ))}

          {/* Add alternate — inline swap between + square and recorder */}
          {(draft.trigger.trigger_sets || []).some(c => c.length > 0) && (
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500, margin: '0 2px' }}>or</span>
          )}
          {addingAlternate ? (
            <div style={{ display: 'inline-flex', minWidth: 180 }}>
              <HotkeyRecorder
                hasKeys={false}
                autoStart
                onCapture={(keys: number[]) => {
                  const newSets = [...(draft.trigger.trigger_sets || []), keys];
                  update({ trigger: { ...draft.trigger, trigger_sets: newSets } });
                  setAddingAlternate(false);
                }}
                onCancel={() => setAddingAlternate(false)}
              />
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setAddingAlternate(true)}
                  style={{
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '1px dashed var(--border)', borderRadius: 6, background: 'transparent',
                    cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 14, fontWeight: 300,
                    transition: 'all 150ms', flexShrink: 0,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                >
                  +
                </button>
              </TooltipTrigger>
              <TooltipContent>Add alternate key</TooltipContent>
            </Tooltip>
          )}
        </div>

        {conflicts.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--warning)', background: 'rgba(210,153,34,0.1)', border: '1px solid rgba(210,153,34,0.2)', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
            <AlertTriangle size={14} />
            <span>Hotkey conflict with: <strong>{conflicts.join(', ')}</strong></span>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Activation Style</label>
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
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Window (ms)</label>
              <Input type="number" style={{ width: 100, height: 32, fontSize: 13 }}
                value={draft.trigger.timeout_ms}
                onChange={e => update({ trigger: { ...draft.trigger, timeout_ms: Number(e.target.value) } })} />
            </div>
          )}

          {draft.trigger.mode === 'long_press' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Threshold (ms)</label>
              <Input type="number" style={{ width: 100, height: 32, fontSize: 13 }}
                value={draft.trigger.long_press_ms}
                onChange={e => update({ trigger: { ...draft.trigger, long_press_ms: Number(e.target.value) } })} />
            </div>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8, display: 'block', lineHeight: 1.4 }}>{TRIGGER_DESC[draft.trigger.mode]}</span>
      </Section>

      {/* ── Action — branched by trigger mode ── */}
      {isContinuous ? (
        /* ═══ CONTINUOUS BRANCH (Hold / Toggle) ═══ */
        <Section title="What It Does">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Repeat Type</label>
              <Select value={draft.execution.pattern} onValueChange={v => update({ execution: { ...draft.execution, pattern: v as 'key_cycle' | 'mouse_oscillate' } })}>
                <SelectTrigger style={{ width: 180, height: 32, fontSize: 13 }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PATTERN_MODES.map(m => <SelectItem key={m.value} value={m.value} style={{ fontSize: 13 }}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Speed (ms)</label>
              <Input type="number" style={{ width: 100, height: 32, fontSize: 13 }}
                value={draft.execution.rate_ms}
                onChange={e => update({ execution: { ...draft.execution, rate_ms: Number(e.target.value) } })} />
            </div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block', marginBottom: 12 }}>{PATTERN_DESC[draft.execution.pattern]}</span>

          {/* Key Cycle config */}
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

          {/* Mouse Oscillate config */}
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
        </Section>
      ) : (
        /* ═══ ONE-SHOT BRANCH (Press / DoubleTap / LongPress / Release) ═══ */
        <>
          <Section title="What It Does">
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, marginBottom: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Run Style</label>
                <Select value={draft.execution.mode === 'continuous' ? 'sequential' : draft.execution.mode} onValueChange={v => update({ execution: { ...draft.execution, mode: v as MacroDef['execution']['mode'] } })}>
                  <SelectTrigger style={{ width: 160, height: 32, fontSize: 13 }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXEC_MODES.map(m => <SelectItem key={m.value} value={m.value} style={{ fontSize: 13 }}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block', lineHeight: 1.4 }}>{EXEC_DESC[draft.execution.mode] || EXEC_DESC['sequential']}</span>
          </Section>

          <Section title={`Steps (${draft.steps.length})`}>
            <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden', background: 'linear-gradient(137deg, #111214 4.87%, #0c0d0f 75.88%)', boxShadow: 'inset 0 1px 0 0 var(--border-highlight)' }}>
              {draft.steps.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '20px 16px', textAlign: 'center' }}>
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
                  <div ref={listRef}>
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
                          stepSentence={stepSentenceNode(step, idx)}
                          stepKeysNode={stepKeys(step, idx)}
                          onDuplicate={() => duplicateStep(idx)}
                          onRemove={() => removeStep(idx)}
                        />
                        {dropIndicator === idx + 1 && idx === draft.steps.length - 1 && dragIdx !== null && (
                          <div style={{ height: 2, background: 'var(--accent)' }} />
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Footer — Add Step + Record + Delay presets */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <StepAdder onAdd={addStep} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <RecordingPanel
                    stopKey={config.settings.stop_key}
                    countdownSecs={config.settings.recording_countdown_secs}
                    onAccept={(steps) => update({ steps: [...draft.steps, ...steps] })}
                    onClose={() => {}}
                  />
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)', margin: '0 4px' }}>·</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Quick delay:</span>
                  {DELAY_PRESETS.map(ms => (
                    <Button key={ms} variant="ghost" size="xs" style={{ fontSize: 10, color: 'var(--text-secondary)' }}
                      onClick={() => addDelayPreset(ms)}>
                      {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        </>
      )}

      {/* ── Danger Zone ── */}
      <div style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
        <Button variant="destructive" size="sm" onClick={handleDelete} style={{ fontSize: 12 }}>
          Delete Macro
        </Button>
      </div>
    </div>

      {/* ── Floating save/discard toast ── */}
      {dirty && (
        <div style={{
          position: 'fixed', bottom: 48, right: 48, zIndex: 100,
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '16px 24px',
          background: 'rgba(14, 15, 18, 0.55)',
          backdropFilter: 'blur(20px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.5)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.55), inset 0 1px 0 0 var(--border-highlight)',
          animation: 'slide-in-right 250ms var(--ease-out)',
        }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginRight: 6 }}>
            Unsaved changes
          </span>
          <Button variant="ghost" size="sm" onClick={() => {
            setDraft(structuredClone(originalMacro));
            setDirty(false);
          }} style={{ fontSize: 12, padding: '6px 14px' }}>
            Discard
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} style={{ fontSize: 12, padding: '6px 14px' }}>
            Save
          </Button>
        </div>
      )}
    </TooltipProvider>
  );
}

/** Step row — inline styled */
function StepRow({ idx, isCollapsed, isDragging, onPointerDown, stepTypeName, stepSentence, stepKeysNode, onDuplicate, onRemove }: {
  idx: number; isCollapsed: boolean; isDragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  stepTypeName: string; stepSentence: { before: React.ReactNode; after: React.ReactNode }; stepKeysNode: React.ReactNode;
  onDuplicate: () => void; onRemove: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  if (isCollapsed) return null;

  return (
    <div
      data-step-idx={idx}
      style={{
        display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 10,
        background: hovered ? 'rgba(255, 255, 255, 0.03)' : 'transparent',
        transition: 'background-color 100ms',
        ...(isDragging ? { opacity: 0.4, transform: 'scale(0.95)' } : {}),
      }}
      onPointerDown={onPointerDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 14px', minWidth: 0 }}>
        <span style={{ color: 'var(--text-tertiary)', cursor: 'grab', flexShrink: 0 }} title="Drag to reorder"><GripVertical size={14} /></span>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', width: 16, textAlign: 'center', flexShrink: 0 }}>{idx + 1}</span>
        <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent)', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{stepTypeName}</span>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden', flexWrap: 'wrap' }}>
          {stepSentence.before}
          {stepKeysNode && <div style={{ flexShrink: 0 }}>{stepKeysNode}</div>}
          {stepSentence.after}
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
    </div>
  );
}

/** Section heading — accent bar with clear visual hierarchy */
function Section({ title, children, first }: { title: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div style={{
      marginBottom: 32,
      ...(first ? {} : { borderTop: '1px solid var(--border)', paddingTop: 24 }),
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        marginBottom: 16,
        paddingLeft: 12,
        borderLeft: '2px solid rgba(45, 212, 191, 0.3)',
      }}>
        <span style={{
          fontSize: 13, fontWeight: 600, letterSpacing: '0.02em',
          color: 'var(--text-primary)',
        }}>
          {title}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

