/** MacroList — Sidebar with search, groups, macros, drag-between-groups, import/export */

import type { AppConfig, MacroSelection } from '../types/config';
import { isGamepadVk, getGamepadButton } from '../types/config';
import { KeycapRow } from './Keycap';
import { createGroup, createMacro, toggleGroup, toggleMacroEnabled, moveMacro, importMacros, exportProfile, updateMacro } from '../hooks/useTauri';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useState, useRef, useEffect } from 'react';
import { Button } from './primitives/Button';
import { Input } from './primitives/Input';
import { Switch } from './primitives/Switch';
import { ScrollArea } from './primitives/ScrollArea';
import { X, Import, Upload, Plus } from 'lucide-react';

interface MacroListProps {
  config: AppConfig;
  selection: MacroSelection | null;
  onSelect: (sel: MacroSelection) => void;
  onConfigUpdate: (config: AppConfig) => void;
}

export function MacroList({ config, selection, onSelect, onConfigUpdate }: MacroListProps) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState('');
  const [dragOverGroup, setDragOverGroup] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const profile = config.profiles.find(p => p.name === config.active_profile)
    ?? config.profiles[0];

  if (!profile) return null;

  const handleToggleGroup = async (idx: number, enabled: boolean) => {
    const updated = await toggleGroup(idx, enabled);
    onConfigUpdate(updated);
  };

  const handleToggleMacro = async (gIdx: number, mIdx: number, enabled: boolean) => {
    const updated = await toggleMacroEnabled(gIdx, mIdx, enabled);
    onConfigUpdate(updated);
  };

  const handleCreateGroup = async () => {
    const name = prompt('Group name:');
    if (!name) return;
    const updated = await createGroup(name);
    onConfigUpdate(updated);
  };

  const handleCreateMacro = async (groupIdx: number) => {
    const name = prompt('Macro name:');
    if (!name) return;
    const updated = await createMacro(groupIdx, name);
    onConfigUpdate(updated);
  };

  const handleMacroDragStart = (e: React.DragEvent, gIdx: number, mIdx: number) => {
    e.dataTransfer.setData('application/aurakey-macro', JSON.stringify({ gIdx, mIdx }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleGroupDragOver = (e: React.DragEvent, gIdx: number) => {
    if (e.dataTransfer.types.includes('application/aurakey-macro')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverGroup(gIdx);
    }
  };

  const handleGroupDragLeave = () => { setDragOverGroup(null); };

  const handleGroupDrop = async (e: React.DragEvent, toGroup: number) => {
    e.preventDefault();
    setDragOverGroup(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/aurakey-macro'));
      if (data.gIdx === toGroup) return;
      const updated = await moveMacro(data.gIdx, data.mIdx, toGroup);
      onConfigUpdate(updated);
    } catch { /* invalid drop */ }
  };

  const handleImport = async () => {
    const file = await open({
      title: 'Import Macros',
      filters: [{ name: 'AuraKey Macros', extensions: ['akg', 'toml', 'json'] }],
      multiple: false,
    });
    if (!file) return;
    try {
      const updated = await importMacros(file);
      onConfigUpdate(updated);
    } catch (e: any) { alert(`Import failed: ${e}`); }
  };

  const handleExport = async () => {
    const file = await save({
      title: 'Export Profile',
      defaultPath: 'macros.akg',
      filters: [{ name: 'AuraKey Macros', extensions: ['akg'] }],
    });
    if (!file) return;
    try { await exportProfile(file); }
    catch (e: any) { alert(`Export failed: ${e}`); }
  };

  const startRename = (macro: { id: string; name: string }) => {
    setRenamingId(macro.id);
    setRenameValue(macro.name);
  };

  const commitRename = async (gIdx: number, mIdx: number) => {
    const trimmed = renameValue.trim();
    const macro = profile.groups[gIdx]?.macros[mIdx];
    if (!macro || !trimmed || trimmed === macro.name) { setRenamingId(null); return; }
    try {
      const updated = await updateMacro(gIdx, mIdx, { ...macro, name: trimmed });
      onConfigUpdate(updated);
    } catch (e) { console.error('Rename failed:', e); }
    setRenamingId(null);
  };

  const cancelRename = () => { setRenamingId(null); };

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const q = search.toLowerCase().trim();

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 10px',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Macros</span>
        <Button variant="ghost" size="xs" onClick={handleCreateGroup} style={{ fontSize: 11, gap: 4 }}>
          <Plus size={12} />Group
        </Button>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', padding: '6px 10px' }}>
        <Input
          placeholder="Search macros…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ height: 28, fontSize: 12, paddingRight: 28 }}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            style={{
              position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 2,
            }}
          >
            <X size={10} />
          </button>
        )}
      </div>

      {/* Groups & Macros */}
      <ScrollArea style={{ flex: 1 }}>
        <div style={{ paddingBottom: 8 }}>
          {profile.groups.map((group, gIdx) => {
            const isCollapsed = collapsed[gIdx] ?? false;

            const filteredMacros = q
              ? group.macros.map((m, mIdx) => ({ macro: m, mIdx }))
                  .filter(({ macro }) => macro.name.toLowerCase().includes(q))
              : group.macros.map((m, mIdx) => ({ macro: m, mIdx }));

            if (q && filteredMacros.length === 0) return null;

            return (
              <div
                key={`group-${gIdx}`}
                style={{
                  marginBottom: 4,
                  ...(dragOverGroup === gIdx ? { background: 'rgba(255,255,255,0.03)', borderRadius: 6 } : {}),
                }}
                onDragOver={e => handleGroupDragOver(e, gIdx)}
                onDragLeave={handleGroupDragLeave}
                onDrop={e => handleGroupDrop(e, gIdx)}
              >
                {/* Group Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    transition: 'color 120ms',
                  }}
                  onClick={() => setCollapsed(c => ({ ...c, [gIdx]: !isCollapsed }))}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
                >
                  <span style={{
                    fontSize: 10,
                    transition: 'transform 150ms',
                    transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                    display: 'inline-block',
                  }}>▸</span>
                  <span style={{ flex: 1 }}>{group.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{group.macros.length}</span>
                  <Switch
                    checked={group.enabled}
                    onCheckedChange={(checked) => handleToggleGroup(gIdx, checked)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ transform: 'scale(0.75)' }}
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => { e.stopPropagation(); handleCreateMacro(gIdx); }}
                    style={{}}
                  >
                    <Plus size={10} />
                  </Button>
                </div>

                {/* Macro Items */}
                {(!isCollapsed || q) && filteredMacros.map(({ macro, mIdx }) => {
                  const isActive = selection?.groupIdx === gIdx && selection?.macroIdx === mIdx;

                  return (
                    <MacroItem
                      key={macro.id}
                      macro={macro}
                      isActive={isActive}
                      isRenaming={renamingId === macro.id}
                      renameValue={renameValue}
                      renameInputRef={renameInputRef}
                      gIdx={gIdx}
                      mIdx={mIdx}
                      onSelect={() => onSelect({ groupIdx: gIdx, macroIdx: mIdx })}
                      onDragStart={e => handleMacroDragStart(e, gIdx, mIdx)}
                      onToggle={checked => handleToggleMacro(gIdx, mIdx, checked)}
                      onStartRename={() => startRename(macro)}
                      onRenameChange={v => setRenameValue(v)}
                      onCommitRename={() => commitRename(gIdx, mIdx)}
                      onCancelRename={cancelRename}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Import / Export */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
      }}>
        <Button variant="ghost" size="xs" onClick={handleImport} style={{ fontSize: 11, gap: 4 }}>
          <Import size={12} /> Import
        </Button>
        <Button variant="ghost" size="xs" onClick={handleExport} style={{ fontSize: 11, gap: 4 }}>
          <Upload size={12} /> Export
        </Button>
      </div>
    </div>
  );
}

/** Individual macro row — extracted to keep MacroList clean */
function MacroItem({ macro, isActive, isRenaming, renameValue, renameInputRef, gIdx: _gIdx, mIdx: _mIdx,
  onSelect, onDragStart, onToggle, onStartRename, onRenameChange, onCommitRename, onCancelRename,
}: {
  macro: any; isActive: boolean; isRenaming: boolean;
  renameValue: string; renameInputRef: React.RefObject<HTMLInputElement | null>;
  gIdx: number; mIdx: number;
  onSelect: () => void; onDragStart: (e: React.DragEvent) => void;
  onToggle: (v: boolean) => void; onStartRename: () => void;
  onRenameChange: (v: string) => void; onCommitRename: () => void; onCancelRename: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 12px 6px 24px',
        cursor: 'default',
        borderRadius: 6,
        position: 'relative',
        opacity: macro.enabled ? 1 : 0.45,
        transition: 'background-color 100ms',
        background: isActive ? 'rgba(255,255,255,0.04)' : hovered ? 'var(--bg-surface-hover)' : 'transparent',
      }}
      onClick={onSelect}
      draggable
      onDragStart={onDragStart}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Active indicator */}
      {isActive && (
        <div style={{
          position: 'absolute', left: 0, top: 4, bottom: 4,
          width: 3, background: 'var(--accent)', borderRadius: '0 3px 3px 0',
        }} />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={e => onRenameChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onCommitRename();
              if (e.key === 'Escape') onCancelRename();
              e.stopPropagation();
            }}
            onBlur={onCommitRename}
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
              color: 'var(--text-primary)', background: 'var(--bg-surface)',
              border: '1px solid var(--accent)', borderRadius: 4,
              padding: '2px 6px', outline: 'none',
              boxShadow: '0 0 0 3px var(--accent-muted)',
            }}
          />
        ) : (
          <div
            style={{
              fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
            onDoubleClick={e => { e.stopPropagation(); onStartRename(); }}
          >
            {macro.name}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
          {(macro.trigger.trigger_sets || []).map((chord: number[], ci: number) => (
            <span key={ci} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {ci > 0 && <span style={{ fontSize: 9, color: 'var(--text-tertiary)', margin: '0 2px' }}>or</span>}
              {chord.filter((v: number) => !isGamepadVk(v)).length > 0 && (
                <KeycapRow keys={chord.filter((v: number) => !isGamepadVk(v))} />
              )}
              {chord.filter((v: number) => isGamepadVk(v)).map((v: number) => {
                const btn = getGamepadButton(v);
                return btn ? (
                  <img key={v} src={`/gamepad/${btn.img}`} alt={btn.name} style={{ width: 44, height: 44, verticalAlign: 'middle' }} />
                ) : null;
              })}
            </span>
          ))}
          {(!macro.trigger.trigger_sets || macro.trigger.trigger_sets.length === 0) && (
            <KeycapRow keys={macro.trigger.keys || []} />
          )}
        </div>
      </div>
      <Switch
        checked={macro.enabled}
        onCheckedChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        style={{ transform: 'scale(0.75)' }}
      />
    </div>
  );
}
