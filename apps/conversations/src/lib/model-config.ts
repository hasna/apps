import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { getDataDir } from "./db.js";

export const DEFAULT_MODEL = "gpt-4o-mini";

const CONFIG_DIR = getDataDir();
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

interface ConversationsConfig {
  activeModel?: string;
  [key: string]: unknown;
}

function readConfig(): ConversationsConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as ConversationsConfig;
  } catch {
    return {};
  }
}

function writeConfig(config: ConversationsConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/** Returns the active fine-tuned model ID, or the default model if none is set. */
export function getActiveModel(): string {
  const config = readConfig();
  return config.activeModel ?? DEFAULT_MODEL;
}

/** Sets the active fine-tuned model ID in ~/.hasna/conversations/config.json. */
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
