import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { CliConfig, LibraryType } from '../types';

const CONNECTOR_NAME = 'connect-zotero';
const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

let profileOverride: string | undefined;

const BASE_CONFIG_DIR = join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function getProfileOverride(): string | undefined {
  return profileOverride;
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
      // Fall through to default
    }
  }

  return DEFAULT_PROFILE;
}

export function setCurrentProfile(profile: string): void {
  ensureBaseConfigDir();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist. Create it first with "profile create ${profile}"`);
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
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
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

  const currentProfile = getCurrentProfile();
  if (currentProfile === profile) {
    setCurrentProfile(DEFAULT_PROFILE);
  }

  const profileDir = join(getProfilesDir(), profile);
  rmSync(profileDir, { recursive: true });
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

export function getBaseConfigDir(): string {
  return BASE_CONFIG_DIR;
}

export function ensureConfigDir(): void {
  getProfileDir();
}

export function loadConfig(): CliConfig {
  ensureConfigDir();
  const configFile = join(getProfileDir(), 'config.json');

  if (!existsSync(configFile)) {
    return {};
  }

  try {
    const content = readFileSync(configFile, 'utf-8');
    return JSON.parse(content) as CliConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: CliConfig): void {
  ensureConfigDir();
  const configFile = join(getProfileDir(), 'config.json');
  writeFileSync(configFile, JSON.stringify(config, null, 2));
}

export function getApiKey(): string | undefined {
  return process.env.ZOTERO_API_KEY || loadConfig().apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = loadConfig();
  config.apiKey = apiKey;
  saveConfig(config);
}

export function getLibraryId(): string | undefined {
  return process.env.ZOTERO_LIBRARY_ID || loadConfig().libraryId;
}

export function setLibraryId(libraryId: string): void {
  const config = loadConfig();
  config.libraryId = libraryId;
  saveConfig(config);
}

export function getLibraryType(): LibraryType {
  const raw = process.env.ZOTERO_LIBRARY_TYPE || loadConfig().libraryType || 'users';
  return raw === 'groups' || raw === 'group' ? 'groups' : 'users';
}

export function setLibraryType(libraryType: LibraryType | 'group'): void {
  const config = loadConfig();
  config.libraryType = libraryType;
  saveConfig(config);
}

export function getBaseUrl(): string | undefined {
  return process.env.ZOTERO_BASE_URL || loadConfig().baseUrl;
}

export function setBaseUrl(baseUrl: string): void {
  const config = loadConfig();
  config.baseUrl = baseUrl;
  saveConfig(config);
}

export function clearConfig(): void {
  saveConfig({});
}

export function isAuthenticated(): boolean {
  const apiKey = getApiKey();
  const libraryId = getLibraryId();
  return Boolean(apiKey && libraryId);
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}

export function getZoteroConfigFromEnv(): {
  apiKey?: string;
  libraryId?: string;
  libraryType: LibraryType;
  baseUrl?: string;
} {
  return {
    apiKey: getApiKey(),
    libraryId: getLibraryId(),
    libraryType: getLibraryType(),
    baseUrl: getBaseUrl(),
  };
}
