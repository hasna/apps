import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-sprout-social';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  accessToken?: string;
  customerId?: string;
}

let profileOverride: string | undefined;

const CONFIG_DIR = process.env.SPROUTSOCIAL_CONFIG_DIR || join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const CURRENT_PROFILE_FILE = join(CONFIG_DIR, 'current_profile');
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 });
  }
}

function isValidProfileName(profile: string): boolean {
  return PROFILE_NAME_PATTERN.test(profile);
}

function assertValidProfileName(profile: string): void {
  if (!isValidProfileName(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }
}

function getProfilePath(profile: string): string {
  assertValidProfileName(profile);
  return join(PROFILES_DIR, `${profile}.json`);
}

function writeProfileFile(profile: string, config: ProfileConfig): void {
  const profilePath = getProfilePath(profile);
  writeFileSync(profilePath, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(profilePath, 0o600);
}

export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureConfigDir();

  if (existsSync(CURRENT_PROFILE_FILE)) {
    try {
      const profile = readFileSync(CURRENT_PROFILE_FILE, 'utf-8').trim();
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
  assertValidProfileName(profile);
  ensureConfigDir();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  writeFileSync(CURRENT_PROFILE_FILE, profile);
}

export function profileExists(profile: string): boolean {
  if (!isValidProfileName(profile)) {
    return false;
  }

  return existsSync(getProfilePath(profile));
}

export function listProfiles(): string[] {
  ensureConfigDir();

  if (!existsSync(PROFILES_DIR)) {
    return [];
  }

  return readdirSync(PROFILES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();
}

export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  assertValidProfileName(profile);
  ensureConfigDir();

  if (profileExists(profile)) {
    return false;
  }

  writeProfileFile(profile, config);
  return true;
}

export function deleteProfile(profile: string): boolean {
  assertValidProfileName(profile);

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
  const profileName = profile || getCurrentProfile();
  assertValidProfileName(profileName);
  ensureConfigDir();
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
  const profileName = profile || getCurrentProfile();
  assertValidProfileName(profileName);
  ensureConfigDir();
  writeProfileFile(profileName, config);
}

export function getAccessToken(): string | undefined {
  return process.env.SPROUTSOCIAL_ACCESS_TOKEN || loadProfile().accessToken;
}

export function setAccessToken(accessToken: string): void {
  const config = loadProfile();
  config.accessToken = accessToken;
  saveProfile(config);
}

export function getCustomerId(): string | undefined {
  return process.env.SPROUTSOCIAL_CUSTOMER_ID || loadProfile().customerId;
}

export function setCustomerId(customerId: string): void {
  const config = loadProfile();
  config.customerId = customerId;
  saveProfile(config);
}

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}
