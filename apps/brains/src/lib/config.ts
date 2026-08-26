// Config file management for @hasna/brains
// Priority: env vars > the effective brains data home's config.json
// (auto-migrates from ~/.brains/). The data home is resolved through
// @hasna/paths — the legacy ~/.hasna/brains default stays the effective home
// until the XDG data home is adopted (store migrated there or HASNA_DATA_HOME set).

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
import { effectiveHome, getBrainsHome } from "./app-home.js";

export const CONFIG_KEYS = ["OPENAI_API_KEY", "TINKER_API_KEY", "TINKER_BASE_URL"] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

// Pre-0.0.36 env names for the tinker provider. The provider was renamed from
// "Thinker Labs" to "Tinker" (c59f2bfad); existing 0.0.35 configurations that
// set THINKER_LABS_API_KEY / THINKER_LABS_BASE_URL keep working through these
// fallbacks (canonical TINKER_* always wins).
const LEGACY_CONFIG_ALIASES: Partial<Record<ConfigKey, string>> = {
  TINKER_API_KEY: "THINKER_LABS_API_KEY",
  TINKER_BASE_URL: "THINKER_LABS_BASE_URL",
};

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
  const newDir = getBrainsHome();
  const oldDir = join(effectiveHome(), ".brains");
  const configPath = join(newDir, CONFIG_FILE_NAME);
  // Ensure the parent base only — not `newDir` itself — so the migration check
  // below can still observe `!existsSync(newDir)` and run the `~/.brains` copy.
  ensureConfigDirectory(dirname(newDir));

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
  // Precedence: canonical env > canonical file > legacy env > legacy file.
  // The canonical spelling wins at any level: a migrated canonical file
  // setting must not be shadowed by a stale legacy THINKER_LABS_* env var
  // left behind by an old shell profile.
  if (process.env[key]) return process.env[key];
  const file = readConfigFile();
  if (file[key]) return file[key];
  const legacyKey = LEGACY_CONFIG_ALIASES[key];
  if (legacyKey && process.env[legacyKey]) return process.env[legacyKey];
  if (legacyKey && file[legacyKey]) return file[legacyKey];
  return undefined;
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
    const legacyKey = LEGACY_CONFIG_ALIASES[key];
    if (legacyKey && process.env[legacyKey]) return { key, value: process.env[legacyKey]!, source: "env" as const };
    if (legacyKey && file[legacyKey]) return { key, value: file[legacyKey]!, source: "file" as const };
    return { key, value: "", source: "unset" as const };
  });
}

export function deleteConfigValue(key: ConfigKey): void {
  const data = readConfigFile();
  delete data[key];
  writeConfigFile(data);
}
