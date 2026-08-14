// Model config for open-styles.
// Stores the active fine-tuned model ID in ~/.hasna/styles/config.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getModelConfigPath } from "./paths.js";

export const DEFAULT_MODEL = "gpt-4o-mini";

interface StylesConfig {
  activeModel?: string;
  [key: string]: unknown;
}

function readConfig(): StylesConfig {
  const configFile = getModelConfigPath();
  if (!existsSync(configFile)) return {};
  try {
    return JSON.parse(readFileSync(configFile, "utf-8")) as StylesConfig;
  } catch {
    return {};
  }
}

function writeConfig(config: StylesConfig): void {
  const configFile = getModelConfigPath();
  const configDir = dirname(configFile);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n", "utf-8");
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
 * Set the active fine-tuned model ID in ~/.hasna/styles/config.json.
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
