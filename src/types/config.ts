/** TypeScript mirrors of Rust config types */

/** Gamepad pseudo-VK base */
export const GAMEPAD_VK_BASE = 0x1000;

/** All gamepad buttons with pseudo-VK codes */
export const GAMEPAD_BUTTONS = [
  { vk: 0x1001, name: 'A',           img: 'A.png' },
  { vk: 0x1002, name: 'B',           img: 'B.png' },
  { vk: 0x1003, name: 'X',           img: 'X.png' },
  { vk: 0x1004, name: 'Y',           img: 'Y.png' },
  { vk: 0x1005, name: 'LB',          img: 'Left Bumper.png' },
  { vk: 0x1006, name: 'RB',          img: 'Right Bumper.png' },
  { vk: 0x1007, name: 'LT',          img: 'Left Trigger.png' },
  { vk: 0x1008, name: 'RT',          img: 'Right Trigger.png' },
  { vk: 0x1009, name: 'Start',       img: 'Menu.png' },
  { vk: 0x100A, name: 'Back',        img: 'View.png' },
  { vk: 0x100B, name: 'D-Pad Up',    img: 'D-Pad Up.png' },
  { vk: 0x100C, name: 'D-Pad Down',  img: 'D-Pad Down.png' },
  { vk: 0x100D, name: 'D-Pad Left',  img: 'D-Pad Left.png' },
  { vk: 0x100E, name: 'D-Pad Right', img: 'D-Pad Right.png' },
  { vk: 0x100F, name: 'LS Click',    img: 'Left Stick Click.png' },
  { vk: 0x1010, name: 'RS Click',    img: 'Right Stick Click.png' },
] as const;

/** Check if a VK code is a gamepad pseudo-VK */
export function isGamepadVk(vk: number): boolean {
  return vk >= 0x1001 && vk <= 0x1010;
}

/** Get gamepad button info by VK code */
export function getGamepadButton(vk: number) {
  return GAMEPAD_BUTTONS.find(b => b.vk === vk);
}

/** Mouse button VK codes (matches Windows VK constants) */
export const MOUSE_BUTTONS = [
  { vk: 0x01, label: 'LMB' },
  { vk: 0x02, label: 'RMB' },
  { vk: 0x04, label: 'MMB' },
  { vk: 0x05, label: 'M4' },
  { vk: 0x06, label: 'M5' },
] as const;

/** Check if a VK code is a mouse button */
export function isMouseVk(vk: number): boolean {
  return vk >= 0x01 && vk <= 0x06 && vk !== 0x03;
}

/** Get mouse button label by VK code */
export function getMouseLabel(vk: number): string | undefined {
  return MOUSE_BUTTONS.find(b => b.vk === vk)?.label;
}

export interface TriggerConfig {
  keys: number[];
  trigger_sets: number[][];
  mode: 'press' | 'hold' | 'toggle' | 'double_tap' | 'long_press' | 'release';
  timeout_ms: number;
  long_press_ms: number;
  passthrough: boolean;
}

export interface ExecutionConfig {
  mode: 'sequential' | 'timeline' | 'continuous';
  pattern: 'key_cycle' | 'mouse_oscillate';
  cycle_keys: number[];
  amplitude: number;
  vertical_comp: number;
  rate_ms: number;
}

export type StepDef =
  | { type: 'KeyTap'; key: number; offset_us: number }
  | { type: 'KeyHold'; key: number; duration_ms: number; offset_us: number }
  | { type: 'KeyRelease'; key: number; offset_us: number }
  | { type: 'KeySequence'; keys: number[]; per_key_delay_ms: number; offset_us: number }
  | { type: 'MouseMoveRelative'; dx: number; dy: number; stepped: boolean; offset_us: number }
  | { type: 'MouseMoveAbsolute'; x: number; y: number; offset_us: number }
  | { type: 'MouseClick'; button: string; offset_us: number }
  | { type: 'MouseHold'; button: string; duration_ms: number; offset_us: number }
  | { type: 'MouseRelease'; button: string; offset_us: number }
  | { type: 'MouseAbsoluteClick'; x: number; y: number; button: string; offset_us: number }
  | { type: 'MouseSteppedDeltaClick'; dx: number; dy: number; button: string; offset_us: number }
  | { type: 'MouseScroll'; direction: string; amount: number; offset_us: number }
  | { type: 'Delay'; ms: number; offset_us: number }
  | { type: 'RepeatBlock'; step_count: number; repeat_count: number; offset_us: number }
  | { type: 'Label'; text: string }
  | { type: 'CancelAll' }
  | { type: 'RunProgram'; command: string; args: string; working_dir: string; wait: boolean; offset_us: number };

export interface MacroDef {
  id: string;
  name: string;
  enabled: boolean;
  favorite: boolean;
  trigger: TriggerConfig;
  execution: ExecutionConfig;
  output_mode: 'software' | 'arduino';
  steps: StepDef[];
}

export interface MacroGroup {
  name: string;
  enabled: boolean;
  macros: MacroDef[];
}

export interface Profile {
  name: string;
  groups: MacroGroup[];
}

export interface ArduinoConfig {
  enabled: boolean;
  port: string;
  auto_connect: boolean;
  fallback_to_software: boolean;
}

export interface AppSettings {
  stop_key: number;
  emergency_stop: number[];
  recording_countdown_secs: number;
  mouse_accumulate_ms: number;
  max_recording_secs: number;
  default_execution: string;
  default_tick_rate_ms: number;
  launch_with_windows: boolean;
  start_minimized: boolean;
  theme: 'dark' | 'light' | 'system';
  arduino: ArduinoConfig;
}

export interface AppConfig {
  settings: AppSettings;
  active_profile: string;
  profiles: Profile[];
}

/** Which macro is currently selected in the sidebar */
export interface MacroSelection {
  groupIdx: number;
  macroIdx: number;
}
