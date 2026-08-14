import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'topaz-labs';
const DEFAULT_PROFILE = 'default';
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export interface ProfileConfig {
  apiKey?: string;
  token?: string;
  apiSecret?: string;
}

let profileOverride: string | undefined;

function getHomeDir(): string {
  return process.env.HOME || homedir();
}

function getConfigDirPath(): string {
  return join(getHomeDir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

function getProfilesDirPath(): string {
  return join(getConfigDirPath(), 'profiles');
}

function getCurrentProfilePath(): string {
  return join(getConfigDirPath(), 'current_profile');
}

function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: DIR_MODE });
  chmodSync(path, DIR_MODE);
}

function writePrivateFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
}

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function ensureConfigDir(): void {
  ensurePrivateDir(getConfigDirPath());
  ensurePrivateDir(getProfilesDirPath());
}

function getProfilePath(profile: string): string {
  return join(getProfilesDirPath(), `${profile}.json`);
}

export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureConfigDir();

  const currentProfileFile = getCurrentProfilePath();
  if (existsSync(currentProfileFile)) {
    chmodSync(currentProfileFile, FILE_MODE);
    try {
      const profile = readFileSync(currentProfileFile, 'utf-8').trim();
      if (profile && profileExists(profile)) {
        return profile;
      }
    } catch {
      // Fall through to default.
    }
  }

  return DEFAULT_PROFILE;
}

export function setCurrentProfile(profile: string): void {
  ensureConfigDir();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  writePrivateFile(getCurrentProfilePath(), profile);
}

export function profileExists(profile: string): boolean {
  return existsSync(getProfilePath(profile));
}

export function listProfiles(): string[] {
  ensureConfigDir();

  return readdirSync(getProfilesDirPath())
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

  writePrivateFile(getProfilePath(profile), JSON.stringify(config, null, 2));
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

  chmodSync(profilePath, FILE_MODE);
  try {
    return JSON.parse(readFileSync(profilePath, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveProfile(config: ProfileConfig, profile?: string): void {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  writePrivateFile(getProfilePath(profileName), JSON.stringify(config, null, 2));
}

export function getApiKey(): string | undefined {
  return process.env.TOPAZ_LABS_API_KEY || process.env.CONNECTOR_API_KEY || loadProfile().apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = loadProfile();
  config.apiKey = apiKey;
  saveProfile(config);
}

export function getApiSecret(): string | undefined {
  return process.env.CONNECTOR_API_SECRET || loadProfile().apiSecret;
}

export function setApiSecret(apiSecret: string): void {
  const config = loadProfile();
  config.apiSecret = apiSecret;
  saveProfile(config);
}

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return getConfigDirPath();
}

export function getProfilesDir(): string {
  return getProfilesDirPath();
}

export function getCurrentProfileFile(): string {
  return getCurrentProfilePath();
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}

export function getToken(): string | undefined {
  const profile = loadProfile();
  return process.env.TOPAZ_LABS_API_KEY ||
    process.env.CONNECTOR_TOKEN ||
    process.env.CONNECTOR_API_KEY ||
    profile.token ||
    profile.apiKey;
}

export function setToken(token: string): void {
  const config = loadProfile();
  config.token = token;
  config.apiKey = token;
  saveProfile(config);
}
