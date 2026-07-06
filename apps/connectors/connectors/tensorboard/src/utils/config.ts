import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { DEFAULT_BASE_URL } from '../api/client';

const CONNECTOR_NAME = 'connect-tensorboard';
export { DEFAULT_BASE_URL };

export interface CliConfig {
  baseUrl?: string;
}

function configDir(): string {
  return join(process.env.HOME || homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

function configFile(): string {
  return join(configDir(), 'config.json');
}

function ensureConfigDir(): void {
  const CONFIG_DIR = configDir();
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): CliConfig {
  const CONFIG_FILE = configFile();
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
  writeFileSync(configFile(), JSON.stringify(config, null, 2));
}

/**
 * Resolve the TensorBoard base URL. Precedence:
 * 1. `TENSORBOARD_BASE_URL` environment variable
 * 2. saved config
 * 3. default (http://localhost:6006)
 */
export function getBaseUrl(): string {
  return process.env.TENSORBOARD_BASE_URL || loadConfig().baseUrl || DEFAULT_BASE_URL;
}

export function setBaseUrl(url: string): void {
  const config = loadConfig();
  config.baseUrl = url;
  saveConfig(config);
}

export function clearConfig(): void {
  saveConfig({});
}
