/** TimelineView — Visual bar chart for timeline-mode macro steps */

import { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import type { StepDef } from '../types/config';
import { vkName } from '../hooks/useTauri';
import { Button } from './primitives/Button';
import { Minus, Plus } from 'lucide-react';

/* ── Step type → color mapping ── */
const STEP_COLORS: Record<string, string> = {
  KeyTap: '#2dd4bf',
  KeyHold: '#22d3ee',
  KeyRelease: '#a78bfa',
  KeySequence: '#818cf8',
  MouseClick: '#f472b6',
  MouseHold: '#fb7185',
  MouseRelease: '#e879f9',
  MouseMoveRelative: '#fbbf24',
  MouseMoveAbsolute: '#f59e0b',
  MouseAbsoluteClick: '#fb923c',
  MouseSteppedDeltaClick: '#f97316',
  MouseScroll: '#34d399',
  Delay: '#64748b',
  RepeatBlock: '#94a3b8',
  Label: '#475569',
  CancelAll: '#ef4444',
};

function stepLabel(step: StepDef, nameCache: Map<number, string>): string {
  switch (step.type) {
    case 'KeyTap':
    case 'KeyHold':
    case 'KeyRelease': {
      const name = nameCache.get(step.key) ?? `0x${step.key.toString(16).toUpperCase()}`;
      return step.type.replace('Key', '') + ` ${name}`;
    }
    case 'Delay':
      return `${step.ms}ms`;
    case 'MouseClick':
    case 'MouseHold':
    case 'MouseRelease':
      return step.type.replace('Mouse', '') + ` ${step.button}`;
    case 'Label':
      return step.text || '—';
    default:
      return step.type.replace(/([A-Z])/g, ' $1').trim();
  }
}

interface TimelineViewProps {
  steps: StepDef[];
  onOffsetChange: (stepIdx: number, newOffsetUs: number) => void;
  selectedStep: number | null;
  onSelectStep: (idx: number) => void;
}

const MARKER_HEIGHT = 20;
const MIN_MARKER_W = 6;
const LABEL_MIN_W = 50;
const PADDING_LEFT = 8;
const PADDING_RIGHT = 16;
const ROW_GAP = 2;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 20;
const ZOOM_STEP = 1.2;

export function TimelineView({ steps, onOffsetChange, selectedStep, onSelectStep }: TimelineViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [vkNameCache, setVkNameCache] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    const vks = new Set<number>();
    for (const s of steps) {
      if ('key' in s && typeof (s as any).key === 'number') vks.add((s as any).key);
    }
    if (vks.size === 0) return;

    let cancelled = false;
    Promise.all([...vks].map(async vk => {
      try { return [vk, await vkName(vk)] as const; }
      catch { return [vk, `0x${vk.toString(16).toUpperCase()}`] as const; }
    })).then(entries => {
      if (!cancelled) setVkNameCache(new Map(entries));
    });
    return () => { cancelled = true; };
  }, [steps]);

  const { maxUs, timeScale } = useMemo(() => {
    if (steps.length === 0) return { maxUs: 1_000_000, timeScale: 1 };
    const offsets = steps.map(s => ('offset_us' in s ? (s as any).offset_us as number : 0));
    const rawMax = Math.max(...offsets, 1000);
    const max = Math.ceil(rawMax * 1.2);
    const containerW = containerRef.current?.clientWidth ?? 600;
    const usableW = containerW - PADDING_LEFT - PADDING_RIGHT;
    const baseScale = usableW / max;
    return { maxUs: max, timeScale: baseScale * zoom };
  }, [steps, zoom, containerRef.current?.clientWidth]);

  const innerWidth = PADDING_LEFT + maxUs * timeScale + PADDING_RIGHT;

  const ticks = useMemo(() => {
    const visibleW = containerRef.current?.clientWidth ?? 600;
    const targets = [10, 50, 100, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
    const idealCount = Math.max(4, Math.min(20, Math.floor(visibleW / 60)));
    const interval = targets.find(t => maxUs / t <= idealCount) ?? Math.ceil(maxUs / idealCount);

    const result: number[] = [];
    for (let t = 0; t <= maxUs; t += interval) {
      result.push(t);
    }
    return result;
  }, [maxUs, zoom]);

  const rowAssignments = useMemo(() => {
    type MarkerInfo = { idx: number; x: number; w: number };
    const markers: MarkerInfo[] = steps.map((step, idx) => {
      const offset = ('offset_us' in step ? (step as any).offset_us : 0) as number;
      const x = PADDING_LEFT + offset * timeScale;
      const label = stepLabel(step, vkNameCache);
      const w = Math.max(MIN_MARKER_W, label.length > 3 ? LABEL_MIN_W : 24);
      return { idx, x, w };
    });

    const sorted = [...markers].sort((a, b) => a.x - b.x);
    const rows: number[] = new Array(steps.length).fill(0);
    const rowEnds: number[] = [];

    for (const m of sorted) {
      let placed = false;
      for (let r = 0; r < rowEnds.length; r++) {
        if (m.x >= rowEnds[r] + 4) {
          rows[m.idx] = r;
          rowEnds[r] = m.x + m.w;
          placed = true;
          break;
        }
      }
      if (!placed) {
        rows[m.idx] = rowEnds.length;
        rowEnds.push(m.x + m.w);
      }
    }

    return { rows, rowCount: Math.max(rowEnds.length, 1) };
  }, [steps, timeScale]);

  const trackHeight = rowAssignments.rowCount * (MARKER_HEIGHT + ROW_GAP) + ROW_GAP;

  function formatUs(us: number): string {
    if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(1)}s`;
    if (us >= 1_000) return `${(us / 1_000).toFixed(1)}ms`;
    return `${us}µs`;
  }

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(prev => {
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev * factor));
    });
  }, []);

  const handleDragStart = (idx: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const step = steps[idx] as any;
    const startOffset = step.offset_us ?? 0;

    const onMove = (me: PointerEvent) => {
      const dx = me.clientX - startX;
      const deltaUs = dx / timeScale;
      const newOffset = Math.max(0, Math.round(startOffset + deltaUs));
      onOffsetChange(idx, newOffset);
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  if (steps.length === 0) return null;

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        marginBottom: 20,
        overflow: 'hidden',
      }}
    >
      {/* Zoom controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(28, 33, 41, 0.5)',
      }}>
        <Button variant="ghost" size="icon-xs" style={{ color: 'var(--text-secondary)' }}
          onClick={() => setZoom(prev => Math.max(MIN_ZOOM, prev / ZOOM_STEP))}>
          <Minus size={10} />
        </Button>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', minWidth: 36, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(zoom * 100)}%
        </span>
        <Button variant="ghost" size="icon-xs" style={{ color: 'var(--text-secondary)' }}
          onClick={() => setZoom(prev => Math.min(MAX_ZOOM, prev * ZOOM_STEP))}>
          <Plus size={10} />
        </Button>
        <Button variant="ghost" size="xs" style={{ fontSize: 9, color: 'var(--text-secondary)', marginLeft: 4 }}
          onClick={() => setZoom(1)}>
          Fit
        </Button>
      </div>

      <div style={{ overflowX: 'auto', padding: '4px 8px' }}>
        <div style={{ width: innerWidth, minWidth: '100%' }}>
          {/* Tick marks */}
          <div style={{ position: 'relative', height: 20, borderBottom: '1px solid var(--border)' }}>
            {ticks.map(t => (
              <div
                key={t}
                style={{
                  position: 'absolute',
                  top: 0,
                  height: '100%',
                  borderLeft: '1px solid var(--border)',
                  left: PADDING_LEFT + t * timeScale,
                }}
              >
                <span style={{
                  position: 'absolute',
                  bottom: -14,
                  left: 2,
                  fontSize: 8,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-tertiary)',
                }}>
                  {formatUs(t)}
                </span>
              </div>
            ))}
          </div>

          {/* Step markers */}
          <div style={{ position: 'relative', marginTop: 20, height: trackHeight }}>
            {steps.map((step, idx) => {
              const offset = ('offset_us' in step ? (step as any).offset_us : 0) as number;
              const color = STEP_COLORS[step.type] ?? '#64748b';
              const x = PADDING_LEFT + offset * timeScale;
              const label = stepLabel(step, vkNameCache);
              const isSelected = selectedStep === idx;
              const width = Math.max(MIN_MARKER_W, label.length > 3 ? LABEL_MIN_W : 24);
              const row = rowAssignments.rows[idx];
              const top = ROW_GAP + row * (MARKER_HEIGHT + ROW_GAP);

              return (
                <div
                  key={idx}
                  style={{
                    position: 'absolute',
                    borderRadius: 4,
                    cursor: 'grab',
                    fontSize: 9,
                    fontFamily: 'var(--font-mono)',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    transition: 'box-shadow 100ms',
                    left: x,
                    width,
                    height: MARKER_HEIGHT,
                    backgroundColor: color,
                    top,
                    opacity: 0.9,
                    ...(isSelected ? { boxShadow: '0 0 0 2px rgba(255,255,255,0.4)' } : {}),
                  }}
                  title={`#${idx + 1} ${step.type} @ ${formatUs(offset)}`}
                  onClick={() => onSelectStep(idx)}
                  onPointerDown={handleDragStart(idx)}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 4px' }}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
