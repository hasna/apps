import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.hasna', 'connectors', 'connect-uniprot');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface CliConfig {
  defaultSize?: number;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): CliConfig {
  ensureConfigDir();
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

export function getDefaultSize(): number {
  const envVal = process.env.UNIPROT_DEFAULT_SIZE;
  if (envVal) return parseInt(envVal, 10);
  return loadConfig().defaultSize || 25;
}

export function setDefaultSize(n: number): void {
  const config = loadConfig();
  config.defaultSize = n;
  saveConfig(config);
}

export function clearConfig(): void {
  saveConfig({});
}
