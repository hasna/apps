import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-zenserp';
const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

export interface ProfileConfig {
  apiKey?: string;
  baseUrl?: string;
}

let profileOverride: string | undefined;

function resolveBaseConfigDir(): string {
  return join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

const BASE_CONFIG_DIR = resolveBaseConfigDir();

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

function migrateToProfileStructure(): void {
  const profilesDir = getProfilesDir();

  if (existsSync(profilesDir)) {
    return;
  }

  const oldProfilesDir = join(BASE_CONFIG_DIR, 'profiles');
  const hasOldJsonProfiles = existsSync(oldProfilesDir) &&
    readdirSync(oldProfilesDir).some(f => f.endsWith('.json'));

  if (!hasOldJsonProfiles) {
    mkdirSync(profilesDir, { recursive: true });
    return;
  }

  const jsonFiles = readdirSync(oldProfilesDir).filter(f => f.endsWith('.json'));

  for (const jsonFile of jsonFiles) {
    const profileName = jsonFile.replace('.json', '');
    const newProfileDir = join(profilesDir, profileName);
    const oldJsonPath = join(oldProfilesDir, jsonFile);

    mkdirSync(newProfileDir, { recursive: true });

    if (existsSync(oldJsonPath)) {
      renameSync(oldJsonPath, join(newProfileDir, 'config.json'));
    }
  }
}

export function profileExists(profile: string): boolean {
  migrateToProfileStructure();
  const profileDir = join(getProfilesDir(), profile);
  return existsSync(profileDir);
}

export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureBaseConfigDir();
  migrateToProfileStructure();

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
  migrateToProfileStructure();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  writeFileSync(getCurrentProfileFile(), profile);
}

export function listProfiles(): string[] {
  ensureBaseConfigDir();
  migrateToProfileStructure();

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    return [];
  }

  return readdirSync(profilesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort();
}

export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  ensureBaseConfigDir();
  migrateToProfileStructure();

  if (profileExists(profile)) {
    return false;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }

  const profileDir = join(getProfilesDir(), profile);
  mkdirSync(profileDir, { recursive: true });

  if (Object.keys(config).length > 0) {
    writeFileSync(join(profileDir, 'config.json'), JSON.stringify(config, null, 2));
  }

  return true;
}

export function deleteProfile(profile: string): boolean {
  if (profile === DEFAULT_PROFILE) {
    return false;
  }

  if (!profileExists(profile)) {
    return false;
  }

  if (getCurrentProfile() === profile) {
    setCurrentProfile(DEFAULT_PROFILE);
  }

  const profileDir = join(getProfilesDir(), profile);
  rmSync(profileDir, { recursive: true });
  return true;
}

function resolveConfigDir(): string {
  ensureBaseConfigDir();
  migrateToProfileStructure();

  const profile = getCurrentProfile();
  const profileDir = join(getProfilesDir(), profile);

  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }

  return profileDir;
}

function getConfigDirInternal(): string {
  return resolveConfigDir();
}

export function getConfigDir(): string {
  return getConfigDirInternal();
}

export function getBaseConfigDir(): string {
  return BASE_CONFIG_DIR;
}

export function ensureConfigDir(): void {
  const configDir = getConfigDirInternal();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

export function loadProfile(profile?: string): ProfileConfig {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  const profileDir = join(getProfilesDir(), profileName);
  const configFile = join(profileDir, 'config.json');

  if (!existsSync(configFile)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(configFile, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveProfile(config: ProfileConfig, profile?: string): void {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  const profileDir = join(getProfilesDir(), profileName);

  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }

  writeFileSync(join(profileDir, 'config.json'), JSON.stringify(config, null, 2));
}

export function getApiKey(): string | undefined {
  return process.env.ZENSERP_API_KEY || loadProfile().apiKey;
}

export function getBaseUrl(): string | undefined {
  return process.env.ZENSERP_BASE_URL || loadProfile().baseUrl;
}

export function setApiKey(apiKey: string): void {
  const config = loadProfile();
  config.apiKey = apiKey;
  saveProfile(config);
}

export function clearConfig(): void {
  saveProfile({});
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}
