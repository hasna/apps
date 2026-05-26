import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.hasna', 'connectors', 'connect-arxiv');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface CliConfig {
  defaultCategory?: string;
  maxResults?: number;
  outputDir?: string;
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

export function getDefaultCategory(): string | undefined {
  return process.env.ARXIV_CATEGORY || loadConfig().defaultCategory;
}

export function setDefaultCategory(category: string): void {
  const config = loadConfig();
  config.defaultCategory = category;
  saveConfig(config);
}

export function getMaxResults(): number {
  const envVal = process.env.ARXIV_MAX_RESULTS;
  if (envVal) return parseInt(envVal, 10);
  return loadConfig().maxResults || 10;
}

export function setMaxResults(n: number): void {
  const config = loadConfig();
  config.maxResults = n;
  saveConfig(config);
}

export function getOutputDir(): string {
  return process.env.ARXIV_OUTPUT_DIR || loadConfig().outputDir || '.';
}

export function setOutputDir(dir: string): void {
  const config = loadConfig();
  config.outputDir = dir;
  saveConfig(config);
}

export function clearConfig(): void {
  saveConfig({});
}
