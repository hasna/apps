// Config file management for @hasna/brains
// Priority: env vars > ~/.hasna/brains/config.json (auto-migrates from ~/.brains/)

import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { randomUUID } from "crypto";
import { join, dirname } from "path";
import { homedir } from "os";

export const CONFIG_KEYS = ["OPENAI_API_KEY", "THINKER_LABS_API_KEY", "THINKER_LABS_BASE_URL"] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

const CONFIG_FILE_NAME = "config.json";

function restrictConfigFilePermissions(configPath: string): void {
  try {
    if (!lstatSync(configPath).isFile()) return;
    chmodSync(configPath, 0o600);
  } catch {
    // Best effort: some filesystems do not support POSIX modes.
  }
}

function ensureConfigDirectory(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    if (!statSync(dirPath).isDirectory()) return;
    chmodSync(dirPath, 0o700);
  } catch {
    // Best effort: some filesystems do not support POSIX modes.
  }
}

function resolveConfigPath(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  const hasnaDir = join(home, ".hasna");
  const newDir = join(hasnaDir, "brains");
  const oldDir = join(home, ".brains");
  const configPath = join(newDir, CONFIG_FILE_NAME);
  ensureConfigDirectory(hasnaDir);

  // Auto-migrate: if old dir exists and new doesn't, copy files over
  if (existsSync(oldDir) && !existsSync(newDir)) {
    ensureConfigDirectory(newDir);
    try {
      for (const file of readdirSync(oldDir)) {
        const oldPath = join(oldDir, file);
        const newPath = join(newDir, file);
        try {
          if (statSync(oldPath).isFile()) {
            copyFileSync(oldPath, newPath);
            if (file === CONFIG_FILE_NAME) restrictConfigFilePermissions(newPath);
          }
        } catch {
          // Skip files that can't be copied
        }
      }
    } catch {
      // If we can't read old directory, continue with new
    }
  }

  ensureConfigDirectory(newDir);
  return configPath;
}

function readConfigFile(): Record<string, string> {
  const configPath = resolveConfigPath();
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeConfigFile(data: Record<string, string>): void {
  const configPath = resolveConfigPath();
  const configDir = dirname(configPath);
  const tempPath = join(configDir, `.config.json.${randomUUID()}.tmp`);
  ensureConfigDirectory(configDir);
  if (existsSync(configPath)) restrictConfigFilePermissions(configPath);
  try {
    writeFileSync(tempPath, JSON.stringify(data, null, 2) + "\n", { encoding: "utf-8", mode: 0o600, flag: "wx" });
    restrictConfigFilePermissions(tempPath);
    renameSync(tempPath, configPath);
    restrictConfigFilePermissions(configPath);
  } catch (err) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors and preserve the original write failure.
    }
    throw err;
  }
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
