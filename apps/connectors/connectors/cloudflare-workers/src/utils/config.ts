import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface StoredConfig {
  apiToken?: string;
  accountId?: string;
  baseUrl?: string;
}

const configPath = join(homedir(), ".hasna", "connectors", "cloudflare-workers.json");

function readConfig(): StoredConfig {
  if (!existsSync(configPath)) return {};
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

export function getApiToken(): string | undefined {
  return process.env.CLOUDFLARE_WORKERS_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || readConfig().apiToken;
}

export function setApiToken(apiToken: string): void {
  writeConfig({ ...readConfig(), apiToken });
}

export function getAccountId(): string | undefined {
  return process.env.CLOUDFLARE_WORKERS_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || readConfig().accountId;
}

export function setAccountId(accountId: string): void {
  writeConfig({ ...readConfig(), accountId });
}

export function getBaseUrl(): string | undefined {
  return process.env.CLOUDFLARE_WORKERS_BASE_URL || readConfig().baseUrl;
}

export function setBaseUrl(baseUrl: string): void {
  writeConfig({ ...readConfig(), baseUrl });
}

export function loadConfig(): StoredConfig {
  return readConfig();
}

export function clearConfig(): void {
  if (existsSync(configPath)) rmSync(configPath);
}
