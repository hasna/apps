import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getConfigDir, ensureConfigDir } from './config';

export interface Settings {
  // Signature settings
  appendSignature: boolean;       // Append signature to new emails (default: true)
  appendSignatureToReplies: boolean; // Append signature to replies (default: false)
  signature?: string;             // Custom signature (if not set, fetches from Gmail)

  // Formatting settings
  markdownEnabled: boolean;       // Convert markdown to HTML (default: true)

  // Display settings
  defaultFormat: 'json' | 'table' | 'pretty';

  // Sending defaults
  defaultSendAsHtml: boolean;     // Send as HTML by default (default: true when markdown enabled)
}

const DEFAULT_SETTINGS: Settings = {
  appendSignature: true,
  appendSignatureToReplies: false,
  markdownEnabled: true,
  defaultFormat: 'pretty',
  defaultSendAsHtml: true,
};

function getSettingsPath(): string {
  return join(getConfigDir(), 'settings.json');
}

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

export function saveSettings(settings: Settings): void {
  ensureConfigDir();
  const filepath = getSettingsPath();
  writeFileSync(filepath, JSON.stringify(settings, null, 2));
}

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  return loadSettings()[key];
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  const settings = loadSettings();
  settings[key] = value;
  saveSettings(settings);
}

export function getSignature(): string | undefined {
  return loadSettings().signature;
}

export function setSignature(signature: string): void {
  setSetting('signature', signature);
}

export function isMarkdownEnabled(): boolean {
  return loadSettings().markdownEnabled;
}

export function shouldAppendSignature(isReply: boolean = false): boolean {
  const settings = loadSettings();
  if (isReply) {
    return settings.appendSignatureToReplies;
  }
  return settings.appendSignature;
}
