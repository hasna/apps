import { MAILBOXES, type Mailbox } from "./mail-types.js";
import type { TuiThemeMode } from "../cli/tui/theme.js";
import { readDevicePreferences, writeDevicePreferences } from "./device-preferences.js";
export interface TuiPreferences {
  autoPull: boolean; dimRead: boolean; defaultMailbox: Mailbox;
  defaultAddress: string | null; defaultFrom: string | null; theme: TuiThemeMode;
  autoRefresh: boolean; expandCode: boolean; expandQuotes: boolean;
}
export const DEFAULT_TUI_PREFERENCES: Readonly<TuiPreferences> = Object.freeze({
  autoPull: false, dimRead: false, defaultMailbox: "inbox", defaultAddress: null,
  defaultFrom: null, theme: "light", autoRefresh: true, expandCode: false, expandQuotes: false,
});
function valid(key: string, value: unknown): boolean {
  if (["autoPull", "dimRead", "autoRefresh", "expandCode", "expandQuotes"].includes(key)) return typeof value === "boolean";
  if (key === "theme") return typeof value === "string" && ["light", "dark", "auto"].includes(value);
  if (key === "defaultMailbox") return MAILBOXES.includes(value as Mailbox);
  if (key === "defaultAddress" || key === "defaultFrom") return value === null || (typeof value === "string" && value.length <= 320 && !/[\u0000-\u001f\u007f]/.test(value) && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value));
  return false;
}
export function loadTuiPreferences(): TuiPreferences {
  const raw = readDevicePreferences("tui-preferences");
  const value = { ...DEFAULT_TUI_PREFERENCES };
  for (const key of Object.keys(value) as (keyof TuiPreferences)[]) {
    if (Object.hasOwn(raw, key) && valid(key, raw[key])) Object.assign(value, { [key]: raw[key] });
  }
  return value;
}
export function saveTuiPreference<K extends keyof TuiPreferences>(key: K, value: TuiPreferences[K]): void {
  if (!valid(key, value)) throw new Error("Invalid UI preference");
  writeDevicePreferences("tui-preferences", { ...loadTuiPreferences(), [key]: value });
}
