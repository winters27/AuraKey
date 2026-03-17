/** RecordingPanel — Sequence recorder with live key feed + review */

import { useState, useEffect, useRef } from 'react';
import type { StepDef } from '../types/config';
import { startRecording, stopRecording, getRecordingResult, vkName } from '../hooks/useTauri';
import { Button } from './primitives/Button';
import { Circle, StopCircle, Loader2, Check, X } from 'lucide-react';

type RecordingState = 'idle' | 'countdown' | 'recording' | 'stopping' | 'review';

interface RecordingPanelProps {
  stopKey: number;
  countdownSecs: number;
  onAccept: (steps: StepDef[]) => void;
  onClose: () => void;
}

interface LiveEvent {
  id: number;
  type: 'down' | 'up' | 'click';
  label: string;
  time: number;
}

function extractSteps(result: unknown): StepDef[] | null {
  if (Array.isArray(result)) return result as StepDef[];
  if (result && typeof result === 'object' && 'steps' in result) return (result as any).steps as StepDef[];
  if (result && typeof result === 'object') {
    const vals = Object.values(result);
    if (vals.length > 0 && Array.isArray(vals[0])) return vals[0] as StepDef[];
  }
  return null;
}

export function RecordingPanel({ stopKey, countdownSecs, onAccept, onClose }: RecordingPanelProps) {
  const [state, setState] = useState<RecordingState>('idle');
  const [countdown, setCountdown] = useState(countdownSecs);
  const [elapsed, setElapsed] = useState(0);
  const [recordedSteps, setRecordedSteps] = useState<StepDef[]>([]);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const eventIdRef = useRef(0);
  const feedEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { feedEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [liveEvents]);

  useEffect(() => {
    if (state !== 'recording') return;
    startTimeRef.current = Date.now();

    const pushEvent = (type: LiveEvent['type'], label: string) => {
      const ev: LiveEvent = { id: eventIdRef.current++, type, label, time: Date.now() - startTimeRef.current };
      setLiveEvents(prev => [...prev, ev]);
    };

    const onKeyDown = async (e: KeyboardEvent) => { const name = await resolveKeyName(e.code); pushEvent('down', `⬇ ${name}`); };
    const onKeyUp = async (e: KeyboardEvent) => { const name = await resolveKeyName(e.code); pushEvent('up', `⬆ ${name}`); };
    const onMouseDown = (e: MouseEvent) => { const btn = ['Left', 'Middle', 'Right', 'Back', 'Forward'][e.button] ?? `Button ${e.button}`; pushEvent('click', `Mouse ${btn} ⬇ (${e.clientX}, ${e.clientY})`); };
    const onMouseUp = (e: MouseEvent) => { const btn = ['Left', 'Middle', 'Right', 'Back', 'Forward'][e.button] ?? `Button ${e.button}`; pushEvent('click', `Mouse ${btn} ⬆`); };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('mouseup', onMouseUp, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('mousedown', onMouseDown, { capture: true });
      window.removeEventListener('mouseup', onMouseUp, { capture: true });
    };
  }, [state]);

  const beginCountdown = () => { setError(''); setLiveEvents([]); setCountdown(countdownSecs); setState('countdown'); };

  useEffect(() => {
    if (state !== 'countdown') return;
    if (countdown <= 0) {
      startRecording(stopKey).then(() => { setState('recording'); setElapsed(0); }).catch(e => { setError(String(e)); setState('idle'); });
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [state, countdown, stopKey]);

  useEffect(() => {
    if (state !== 'recording') { if (timerRef.current) clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state]);

  const trimSteps = (steps: StepDef[]): StepDef[] => {
    if (steps.length === 0) return steps;
    const offsets = steps.map(s => ('offset_us' in s ? (s as any).offset_us as number : 0));
    const minOffset = Math.min(...offsets);
    let trimmed = steps.map(s => {
      if (!('offset_us' in s)) return s;
      const out = { ...s } as any;
      out.offset_us = Math.max(0, out.offset_us - minOffset);
      return out as StepDef;
    });
    while (trimmed.length > 0 && trimmed[trimmed.length - 1].type === 'Delay') {
      const last = trimmed[trimmed.length - 1];
      if (last.type === 'Delay' && last.ms > 200) trimmed = trimmed.slice(0, -1);
      else break;
    }
    return trimmed;
  };

  useEffect(() => {
    if (state !== 'recording' && state !== 'stopping') return;
    const poll = setInterval(async () => {
      try {
        const result = await getRecordingResult();
        if (result !== null && result !== undefined) {
          const steps = extractSteps(result);
          setRecordedSteps(trimSteps(steps ?? []));
          setState('review');
        }
      } catch { /* still waiting */ }
    }, 300);
    return () => clearInterval(poll);
  }, [state]);

  const handleStop = async () => {
    setState('stopping');
    try {
      await stopRecording();
      await new Promise(r => setTimeout(r, 200));
      const result = await getRecordingResult();
      if (result !== null && result !== undefined) {
        const steps = extractSteps(result);
        setRecordedSteps(trimSteps(steps ?? []));
        setState('review');
      }
    } catch (e) { setError(String(e)); setState('idle'); }
  };

  const handleAccept = () => { onAccept(recordedSteps); setRecordedSteps([]); setLiveEvents([]); setState('idle'); };
  const handleDiscard = () => { setRecordedSteps([]); setLiveEvents([]); setState('idle'); };
  const removeStep = (idx: number) => { setRecordedSteps(s => s.filter((_, i) => i !== idx)); };

  // ── Countdown ──
  if (state === 'countdown') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 0', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{countdown}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Get ready…</div>
        <Button variant="ghost" size="sm" onClick={() => setState('idle')} style={{ marginTop: 16, fontSize: 12 }}>Cancel</Button>
      </div>
    );
  }

  // ── Recording Active ──
  if (state === 'recording' || state === 'stopping') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--error)', animation: 'blink-rec 1s infinite' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{state === 'stopping' ? 'Stopping…' : 'Recording'}</span>
        </div>
        <div style={{ fontSize: 24, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', marginBottom: 16 }}>
          {Math.floor(elapsed / 60).toString().padStart(2, '0')}:{(elapsed % 60).toString().padStart(2, '0')}
        </div>

        {/* Live feed */}
        <div style={{ width: '100%', maxHeight: 140, overflowY: 'auto', padding: '0 16px', marginBottom: 12 }}>
          {liveEvents.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', padding: '12px 0' }}>Waiting for inputs…</div>
          ) : (
            liveEvents.slice(-20).map(ev => (
              <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '2px 0' }}>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {(ev.time / 1000).toFixed(1)}s
                </span>
                <span style={{ color: ev.type === 'down' ? 'var(--accent)' : ev.type === 'up' ? 'var(--text-secondary)' : 'var(--warning)' }}>
                  {ev.label}
                </span>
              </div>
            ))
          )}
          <div ref={feedEndRef} />
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 12 }}>Perform your inputs. Press the stop key or click below to finish.</div>
        <Button variant="destructive" size="sm" onClick={handleStop} disabled={state === 'stopping'} style={{ fontSize: 12, gap: 4 }}>
          {state === 'stopping'
            ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Stopping…</>
            : <><StopCircle size={12} /> Stop Recording</>}
        </Button>
      </div>
    );
  }

  // ── Review ──
  if (state === 'review') {
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Review Recording</h3>
          <span style={{ fontSize: 10, background: 'var(--bg-surface-hover)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', fontFamily: 'var(--font-mono)' }}>{recordedSteps.length} steps</span>
        </div>

        {/* Timing */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>Timing</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', width: 48 }}>Speed</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {[0.25, 0.5, 1, 1.5, 2, 4].map(s => (
                <Button key={s} variant="ghost" size="xs" style={{ fontSize: 10, color: 'var(--text-secondary)' }}
                  onClick={() => {
                    setRecordedSteps(prev => prev.map(step => {
                      const out = { ...step } as any;
                      if ('offset_us' in out) out.offset_us = Math.max(0, Math.round(out.offset_us / s));
                      if (step.type === 'Delay') out.ms = Math.max(0, Math.round(out.ms / s));
                      if ('duration_ms' in out) out.duration_ms = Math.max(0, Math.round(out.duration_ms / s));
                      return out;
                    }));
                  }}>{s}×</Button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', width: 48 }}>Delays</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {[10, 25, 50, 100, 250].map(ms => (
                <Button key={ms} variant="ghost" size="xs" style={{ fontSize: 10, color: 'var(--text-secondary)' }}
                  onClick={() => setRecordedSteps(prev => prev.map(step => step.type === 'Delay' ? { ...step, ms } : step))}>{ms}ms</Button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', width: 48 }}>Clean</label>
            <Button variant="ghost" size="xs" style={{ fontSize: 10, color: 'var(--text-secondary)' }}
              onClick={() => setRecordedSteps(prev => prev.filter(s => s.type !== 'Delay'))}>Strip delays</Button>
            <Button variant="ghost" size="xs" style={{ fontSize: 10, color: 'var(--text-secondary)' }}
              onClick={() => setRecordedSteps(prev => trimSteps(prev))}>Trim dead space</Button>
          </div>
        </div>

        {/* Steps */}
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {recordedSteps.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '16px 0', textAlign: 'center' }}>No events captured.</div>
          ) : (
            recordedSteps.map((step, idx) => (
              <ReviewStepRow key={idx} step={step} idx={idx} onRemove={() => removeStep(idx)} />
            ))
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
          <Button size="sm" variant="primary" onClick={handleAccept} style={{ fontSize: 12, gap: 4 }}>
            <Check size={12} /> Accept & Add Steps
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDiscard} style={{ fontSize: 12 }}>Discard</Button>
          <Button variant="ghost" size="sm" onClick={onClose} style={{ fontSize: 12 }}>Close</Button>
        </div>
      </div>
    );
  }

  // ── Idle ──
  return (
    <div>
      <Button variant="ghost" size="sm" onClick={beginCountdown} style={{ fontSize: 12, color: 'var(--text-secondary)', gap: 4, border: '1px solid var(--border)' }}>
        <Circle size={12} style={{ color: 'var(--error)' }} /> Record Sequence
      </Button>
      {error && <div style={{ fontSize: 12, color: 'var(--error)', background: 'rgba(248,81,73,0.1)', borderRadius: 4, padding: '6px 12px', marginTop: 8 }}>{error}</div>}
    </div>
  );
}

