// Model configuration for @hasna/todos
// Reads/writes ~/.hasna/todos/config.json to store the active fine-tuned model ID

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_MODEL = "gpt-4o-mini";

function getTodosGlobalDir(): string {
  const home = homedir();
  const newDir = join(home, ".hasna", "todos");
  const legacyDir = join(home, ".todos");
  if (!existsSync(newDir) && existsSync(legacyDir)) return legacyDir;
  return newDir;
}

const CONFIG_DIR = getTodosGlobalDir();
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

interface ModelConfigJson {
  activeModel?: string;
  [key: string]: unknown;
}

function readConfig(): ModelConfigJson {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as ModelConfigJson;
  } catch {
    return {};
  }
}

function writeConfig(config: ModelConfigJson): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
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
