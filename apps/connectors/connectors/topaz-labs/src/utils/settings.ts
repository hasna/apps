import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getConfigDir, ensureConfigDir } from './config';

// ============================================
// Settings Storage Utility
// ============================================

export interface Settings {
  defaultFormat: 'json' | 'table' | 'pretty';
  confirmDestructive: boolean;
  verboseOutput: boolean;
  defaultMaxResults: number;
  requestTimeout: number;
}

const DEFAULT_SETTINGS: Settings = {
  defaultFormat: 'pretty',
  confirmDestructive: true,
  verboseOutput: false,
  defaultMaxResults: 20,
  requestTimeout: 30000,
};

function getSettingsPath(): string {
  return join(getConfigDir(), 'settings.json');
}

/**
 * Load settings from disk, merging with defaults
 */
export function loadSettings(): Settings {
  ensureConfigDir();
  const filepath = getSettingsPath();

  if (!existsSync(filepath)) {
    // Create default settings file
    saveSettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }

  try {
    const content = readFileSync(filepath, 'utf-8');
    const loaded = JSON.parse(content);
    // Merge with defaults to ensure all fields exist
    return { ...DEFAULT_SETTINGS, ...loaded };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save settings to disk
 */
export function saveSettings(settings: Settings): void {
  ensureConfigDir();
  const filepath = getSettingsPath();
  writeFileSync(filepath, JSON.stringify(settings, null, 2));
}

/**
 * Get a specific setting value
 */
export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  return loadSettings()[key];
}

/**
 * Set a specific setting value
 */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  const settings = loadSettings();
  settings[key] = value;
  saveSettings(settings);
}

/**
 * Reset settings to defaults
 */
export function resetSettings(): void {
  saveSettings(DEFAULT_SETTINGS);
}

/**
 * Get default settings (useful for CLI help text)
 */
export function getDefaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS };
}

/**
 * Check if verbose output is enabled
 */
export function isVerbose(): boolean {
  return loadSettings().verboseOutput;
}

/**
 * Check if destructive operations need confirmation
 */
export function needsConfirmation(): boolean {
  return loadSettings().confirmDestructive;
}
