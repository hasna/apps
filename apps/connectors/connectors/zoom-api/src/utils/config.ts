import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface StoredConfig {
  apiKey?: string;
  baseUrl?: string;
}

const configPath = join(homedir(), ".hasna", "connectors", "zoom-api.json");

function readConfig(): StoredConfig {
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as StoredConfig;
  } catch {
    return {};
  }
}

function writeConfig(config: StoredConfig): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function getConfigPath(): string {
  return configPath;
}

export function getApiKey(): string | undefined {
  return process.env.ZOOM_API_API_KEY || readConfig().apiKey;
}

export function setApiKey(apiKey: string): void {
  writeConfig({ ...readConfig(), apiKey });
}

export function getBaseUrl(): string | undefined {
  return process.env.ZOOM_API_BASE_URL || readConfig().baseUrl;
}

export function setBaseUrl(baseUrl: string): void {
  writeConfig({ ...readConfig(), baseUrl });
}

export function clearConfig(): void {
  if (existsSync(configPath)) {
    rmSync(configPath);
  }
}
