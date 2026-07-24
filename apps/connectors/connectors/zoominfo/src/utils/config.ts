import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

interface StoredConfig {
  username?: string;
  password?: string;
  jwt?: string;
  baseUrl?: string;
}

const CONFIG_PATH = join(homedir(), ".hasna", "connectors", "zoominfo", "config.json");

export function loadConfig(): StoredConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as StoredConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: StoredConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

export function clearConfig(): void {
  rmSync(CONFIG_PATH, { force: true });
}

export function getUsername(): string | undefined {
  return process.env.ZOOMINFO_USERNAME || loadConfig().username;
}

export function setUsername(username: string): void {
  saveConfig({ ...loadConfig(), username });
}

export function getPassword(): string | undefined {
  return process.env.ZOOMINFO_PASSWORD || loadConfig().password;
}

export function setPassword(password: string): void {
  saveConfig({ ...loadConfig(), password });
}

export function getJwt(): string | undefined {
  return process.env.ZOOMINFO_JWT || loadConfig().jwt;
}

export function setJwt(jwt: string): void {
  saveConfig({ ...loadConfig(), jwt });
}

export function getBaseUrl(): string | undefined {
  return process.env.ZOOMINFO_BASE_URL || loadConfig().baseUrl;
}

export function setBaseUrl(baseUrl: string): void {
  saveConfig({ ...loadConfig(), baseUrl });
}
