import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ProfileConfig } from '../types';

const APP_NAME = 'connect-reducto';

// Profile override for CLI -p flag
let profileOverride: string | undefined;

export function setProfileOverride(profile: string): void {
  profileOverride = profile;
}

export function getBaseConfigDir(): string {
  return join(homedir(), '.connect', APP_NAME);
}

export function getConfigDir(): string {
  const profile = getCurrentProfile();
  return join(getBaseConfigDir(), 'profiles', profile);
}

export function ensureConfigDir(): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  const profileFile = join(getBaseConfigDir(), 'current_profile');
  if (existsSync(profileFile)) {
    return readFileSync(profileFile, 'utf-8').trim() || 'default';
  }
  return 'default';
}

export function setCurrentProfile(name: string): void {
  const profileDir = join(getBaseConfigDir(), 'profiles', name);
  if (!existsSync(profileDir)) {
    throw new Error(`Profile "${name}" does not exist`);
  }

  const baseDir = getBaseConfigDir();
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true });
  }

  writeFileSync(join(baseDir, 'current_profile'), name);
}

export function listProfiles(): string[] {
  const profilesDir = join(getBaseConfigDir(), 'profiles');
  if (!existsSync(profilesDir)) {
    return [];
  }

  return readdirSync(profilesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
}

export function createProfile(name: string): boolean {
  const profileDir = join(getBaseConfigDir(), 'profiles', name);
  if (existsSync(profileDir)) {
    return false;
  }

  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, 'config.json'), JSON.stringify({}, null, 2));
  return true;
}

export function deleteProfile(name: string): boolean {
  if (name === 'default') {
    return false;
  }

  const profileDir = join(getBaseConfigDir(), 'profiles', name);
  if (!existsSync(profileDir)) {
    return false;
  }

  rmSync(profileDir, { recursive: true });

  // Switch to default if deleting current profile
  if (getCurrentProfile() === name) {
    setCurrentProfile('default');
  }

  return true;
}

export function loadProfile(): ProfileConfig {
  ensureConfigDir();
  const configFile = join(getConfigDir(), 'config.json');

  if (existsSync(configFile)) {
    const content = readFileSync(configFile, 'utf-8');
    return JSON.parse(content) as ProfileConfig;
  }

  return {};
}

export function saveProfile(config: ProfileConfig): void {
  ensureConfigDir();
  const configFile = join(getConfigDir(), 'config.json');
  writeFileSync(configFile, JSON.stringify(config, null, 2));
}

export function getApiKey(): string | undefined {
  // Check environment variable first
  const envKey = process.env.REDUCTO_API_KEY;
  if (envKey) {
    return envKey;
  }

  // Fall back to profile config
  const config = loadProfile();
  return config.apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = loadProfile();
  config.apiKey = apiKey;
  saveProfile(config);
}

export function clearApiKey(): void {
  const config = loadProfile();
  delete config.apiKey;
  saveProfile(config);
}

export function clearConfig(): void {
  ensureConfigDir();
  saveProfile({});
}
