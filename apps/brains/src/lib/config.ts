// Config file management for @hasna/brains
// Priority: env vars > ~/.brains/config.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export const CONFIG_KEYS = ["OPENAI_API_KEY", "THINKER_LABS_API_KEY", "THINKER_LABS_BASE_URL"] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

const CONFIG_PATH = join(homedir(), ".brains", "config.json");

function readConfigFile(): Record<string, string> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeConfigFile(data: Record<string, string>): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export function getConfigValue(key: ConfigKey): string | undefined {
  // Env var takes precedence
  if (process.env[key]) return process.env[key];
  return readConfigFile()[key];
}

export function setConfigValue(key: ConfigKey, value: string): void {
  const data = readConfigFile();
  data[key] = value;
  writeConfigFile(data);
}

export function listConfig(): Array<{ key: ConfigKey; value: string; source: "env" | "file" | "unset" }> {
  const file = readConfigFile();
  return CONFIG_KEYS.map((key) => {
    if (process.env[key]) return { key, value: process.env[key]!, source: "env" as const };
    if (file[key]) return { key, value: file[key]!, source: "file" as const };
    return { key, value: "", source: "unset" as const };
  });
}

export function deleteConfigValue(key: ConfigKey): void {
  const data = readConfigFile();
  delete data[key];
  writeConfigFile(data);
}
