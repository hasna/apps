import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface StatuslineConfig {
  separator: string;
  /** Ordered list of enabled segment ids. */
  segments: string[];
}

export function defaultConfig(): StatuslineConfig {
  return {
    separator: " · ",
    segments: [
      "machine",
      "project",
      "commit-age",
      "loc",
      "model-context",
      "context-remaining",
      "cost",
    ],
  };
}

export function configPath(path?: string): string {
  if (path) return path;
  if (process.env.STATUSLINE_CONFIG) return process.env.STATUSLINE_CONFIG;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "statusline", "config.json");
}

export function loadConfig(path = configPath()): StatuslineConfig {
  if (!existsSync(path)) return defaultConfig();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const fallback = defaultConfig();
    return {
      separator: typeof raw.separator === "string" ? raw.separator : fallback.separator,
      segments: Array.isArray(raw.segments)
        ? raw.segments.filter((s: unknown) => typeof s === "string")
        : fallback.segments,
    };
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(cfg: StatuslineConfig, path = configPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
}
