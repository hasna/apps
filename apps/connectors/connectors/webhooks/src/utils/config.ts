import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { ProfileConfig } from '../types';

const CONNECTOR_NAME = 'connect-webhooks';
const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

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

export function profileExists(profile: string): boolean {
  const profileDir = join(getProfilesDir(), profile);
  return existsSync(profileDir);
}

export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureBaseConfigDir();
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
    throw new Error(`Profile "${profile}" does not exist`);
  }
  writeFileSync(getCurrentProfileFile(), profile);
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

export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  ensureBaseConfigDir();
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
  rmSync(join(getProfilesDir(), profile), { recursive: true });
  return true;
}

function resolveConfigDir(): string {
  ensureBaseConfigDir();
  const profile = getCurrentProfile();
  const profileDir = join(getProfilesDir(), profile);
  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }
  return profileDir;
}

export function getConfigDir(): string {
  return resolveConfigDir();
}

export function getBaseConfigDir(): string {
  return BASE_CONFIG_DIR;
}

export function loadProfile(profile?: string): ProfileConfig {
  const profileName = profile || getCurrentProfile();
  const configFile = join(getProfilesDir(), profileName, 'config.json');
  if (!existsSync(configFile)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(configFile, 'utf-8')) as ProfileConfig;
  } catch {
    return {};
  }
}

export function saveProfile(config: ProfileConfig, profile?: string): void {
  const profileName = profile || getCurrentProfile();
  const profileDir = join(getProfilesDir(), profileName);
  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }
  writeFileSync(join(profileDir, 'config.json'), JSON.stringify(config, null, 2));
}

export function getDefaultUrl(): string | undefined {
  return process.env.WEBHOOKS_DEFAULT_URL || loadProfile().defaultUrl;
}

export function setDefaultUrl(defaultUrl: string): void {
  const config = loadProfile();
  config.defaultUrl = defaultUrl;
  saveProfile(config);
}

export function getSigningSecret(): string | undefined {
  return process.env.WEBHOOKS_SIGNING_SECRET || loadProfile().signingSecret;
}

export function setSigningSecret(signingSecret: string): void {
  const config = loadProfile();
  config.signingSecret = signingSecret;
  saveProfile(config);
}

export function clearConfig(): void {
  saveProfile({});
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}
