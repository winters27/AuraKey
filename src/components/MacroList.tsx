/** MacroList — Sidebar with search, groups, macros, drag-between-groups, import/export */

import type { AppConfig, MacroSelection } from '../types/config';
import { isGamepadVk, getGamepadButton } from '../types/config';
import { KeycapRow } from './Keycap';
import { createGroup, createMacro, toggleGroup, toggleMacroEnabled, moveMacro, importMacros, exportMacro, updateMacro, deleteMacro } from '../hooks/useTauri';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useState, useRef, useEffect } from 'react';
import { Button } from './primitives/Button';
import { Input } from './primitives/Input';
import { Switch } from './primitives/Switch';
import { ScrollArea } from './primitives/ScrollArea';
import { X, Plus, Pencil, Copy, Trash2, Upload, Import } from 'lucide-react';
import { PromptDialog } from './primitives/PromptDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './primitives/DropdownMenu';

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
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptTitle, setPromptTitle] = useState('');
  const [promptPlaceholder, setPromptPlaceholder] = useState('');
  const [promptCallback, setPromptCallback] = useState<((v: string) => void) | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; gIdx: number; mIdx: number } | null>(null);

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

  const handleCreateGroup = () => {
    setPromptTitle('New Group');
    setPromptPlaceholder('Group name');
    setPromptCallback(() => async (name: string) => {
      const updated = await createGroup(name);
      onConfigUpdate(updated);
      setPromptOpen(false);
    });
    setPromptOpen(true);
  };

  const handleCreateMacro = (groupIdx: number) => {
    setPromptTitle('New Macro');
    setPromptPlaceholder('Macro name');
    setPromptCallback(() => async (name: string) => {
      const updated = await createMacro(groupIdx, name);
      onConfigUpdate(updated);
      setPromptOpen(false);
    });
    setPromptOpen(true);
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

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent, gIdx: number, mIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, gIdx, mIdx });
  };

  const closeCtxMenu = () => setCtxMenu(null);

  const handleCtxRename = () => {
    if (!ctxMenu) return;
    const macro = profile.groups[ctxMenu.gIdx]?.macros[ctxMenu.mIdx];
    if (macro) startRename(macro);
    closeCtxMenu();
  };

  const handleCtxDuplicate = async () => {
    if (!ctxMenu) return;
    const { gIdx, mIdx } = ctxMenu;
    const source = profile.groups[gIdx]?.macros[mIdx];
    if (!source) { closeCtxMenu(); return; }
    try {
      const afterCreate = await createMacro(gIdx, `${source.name} (Copy)`);
      // The new macro is the last in the group
      const newGroup = afterCreate.profiles.find(p => p.name === afterCreate.active_profile)?.groups[gIdx];
      if (newGroup) {
        const newIdx = newGroup.macros.length - 1;
        const newMacro = newGroup.macros[newIdx];
        const updated = await updateMacro(gIdx, newIdx, {
          ...newMacro,
          steps: structuredClone(source.steps),
          trigger: structuredClone(source.trigger),
          execution: structuredClone(source.execution),
        });
        onConfigUpdate(updated);
      } else {
        onConfigUpdate(afterCreate);
      }
    } catch (e) { console.error('Duplicate failed:', e); }
    closeCtxMenu();
  };

  const handleCtxDelete = async () => {
    if (!ctxMenu) return;
    const { gIdx, mIdx } = ctxMenu;
    const macro = profile.groups[gIdx]?.macros[mIdx];
    closeCtxMenu();
    if (!macro || !confirm(`Delete "${macro.name}"?`)) return;
    try {
      const updated = await deleteMacro(gIdx, mIdx);
      onConfigUpdate(updated);
    } catch (e) { console.error('Delete failed:', e); }
  };

  const handleCtxExport = async () => {
    if (!ctxMenu) return;
    const { gIdx, mIdx } = ctxMenu;
    const macro = profile.groups[gIdx]?.macros[mIdx];
    closeCtxMenu();
    if (!macro) return;
    const file = await save({
      title: `Export Macro — ${macro.name}`,
      defaultPath: `${macro.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.akg`,
      filters: [{ name: 'AuraKey Macro', extensions: ['akg'] }],
    });
    if (!file) return;
    try { await exportMacro(gIdx, mIdx, file); }
    catch (e: any) { alert(`Export failed: ${e}`); }
  };

  // Close context menu on click-away
  useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = () => closeCtxMenu();
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCtxMenu(); };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('mousedown', handleClick); window.removeEventListener('keydown', handleKey); };
  }, [ctxMenu]);

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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(e) => e.stopPropagation()}
                        style={{}}
                      >
                        <Plus size={10} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" style={{ minWidth: 150 }}>
                      <DropdownMenuItem style={{ fontSize: 12, gap: 8 }} onSelect={() => handleCreateMacro(gIdx)}>
                        <Plus size={12} /> New Macro
                      </DropdownMenuItem>
                      <DropdownMenuItem style={{ fontSize: 12, gap: 8 }} onSelect={async () => {
                        const file = await open({
                          title: 'Import Macro',
                          filters: [{ name: 'AuraKey Macros', extensions: ['akg', 'toml', 'json'] }],
                          multiple: false,
                        });
                        if (!file) return;
                        try {
                          const updated = await importMacros(file, gIdx);
                          onConfigUpdate(updated);
                        } catch (e: any) { alert(`Import failed: ${e}`); }
                      }}>
                        <Import size={12} /> Import from File
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
                      onContextMenu={e => handleContextMenu(e, gIdx, mIdx)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </ScrollArea>



      <PromptDialog
        open={promptOpen}
        title={promptTitle}
        placeholder={promptPlaceholder}
        onConfirm={(v) => promptCallback?.(v)}
        onCancel={() => setPromptOpen(false)}
      />

      {/* Custom Context Menu */}
      {ctxMenu && (
        <div
          ref={(el) => {
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            let x = ctxMenu.x;
            let y = ctxMenu.y;
            if (y + rect.height > vh) y = vh - rect.height - 8;
            if (x + rect.width > vw) x = vw - rect.width - 8;
            if (y < 4) y = 4;
            if (x < 4) x = 4;
            if (el.style.left !== `${x}px` || el.style.top !== `${y}px`) {
              el.style.left = `${x}px`;
              el.style.top = `${y}px`;
            }
          }}
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999,
            minWidth: 160, padding: 4,
            background: 'rgba(20, 20, 22, 0.85)', backdropFilter: 'blur(16px)',
            border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}
        >
          <CtxMenuItem icon={<Pencil size={13} />} label="Rename" onClick={handleCtxRename} />
          <CtxMenuItem icon={<Copy size={13} />} label="Duplicate" onClick={handleCtxDuplicate} />
          <CtxMenuItem icon={<Upload size={13} />} label="Export Macro" onClick={handleCtxExport} />
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />
          <CtxMenuItem icon={<Trash2 size={13} />} label="Delete" onClick={handleCtxDelete} danger />
        </div>
      )}
    </div>
  );
}

