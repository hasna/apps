import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.hasna', 'connectors', 'connect-unpaywall');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface CliConfig {
  email?: string;
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

export function getEmail(): string | undefined {
  return process.env.UNPAYWALL_EMAIL || loadConfig().email;
}

export function setEmail(email: string): void {
  const config = loadConfig();
  config.email = email;
  saveConfig(config);
}

export function clearConfig(): void {
  saveConfig({});
}

export function getEmailPreview(): string | undefined {
  const email = getEmail();
  if (!email) return undefined;
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  if (local.length <= 2) return `***@${domain}`;
  return `${local.slice(0, 2)}...@${domain}`;
}
