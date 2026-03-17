/** Tauri IPC hooks — thin wrappers around invoke/listen */

import { invoke } from '@tauri-apps/api/core';
import type { AppConfig, AppSettings, MacroDef } from '../types/config';

// ── Config ──

export async function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>('get_config');
}

export async function saveConfig(config: AppConfig): Promise<void> {
  return invoke('save_config', { config });
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke('save_settings', { settings });
}

export async function setActiveProfile(name: string): Promise<void> {
  return invoke('set_active_profile', { name });
}

export async function createProfile(name: string): Promise<AppConfig> {
  return invoke<AppConfig>('create_profile', { name });
}

export async function deleteProfile(name: string): Promise<AppConfig> {
  return invoke<AppConfig>('delete_profile', { name });
}

export async function renameProfile(oldName: string, newName: string): Promise<AppConfig> {
  return invoke<AppConfig>('rename_profile', { oldName, newName });
}

// ── Macro CRUD ──

export async function createMacro(groupIdx: number, name: string): Promise<AppConfig> {
  return invoke<AppConfig>('create_macro', { groupIdx, name });
}

export async function createGroup(name: string): Promise<AppConfig> {
  return invoke<AppConfig>('create_group', { name });
}

export async function updateMacro(
  groupIdx: number,
  macroIdx: number,
  macroDef: MacroDef
): Promise<AppConfig> {
  return invoke<AppConfig>('update_macro', { groupIdx, macroIdx, macroDef });
}

export async function deleteMacro(groupIdx: number, macroIdx: number): Promise<AppConfig> {
  return invoke<AppConfig>('delete_macro', { groupIdx, macroIdx });
}

export async function toggleGroup(groupIdx: number, enabled: boolean): Promise<AppConfig> {
  return invoke<AppConfig>('toggle_group', { groupIdx, enabled });
}

export async function toggleMacroEnabled(
  groupIdx: number,
  macroIdx: number,
  enabled: boolean
): Promise<AppConfig> {
  return invoke<AppConfig>('toggle_macro_enabled', { groupIdx, macroIdx, enabled });
}

// ── Daemon ──

export async function togglePause(): Promise<boolean> {
  return invoke<boolean>('toggle_pause');
}

export async function cancelAll(): Promise<void> {
  return invoke('cancel_all');
}

export async function getDaemonEvents(): Promise<unknown[]> {
  return invoke<unknown[]>('get_daemon_events');
}

// ── Recording ──

export async function startRecording(stopKey: number): Promise<void> {
  return invoke('start_recording', { stopKey });
}

export async function stopRecording(): Promise<void> {
  return invoke('stop_recording');
}

export async function getRecordingResult(): Promise<unknown | null> {
  return invoke<unknown | null>('get_recording_result');
}

// ── Arduino ──

export async function arduinoConnect(port: string): Promise<string> {
  return invoke<string>('arduino_connect', { port });
}

export async function arduinoDisconnect(): Promise<void> {
  return invoke('arduino_disconnect');
}

export async function arduinoPing(): Promise<number> {
  return invoke<number>('arduino_ping');
}

export async function arduinoIsConnected(): Promise<boolean> {
  return invoke<boolean>('arduino_is_connected');
}

export async function arduinoListPorts(): Promise<string[]> {
  return invoke<string[]>('arduino_list_ports');
}

// ── Utilities ──

export async function vkName(vk: number): Promise<string> {
  return invoke<string>('vk_name', { vk });
}

export async function openConfigDir(): Promise<void> {
  return invoke('open_config_dir');
}

export async function saveFirmware(path: string): Promise<void> {
  return invoke('save_firmware', { path });
}

// ── Import / Export ──

export async function importMacros(path: string, groupIdx: number = 0): Promise<AppConfig> {
  return invoke<AppConfig>('import_macros', { path, groupIdx });
}

export async function exportProfile(path: string): Promise<void> {
  return invoke('export_profile', { path });
}

export async function exportMacro(groupIdx: number, macroIdx: number, path: string): Promise<void> {
  return invoke('export_macro', { groupIdx, macroIdx, path });
}

// ── Conflict Detection ──

export interface ConflictWarning {
  macro_a: string;
  macro_b: string;
  keys: number[];
}

export async function detectConflicts(): Promise<ConflictWarning[]> {
  return invoke<ConflictWarning[]>('detect_conflicts');
}

// ── Macro Organization ──

export async function moveMacro(
  fromGroup: number,
  fromIdx: number,
  toGroup: number,
): Promise<AppConfig> {
  return invoke<AppConfig>('move_macro', { fromGroup, fromIdx, toGroup });
}

// ── Coordinate Picker ──

export async function pickCoordinate(): Promise<[number, number]> {
  return invoke<[number, number]>('pick_coordinate');
}

export async function getScreenResolution(): Promise<[number, number]> {
  return invoke<[number, number]>('get_screen_resolution');
}

// ── Program Discovery ──

export interface InstalledProgram {
  name: string;
  path: string;
}

export async function listInstalledPrograms(): Promise<InstalledProgram[]> {
  return invoke<InstalledProgram[]>('list_installed_programs');
}

export async function browseProgram(): Promise<string | null> {
  return invoke<string | null>('browse_program');
}
