import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-split-in-batches';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  apiKey?: string;
  baseUrl?: string;
}

let profileOverride: string | undefined;

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

function getConfigDirPath(): string {
  return join(process.env.HOME || homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

function getProfilesDir(): string {
  return join(getConfigDirPath(), 'profiles');
}

function getCurrentProfileFile(): string {
  return join(getConfigDirPath(), 'current_profile');
}

export function ensureConfigDir(): void {
  const configDir = getConfigDirPath();
  const profilesDir = getProfilesDir();

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: PRIVATE_DIR_MODE });
  }
  chmodSync(configDir, PRIVATE_DIR_MODE);

  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true, mode: PRIVATE_DIR_MODE });
  }
  chmodSync(profilesDir, PRIVATE_DIR_MODE);
}

function getProfilePath(profile: string): string {
  return join(getProfilesDir(), `${profile}.json`);
}

export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureConfigDir();

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
  ensureConfigDir();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  const currentProfileFile = getCurrentProfileFile();
  writeFileSync(currentProfileFile, profile, { mode: PRIVATE_FILE_MODE });
  chmodSync(currentProfileFile, PRIVATE_FILE_MODE);
}

export function profileExists(profile: string): boolean {
  return existsSync(getProfilePath(profile));
}

export function listProfiles(): string[] {
  ensureConfigDir();

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    return [];
  }

  return readdirSync(profilesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();
}

export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  ensureConfigDir();

  if (profileExists(profile)) {
    return false;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }

  writeFileSync(getProfilePath(profile), JSON.stringify(config, null, 2), {
    mode: PRIVATE_FILE_MODE,
  });
  chmodSync(getProfilePath(profile), PRIVATE_FILE_MODE);
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

  rmSync(getProfilePath(profile));
  return true;
}

export function loadProfile(profile?: string): ProfileConfig {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  const profilePath = getProfilePath(profileName);

  if (!existsSync(profilePath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(profilePath, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveProfile(config: ProfileConfig, profile?: string): void {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  writeFileSync(getProfilePath(profileName), JSON.stringify(config, null, 2), {
    mode: PRIVATE_FILE_MODE,
  });
  chmodSync(getProfilePath(profileName), PRIVATE_FILE_MODE);
}

export function getApiKey(): string | undefined {
  return process.env.SPLIT_IN_BATCHES_API_KEY || loadProfile().apiKey;
}

export function getBaseUrl(): string | undefined {
  return process.env.SPLIT_IN_BATCHES_BASE_URL || loadProfile().baseUrl;
}

export function setApiKey(apiKey: string): void {
  const config = loadProfile();
  config.apiKey = apiKey;
  saveProfile(config);
}

export function setBaseUrl(baseUrl: string): void {
  const config = loadProfile();
  config.baseUrl = baseUrl;
  saveProfile(config);
}

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return getConfigDirPath();
}

export function getConnectorConfig(): { apiKey: string; baseUrl?: string } | undefined {
  const apiKey = getApiKey();
  if (!apiKey) {
    return undefined;
  }

  return {
    apiKey,
    baseUrl: getBaseUrl(),
  };
}
