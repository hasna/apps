import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-ticketmaster';
const SHARED_CONNECTOR_NAME = 'ticketmaster';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  apiKey?: string;
  token?: string;
}

let profileOverride: string | undefined;

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function getPreferredConfigDir(): string {
  return join(getHomeDir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

function getSharedConfigDir(): string {
  return join(getHomeDir(), '.hasna', 'connectors', SHARED_CONNECTOR_NAME);
}

function getConfigDirs(): string[] {
  return [getPreferredConfigDir(), getSharedConfigDir()];
}

function getProfilesDir(configDir = getPreferredConfigDir()): string {
  return join(configDir, 'profiles');
}

function getCurrentProfileFile(configDir = getPreferredConfigDir()): string {
  return join(configDir, 'current_profile');
}

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function ensureConfigDir(): void {
  const configDir = getPreferredConfigDir();
  const profilesDir = getProfilesDir(configDir);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
  }
}

function getProfileFilePath(profile: string, configDir = getPreferredConfigDir()): string {
  return join(getProfilesDir(configDir), `${profile}.json`);
}

function getProfileConfigPath(profile: string, configDir = getPreferredConfigDir()): string {
  return join(getProfilesDir(configDir), profile, 'config.json');
}

function getProfileReadPaths(profile: string): string[] {
  return getConfigDirs().flatMap(configDir => [
    getProfileFilePath(profile, configDir),
    getProfileConfigPath(profile, configDir),
  ]);
}

export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureConfigDir();

  for (const configDir of getConfigDirs()) {
    const currentProfileFile = getCurrentProfileFile(configDir);
    if (!existsSync(currentProfileFile)) {
      continue;
    }
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

  writeFileSync(getCurrentProfileFile(), profile);
}

export function profileExists(profile: string): boolean {
  return getProfileReadPaths(profile).some(path => existsSync(path));
}

export function listProfiles(): string[] {
  ensureConfigDir();

  const profiles = new Set<string>();
  for (const configDir of getConfigDirs()) {
    const profilesDir = getProfilesDir(configDir);
    if (!existsSync(profilesDir)) {
      continue;
    }
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        profiles.add(entry.name.replace('.json', ''));
      } else if (entry.isDirectory() && existsSync(join(profilesDir, entry.name, 'config.json'))) {
        profiles.add(entry.name);
      }
    }
  }

  return [...profiles].sort();
}

export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  ensureConfigDir();

  if (profileExists(profile)) {
    return false;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }

  writeFileSync(getProfileFilePath(profile), JSON.stringify(config, null, 2));
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

  const preferredProfilePath = getProfileFilePath(profile);
  if (!existsSync(preferredProfilePath)) {
    return false;
  }

  rmSync(preferredProfilePath);
  return true;
}

export function loadProfile(profile?: string): ProfileConfig {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  for (const profilePath of getProfileReadPaths(profileName)) {
    if (!existsSync(profilePath)) {
      continue;
    }
    try {
      return JSON.parse(readFileSync(profilePath, 'utf-8'));
    } catch {
      return {};
    }
  }

  return {};
}

export function saveProfile(config: ProfileConfig, profile?: string): void {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  writeFileSync(getProfileFilePath(profileName), JSON.stringify(config, null, 2));
}

export function getApiKey(): string | undefined {
  return process.env.TICKETMASTER_API_KEY || loadProfile().apiKey || loadProfile().token;
}

export function setApiKey(apiKey: string): void {
  const config = loadProfile();
  config.apiKey = apiKey;
  config.token = apiKey;
  saveProfile(config);
}

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return getPreferredConfigDir();
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}
