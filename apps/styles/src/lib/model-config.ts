// Model config for open-styles.
// Stores the active fine-tuned model ID in ~/.styles/config.json.

import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

export const DEFAULT_MODEL = "gpt-4o-mini";

const CONFIG_DIR = join(homedir(), ".styles");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface StylesConfig {
  activeModel?: string;
  [key: string]: unknown;
}

function readConfig(): StylesConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as StylesConfig;
  } catch {
    return {};
  }
}

function writeConfig(config: StylesConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Get the active fine-tuned model ID.
 * Falls back to DEFAULT_MODEL if none has been set.
 */
export function getActiveModel(): string {
  const config = readConfig();
  return config.activeModel ?? DEFAULT_MODEL;
}

/**
 * Set the active fine-tuned model ID in ~/.styles/config.json.
 */
export function setActiveModel(id: string): void {
  const config = readConfig();
  config.activeModel = id;
  writeConfig(config);
}

/**
 * Clear the active model (revert to default).
 */
export function clearActiveModel(): void {
  const config = readConfig();
  delete config.activeModel;
  writeConfig(config);
}
