import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

const CONNECTOR_NAME = 'solcast';
const LEGACY_CONNECTOR_NAME = 'connect-solcast';
const DEFAULT_PROFILE = 'default';
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

export interface CliConfig {
  apiKey?: string;
  baseUrl?: string;
}

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function getHasnaDir(): string {
  return join(getHomeDir(), '.hasna');
}

function getConnectorsHome(): string {
  return join(getHasnaDir(), 'connectors');
}

function getPreferredConfigDir(): string {
  return join(getConnectorsHome(), CONNECTOR_NAME);
}

function getLegacyConfigDir(): string {
  return join(getConnectorsHome(), LEGACY_CONNECTOR_NAME);
}

function getConfigReadDirs(): string[] {
  return [getPreferredConfigDir(), getLegacyConfigDir()];
}

function chmodIfPossible(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Best-effort hardening for platforms/filesystems that support POSIX modes.
  }
}

function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodIfPossible(path, PRIVATE_DIR_MODE);
}

function normalizeProfileName(profile: string): string {
  const trimmed = profile.trim();
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    !PROFILE_NAME_PATTERN.test(trimmed)
  ) {
    return DEFAULT_PROFILE;
  }
  return trimmed;
}

function ensureWritableProfileDir(profile: string): string {
  profile = normalizeProfileName(profile);
  const configDir = getPreferredConfigDir();
  const profilesDir = join(configDir, 'profiles');
  const profileDir = join(profilesDir, profile);

  ensurePrivateDir(getHasnaDir());
  ensurePrivateDir(getConnectorsHome());
  ensurePrivateDir(configDir);
  ensurePrivateDir(profilesDir);
  ensurePrivateDir(profileDir);

  return profileDir;
}

function readJsonConfig(path: string): CliConfig {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as CliConfig)
      : {};
  } catch {
    return {};
  }
}

function writePrivateJson(path: string, config: CliConfig): void {
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: PRIVATE_FILE_MODE });
  chmodIfPossible(path, PRIVATE_FILE_MODE);
}

function getCurrentProfile(): string {
  for (const configDir of getConfigReadDirs()) {
    const currentProfileFile = join(configDir, 'current_profile');
    if (!existsSync(currentProfileFile)) {
      continue;
    }
    try {
      return normalizeProfileName(readFileSync(currentProfileFile, 'utf-8'));
    } catch {
      return DEFAULT_PROFILE;
    }
  }
  return DEFAULT_PROFILE;
}

function loadConfigFromDir(configDir: string, profile: string): CliConfig {
  profile = normalizeProfileName(profile);
  const rootConfig = readJsonConfig(join(configDir, 'config.json'));
  const flatProfileConfig = readJsonConfig(join(configDir, 'profiles', `${profile}.json`));
  const profileDirConfig = readJsonConfig(join(configDir, 'profiles', profile, 'config.json'));

  return {
    ...rootConfig,
    ...flatProfileConfig,
    ...profileDirConfig,
  };
}

function getConfigFilePaths(configDir: string, profile: string): string[] {
  profile = normalizeProfileName(profile);
  return [
    join(configDir, 'config.json'),
    join(configDir, 'profiles', `${profile}.json`),
    join(configDir, 'profiles', profile, 'config.json'),
  ];
}

function clearConfigFileIfExists(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  ensurePrivateDir(dirname(path));
  writePrivateJson(path, {});
  return true;
}

export function loadConfig(): CliConfig {
  const profile = getCurrentProfile();
  const merged: CliConfig = {};

  for (const configDir of getConfigReadDirs().reverse()) {
    Object.assign(merged, loadConfigFromDir(configDir, profile));
  }

  return merged;
}

export function saveConfig(config: CliConfig): void {
  const profile = getCurrentProfile();
  const profileDir = ensureWritableProfileDir(profile);
  writePrivateJson(join(profileDir, 'config.json'), config);
}

export function getApiKey(): string | undefined {
  return process.env.SOLCAST_API_KEY || loadConfig().apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = loadConfig();
  config.apiKey = apiKey;
  saveConfig(config);
}

export function getBaseUrl(): string | undefined {
  return process.env.SOLCAST_BASE_URL || loadConfig().baseUrl;
}

export function setBaseUrl(baseUrl: string): void {
  const config = loadConfig();
  config.baseUrl = baseUrl;
  saveConfig(config);
}

export function clearConfig(): void {
  const profile = getCurrentProfile();
  const preferredConfigDir = getPreferredConfigDir();
  let clearedPreferredConfig = false;

  for (const configDir of getConfigReadDirs()) {
    for (const path of getConfigFilePaths(configDir, profile)) {
      const cleared = clearConfigFileIfExists(path);
      if (cleared && configDir === preferredConfigDir) {
        clearedPreferredConfig = true;
      }
    }
  }

  if (!clearedPreferredConfig) {
    saveConfig({});
  }
}
