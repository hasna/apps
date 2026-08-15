import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { StackExchangeConfig } from '../types';

const CONFIG_DIR = join(homedir(), '.hasna', 'connectors', 'connect-stackexchange');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULT_SITE = 'stackoverflow';
const DEFAULT_PAGE_SIZE = 20;

export interface CliConfig {
  site?: string;
  pageSize?: number;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): CliConfig {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveConfig(config: CliConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getSite(): string {
  return process.env.STACKEXCHANGE_SITE || loadConfig().site || DEFAULT_SITE;
}

export function setSite(site: string): void {
  const config = loadConfig();
  config.site = site;
  saveConfig(config);
}

export function getPageSize(): number {
  return loadConfig().pageSize || DEFAULT_PAGE_SIZE;
}

export function setPageSize(n: number): void {
  const config = loadConfig();
  config.pageSize = n;
  saveConfig(config);
}

export function clearConfig(): void {
  saveConfig({});
}

/**
 * Resolve effective credentials/defaults. Credentials are read from env vars
 * only so they never need to be written to local config.
 */
export function resolveClientConfig(): StackExchangeConfig {
  return {
    key: process.env.STACKEXCHANGE_KEY,
    accessToken: process.env.STACKEXCHANGE_ACCESS_TOKEN,
    site: getSite(),
  };
}
