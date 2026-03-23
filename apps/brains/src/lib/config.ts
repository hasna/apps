// Config file management for @hasna/brains
// Priority: env vars > ~/.hasna/brains/config.json (auto-migrates from ~/.brains/)

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export const CONFIG_KEYS = ["OPENAI_API_KEY", "THINKER_LABS_API_KEY", "THINKER_LABS_BASE_URL"] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

function resolveConfigPath(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  const newDir = join(home, ".hasna", "brains");
  const oldDir = join(home, ".brains");

  // Auto-migrate: if old dir exists and new doesn't, copy files over
  if (existsSync(oldDir) && !existsSync(newDir)) {
    mkdirSync(newDir, { recursive: true });
    try {
      for (const file of readdirSync(oldDir)) {
        const oldPath = join(oldDir, file);
        const newPath = join(newDir, file);
        try {
          if (statSync(oldPath).isFile()) {
            copyFileSync(oldPath, newPath);
          }
        } catch {
          // Skip files that can't be copied
        }
      }
    } catch {
      // If we can't read old directory, continue with new
    }
  }

  mkdirSync(newDir, { recursive: true });
  return join(newDir, "config.json");
}

const CONFIG_PATH = resolveConfigPath();

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
