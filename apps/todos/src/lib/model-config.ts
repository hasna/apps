// Model configuration for @hasna/todos
// Reads/writes ~/.hasna/todos/config.json to store the active fine-tuned model ID

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTodosGlobalDir } from "./sync-utils.js";

export const DEFAULT_MODEL = "gpt-4o-mini";

function getConfigDir(): string {
  return getTodosGlobalDir();
}

function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

interface ModelConfigJson {
  activeModel?: string;
  [key: string]: unknown;
}

function readConfig(): ModelConfigJson {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as ModelConfigJson;
  } catch {
    return {};
  }
}

function writeConfig(config: ModelConfigJson): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Returns the currently active fine-tuned model ID, or the default model.
 */
export function getActiveModel(): string {
  const config = readConfig();
  return config.activeModel ?? DEFAULT_MODEL;
}

/**
 * Sets the active fine-tuned model ID in ~/.hasna/todos/config.json.
 */
export function setActiveModel(modelId: string): void {
  const config = readConfig();
  config.activeModel = modelId;
  writeConfig(config);
}

/**
 * Clears the active fine-tuned model, reverting to the default.
 */
export function clearActiveModel(): void {
  const config = readConfig();
  delete config.activeModel;
  writeConfig(config);
}
