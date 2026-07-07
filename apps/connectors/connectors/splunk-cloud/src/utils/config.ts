import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-splunk-cloud';
const DEFAULT_PROFILE = 'default';
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export interface ProfileConfig {
  baseUrl?: string;
  token?: string;
  username?: string;
  password?: string;
}

let profileOverride: string | undefined;

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

function getConfigRoot(): string {
  return process.env.SPLUNK_CLOUD_CONFIG_DIR || join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

function getProfilesDir(): string {
  return join(getConfigRoot(), 'profiles');
}

function getCurrentProfileFile(): string {
  return join(getConfigRoot(), 'current_profile');
}

function ensurePrivateDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, mode: PRIVATE_DIR_MODE });
  }
  chmodSync(path, PRIVATE_DIR_MODE);
}

function writePrivateFile(path: string, data: string): void {
  writeFileSync(path, data, { mode: PRIVATE_FILE_MODE });
  chmodSync(path, PRIVATE_FILE_MODE);
}

export function ensureConfigDir(): void {
  ensurePrivateDir(getConfigRoot());
  ensurePrivateDir(getProfilesDir());
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

  writePrivateFile(getCurrentProfileFile(), profile);
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

export function getBaseUrl(): string | undefined {
  return process.env.SPLUNK_CLOUD_BASE_URL || loadProfile().baseUrl;
}

export function setBaseUrl(baseUrl: string): void {
  const config = loadProfile();
  config.baseUrl = baseUrl;
  saveProfile(config);
}

export function getToken(): string | undefined {
  return process.env.SPLUNK_CLOUD_TOKEN || loadProfile().token;
}

export function setToken(token: string): void {
  const config = loadProfile();
  config.token = token;
  saveProfile(config);
}

export function getUsername(): string | undefined {
  return process.env.SPLUNK_CLOUD_USERNAME || loadProfile().username;
}

export function getPassword(): string | undefined {
  return process.env.SPLUNK_CLOUD_PASSWORD || loadProfile().password;
}

export function setBasicAuth(username: string, password: string): void {
  const config = loadProfile();
  config.username = username;
  config.password = password;
  saveProfile(config);
}

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return getConfigRoot();
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}
