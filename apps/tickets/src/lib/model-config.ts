// Model config for @hasna/tickets
// Reads/writes the active fine-tuned model ID from ~/.hasna/tickets/config.json

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const DEFAULT_MODEL = "gpt-4o-mini";

function getTicketsDir(): string {
  const home = homedir();
  const newDir = join(home, ".hasna", "tickets");
  const legacyDir = join(home, ".tickets");
  if (!existsSync(newDir) && existsSync(legacyDir)) return legacyDir;
  return newDir;
}

const CONFIG_PATH = join(getTicketsDir(), "config.json");

interface TicketsConfig {
  activeModel?: string;
  [key: string]: unknown;
}

function loadConfig(): TicketsConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as TicketsConfig;
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

function saveConfig(config: TicketsConfig): void {
  const dir = getTicketsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

/** Returns the active fine-tuned model ID, or DEFAULT_MODEL if none set. */
export function getActiveModel(): string {
  return loadConfig().activeModel ?? DEFAULT_MODEL;
}

/** Persists the active fine-tuned model ID to ~/.hasna/tickets/config.json. */
export function setActiveModel(id: string): void {
  const config = loadConfig();
  config.activeModel = id;
  saveConfig(config);
}

/** Clears the active model, falling back to DEFAULT_MODEL. */
export function clearActiveModel(): void {
  const config = loadConfig();
  delete config.activeModel;
  saveConfig(config);
}
