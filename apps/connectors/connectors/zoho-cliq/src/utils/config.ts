import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { CliConfig } from '../types';

const CONNECTOR_NAME = 'connect-zoho-cliq';
const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

let profileOverride: string | undefined;

const BASE_CONFIG_DIR = join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

function ensureBaseConfigDir(): void {
  if (!existsSync(BASE_CONFIG_DIR)) {
    mkdirSync(BASE_CONFIG_DIR, { recursive: true });
  }
}

function getProfilesDir(): string {
  return join(BASE_CONFIG_DIR, PROFILES_DIR);
}

function getCurrentProfileFile(): string {
  return join(BASE_CONFIG_DIR, CURRENT_PROFILE_FILE);
}

export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureBaseConfigDir();

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
  }

  const currentProfileFile = getCurrentProfileFile();
  if (existsSync(currentProfileFile)) {
    try {
      const profile = readFileSync(currentProfileFile, 'utf-8').trim();
      if (profile && profileExists(profile)) {
        return profile;
      }
    } catch {
      // fall through
    }
  }

  return DEFAULT_PROFILE;
}

export function setCurrentProfile(profile: string): void {
  ensureBaseConfigDir();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist. Create it with "profile create ${profile}"`);
  }

  writeFileSync(getCurrentProfileFile(), profile);
}

export function profileExists(profile: string): boolean {
  const profileDir = join(getProfilesDir(), profile);
  return existsSync(profileDir);
}

export function listProfiles(): string[] {
  ensureBaseConfigDir();

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    return [];
  }

  return readdirSync(profilesDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort();
}

export function createProfile(profile: string): void {
  ensureBaseConfigDir();

  if (profileExists(profile)) {
    throw new Error(`Profile "${profile}" already exists`);
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }

  const profileDir = join(getProfilesDir(), profile);
  mkdirSync(profileDir, { recursive: true });
}

export function deleteProfile(profile: string): void {
  if (profile === DEFAULT_PROFILE) {
    throw new Error('Cannot delete the default profile');
  }

  if (!profileExists(profile)) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  if (getCurrentProfile() === profile) {
    setCurrentProfile(DEFAULT_PROFILE);
  }

  rmSync(join(getProfilesDir(), profile), { recursive: true });
}

function getProfileDir(): string {
  ensureBaseConfigDir();

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
  }

  const profile = getCurrentProfile();
  const profileDir = join(profilesDir, profile);

  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }

  return profileDir;
}

export function getConfigDir(): string {
  return getProfileDir();
}

export function loadConfig(): CliConfig {
  const configFile = join(getProfileDir(), 'config.json');

  if (!existsSync(configFile)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(configFile, 'utf-8')) as CliConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: CliConfig): void {
  const configFile = join(getProfileDir(), 'config.json');
  writeFileSync(configFile, JSON.stringify(config, null, 2));
}

export function getToken(): string | undefined {
  return process.env.ZOHO_CLIQ_TOKEN || loadConfig().token;
}

export function setToken(token: string): void {
  const config = loadConfig();
  config.token = token;
  saveConfig(config);
}

export function getDataCenter(): string {
  return process.env.ZOHO_CLIQ_DATA_CENTER || loadConfig().dataCenter || 'com';
}

export function setDataCenter(dataCenter: string): void {
  const config = loadConfig();
  config.dataCenter = dataCenter;
  saveConfig(config);
}

export function getBaseUrl(): string | undefined {
  return process.env.ZOHO_CLIQ_BASE_URL;
}

export function clearConfig(): void {
  saveConfig({});
}

export function isAuthenticated(): boolean {
  const token = getToken();
  return token !== undefined && token !== '';
}
