import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { DEFAULT_BASE_URL } from '../api/client';

const CONNECTOR_NAME = 'connect-zerosettle';
const CONFIG_NAME = 'zerosettle';
const DEFAULT_PROFILE = 'default';
const CONNECTORS_HOME = process.env.HASNA_CONNECTORS_DIR ?? join(homedir(), '.hasna', 'connectors');

export interface ProfileConfig {
  publishableKey?: string;
  apiKey?: string;
  baseUrl?: string;
}

let profileOverride: string | undefined;

const CONFIG_DIR = join(CONNECTORS_HOME, CONFIG_NAME);
const LEGACY_CONFIG_DIR = join(CONNECTORS_HOME, CONNECTOR_NAME);
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const CURRENT_PROFILE_FILE = join(CONFIG_DIR, 'current_profile');

function getConfigReadDirs(): string[] {
  return CONFIG_DIR === LEGACY_CONFIG_DIR ? [CONFIG_DIR] : [CONFIG_DIR, LEGACY_CONFIG_DIR];
}

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

function getProfilePath(profile: string): string {
  return join(PROFILES_DIR, `${profile}.json`);
}

function getProfileReadPaths(profile: string): string[] {
  return getConfigReadDirs().flatMap((dir) => [
    join(dir, 'profiles', `${profile}.json`),
    join(dir, 'profiles', profile, 'config.json'),
  ]);
}

function getExistingProfilePath(profile: string): string | undefined {
  return getProfileReadPaths(profile).find((path) => existsSync(path));
}

function readProfileNameFrom(dir: string): string | undefined {
  const currentProfileFile = join(dir, 'current_profile');
  if (!existsSync(currentProfileFile)) {
    return undefined;
  }
  try {
    return readFileSync(currentProfileFile, 'utf-8').trim() || undefined;
  } catch {
    return undefined;
  }
}

export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureConfigDir();

  for (const dir of getConfigReadDirs()) {
    const profile = readProfileNameFrom(dir);
    if (profile && profileExists(profile)) {
      return profile;
    }
  }

  return DEFAULT_PROFILE;
}

export function setCurrentProfile(profile: string): void {
  ensureConfigDir();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  writeFileSync(CURRENT_PROFILE_FILE, profile);
}

export function profileExists(profile: string): boolean {
  return getProfileReadPaths(profile).some((path) => existsSync(path));
}

export function listProfiles(): string[] {
  ensureConfigDir();

  const profiles = new Set<string>();

  for (const dir of getConfigReadDirs()) {
    const profilesDir = join(dir, 'profiles');
    if (!existsSync(profilesDir)) {
      continue;
    }
    for (const entry of readdirSync(profilesDir)) {
      const fullPath = join(profilesDir, entry);
      try {
        if (entry.endsWith('.json')) {
          profiles.add(entry.replace(/\.json$/, ''));
        } else if (statSync(fullPath).isDirectory()) {
          profiles.add(entry);
        }
      } catch {
        // Ignore entries that disappear during listing.
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

  writeFileSync(getProfilePath(profile), JSON.stringify(config, null, 2));
  return true;
}

export function deleteProfile(profile: string): boolean {
  if (profile === DEFAULT_PROFILE) {
    return false;
  }

  const profilePath = getExistingProfilePath(profile);
  if (!profilePath) {
    return false;
  }

  if (getCurrentProfile() === profile) {
    setCurrentProfile(DEFAULT_PROFILE);
  }

  rmSync(profilePath, { recursive: true, force: true });
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
      return JSON.parse(readFileSync(profilePath, 'utf-8')) as ProfileConfig;
    } catch {
      return {};
    }
  }

  return {};
}

export function saveProfile(config: ProfileConfig, profile?: string): void {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  writeFileSync(getProfilePath(profileName), JSON.stringify(config, null, 2));
}

export function getPublishableKey(): string | undefined {
  const profile = loadProfile();
  return process.env.ZEROSETTLE_PUBLISHABLE_KEY || process.env.ZEROSETTLE_API_KEY || profile.publishableKey || profile.apiKey;
}

export function setPublishableKey(publishableKey: string): void {
  const config = loadProfile();
  config.publishableKey = publishableKey;
  config.apiKey = publishableKey;
  saveProfile(config);
}

export function getBaseUrl(): string {
  return process.env.ZEROSETTLE_BASE_URL || loadProfile().baseUrl || DEFAULT_BASE_URL;
}

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}
