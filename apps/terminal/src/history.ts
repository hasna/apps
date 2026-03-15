import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const DIR = join(homedir(), ".terminal");
const HISTORY_FILE = join(DIR, "history.json");
const CONFIG_FILE = join(DIR, "config.json");

export interface HistoryEntry {
  nl: string;
  cmd: string;
  output: string;
  ts: number;
  error?: boolean;
}

export interface Permissions {
  /** Allow commands that delete files/data (rm, drop, truncate, etc.) */
  destructive: boolean;
  /** Allow commands that make network requests (curl, wget, ssh, etc.) */
  network: boolean;
  /** Allow commands that require sudo / root */
  sudo: boolean;
  /** Allow writing to files outside the current directory */
  write_outside_cwd: boolean;
  /** Allow installing packages (npm, brew, pip, apt, etc.) */
  install: boolean;
}

export interface Config {
  onboarded: boolean;
  permissions: Permissions;
}

export const DEFAULT_PERMISSIONS: Permissions = {
  destructive: false,
  network: true,
  sudo: false,
  write_outside_cwd: false,
  install: false,
};

export const DEFAULT_CONFIG: Config = {
  onboarded: false,
  permissions: DEFAULT_PERMISSIONS,
};

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

export function loadHistory(): HistoryEntry[] {
  ensureDir();
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, "utf8"));
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]) {
  ensureDir();
  writeFileSync(HISTORY_FILE, JSON.stringify(entries.slice(-500), null, 2));
}

export function appendHistory(entry: HistoryEntry) {
  const existing = loadHistory();
  saveHistory([...existing, entry]);
}

export function loadConfig(): Config {
  ensureDir();
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
  try {
    const saved = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      permissions: { ...DEFAULT_PERMISSIONS, ...(saved.permissions ?? {}) },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: Config) {
  ensureDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