/** Context menu item */
function CtxMenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderRadius: 5, cursor: 'default',
        fontSize: 12, fontWeight: 500,
        color: danger ? 'var(--destructive, #ef4444)' : 'var(--text-primary)',
        background: hov ? 'rgba(255,255,255,0.06)' : 'transparent',
        transition: 'background 80ms',
      }}
    >
      <span style={{ opacity: 0.7, flexShrink: 0 }}>{icon}</span>
      {label}
    </div>
  );
}

/** Individual macro row — extracted to keep MacroList clean */
function MacroItem({ macro, isActive, isRenaming, renameValue, renameInputRef, gIdx: _gIdx, mIdx: _mIdx,
  onSelect, onDragStart, onToggle, onStartRename, onRenameChange, onCommitRename, onCancelRename, onContextMenu,
}: {
  macro: any; isActive: boolean; isRenaming: boolean;
  renameValue: string; renameInputRef: React.RefObject<HTMLInputElement | null>;
  gIdx: number; mIdx: number;
  onSelect: () => void; onDragStart: (e: React.DragEvent) => void;
  onToggle: (v: boolean) => void; onStartRename: () => void;
  onRenameChange: (v: string) => void; onCommitRename: () => void; onCancelRename: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
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
        transition: 'background-color 100ms, border-color 100ms',
        background: isActive ? 'rgba(255,255,255,0.04)' : hovered ? 'var(--bg-surface-hover)' : 'transparent',
        border: isActive ? '1px solid var(--border)' : '1px solid transparent',
        boxShadow: isActive ? 'inset 0 1px 0 0 var(--border-highlight)' : 'none',
      }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={onDragStart}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >


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
