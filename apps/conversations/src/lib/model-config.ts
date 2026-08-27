import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { getDataDir } from "./db.js";

export const DEFAULT_MODEL = "gpt-4o-mini";

function getConfigPath(): string {
  return process.env.CONVERSATIONS_CONFIG_PATH || join(getDataDir(), "config.json");
}

interface ConversationsConfig {
  activeModel?: string;
  [key: string]: unknown;
}

function readConfig(): ConversationsConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ConversationsConfig;
  } catch {
    return {};
  }
}

function writeConfig(config: ConversationsConfig): void {
  const path = getConfigPath();
  const dir = path.substring(0, path.lastIndexOf("/"));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}

/** Returns the active fine-tuned model ID, or the default model if none is set. */
export function getActiveModel(): string {
  const config = readConfig();
  return config.activeModel ?? DEFAULT_MODEL;
}

/** Sets the active fine-tuned model ID in the conversations config file. */
export function setActiveModel(id: string): void {
  const config = readConfig();
  config.activeModel = id;
  writeConfig(config);
}

/** Clears the active fine-tuned model, reverting to the default. */
export function clearActiveModel(): void {
  const config = readConfig();
  delete config.activeModel;
  writeConfig(config);
}
