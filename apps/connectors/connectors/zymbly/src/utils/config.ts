import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface StoredConfig {
  apiKey?: string;
  baseUrl?: string;
}

const CONFIG_PATH = join(homedir(), ".config", "hasna-connectors", "zymbly.json");

function readConfig(): StoredConfig {
  if (!existsSync(CONFIG_PATH)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as StoredConfig;
  } catch {
    return {};
  }
}

function writeConfig(config: StoredConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function getApiKey(): string | undefined {
  return process.env.ZYMBLY_API_KEY || readConfig().apiKey;
}

export function getBaseUrl(): string | undefined {
  return process.env.ZYMBLY_BASE_URL || readConfig().baseUrl;
}

export function setApiKey(apiKey: string): void {
  writeConfig({ ...readConfig(), apiKey });
}

export function setBaseUrl(baseUrl: string): void {
  writeConfig({ ...readConfig(), baseUrl });
}

export function clearConfig(): void {
  if (existsSync(CONFIG_PATH)) {
    rmSync(CONFIG_PATH);
  }
}
