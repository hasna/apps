import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { type SearchConfig, DEFAULT_CONFIG } from "../types/index.js";

function getConfigDir(): string {
  const home = Bun.env.HOME ?? "/tmp";
  const dir = `${home}/.open-search`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getConfigPath(): string {
  return `${getConfigDir()}/config.json`;
}

export function getConfig(): SearchConfig {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function setConfig(updates: Partial<SearchConfig>): SearchConfig {
  const current = getConfig();
  const merged = { ...current, ...updates };
  const path = getConfigPath();
  writeFileSync(path, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

export function resetConfig(): SearchConfig {
  const path = getConfigPath();
  writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
  return { ...DEFAULT_CONFIG };
}

export function getConfigValue(key: keyof SearchConfig): unknown {
  const config = getConfig();
  return config[key];
}

export function setConfigValue(key: keyof SearchConfig, value: unknown): SearchConfig {
  const config = getConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (config as any)[key] = value;
  return setConfig(config);
}