/** Individual review step row with hover */
function ReviewStepRow({ step, idx, onRemove }: { step: StepDef; idx: number; onRemove: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px',
        borderBottom: '1px solid var(--border-subtle)', fontSize: 12,
        background: hovered ? 'var(--bg-surface-hover)' : 'transparent',
        transition: 'background-color 100ms',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', width: 20, textAlign: 'right' }}>{idx + 1}</span>
      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontSize: 11 }}>{step.type}</span>
      <span style={{ color: 'var(--text-secondary)', flex: 1 }}>
        {step.type === 'Delay' ? `${step.ms}ms` :
         'offset_us' in step ? `${((step as any).offset_us / 1000).toFixed(1)}ms` : ''}
        {('duration_ms' in step && (step as any).duration_ms > 0) ? ` hold ${(step as any).duration_ms}ms` : ''}
      </span>
      <Button variant="ghost" size="icon-xs" onClick={onRemove} style={{ color: 'var(--text-tertiary)' }}>
        <X size={10} />
      </Button>
    </div>
  );
}

async function resolveKeyName(code: string): Promise<string> {
  const letterMatch = code.match(/^Key([A-Z])$/);
  if (letterMatch) {
    const vk = letterMatch[1].charCodeAt(0);
    try { return await vkName(vk); } catch { return letterMatch[1]; }
  }
  const map: Record<string, string> = {
    Space: 'Space', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab',
    Backspace: 'Backspace', Delete: 'Del', Insert: 'Ins',
    ShiftLeft: 'LShift', ShiftRight: 'RShift',
    ControlLeft: 'LCtrl', ControlRight: 'RCtrl',
    AltLeft: 'LAlt', AltRight: 'RAlt',
    MetaLeft: 'Win', MetaRight: 'Win',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
    CapsLock: 'Caps', NumLock: 'NumLock', ScrollLock: 'ScrLk',
  };
  if (map[code]) return map[code];
  const digitMatch = code.match(/^Digit(\d)$/);
  if (digitMatch) return digitMatch[1];
  const numpadMatch = code.match(/^Numpad(\d)$/);
  if (numpadMatch) return `Num${numpadMatch[1]}`;
  const fMatch = code.match(/^F(\d+)$/);
  if (fMatch) return `F${fMatch[1]}`;
  return code.replace(/^Key/, '');
}
