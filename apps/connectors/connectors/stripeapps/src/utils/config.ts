import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'stripeapps';
const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

export interface ProfileConfig {
  apiKey?: string;
  baseUrl?: string;
}

// Store for --profile flag override (set by CLI before commands run)
let profileOverride: string | undefined;

// Store config in ~/.hasna/connectors/stripeapps/ (always in home directory)
function resolveBaseConfigDir(): string {
  return join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

const BASE_CONFIG_DIR = resolveBaseConfigDir();

// ============================================
// Profile Management
// ============================================

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

function ensureProfilesDir(): void {
  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
  }
}

export function profileExists(profile: string): boolean {
  ensureProfilesDir();
  return existsSync(join(getProfilesDir(), profile));
}

export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureBaseConfigDir();
  ensureProfilesDir();

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
  ensureProfilesDir();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  writeFileSync(getCurrentProfileFile(), profile);
}

export function listProfiles(): string[] {
  ensureBaseConfigDir();
  ensureProfilesDir();

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
  ensureProfilesDir();

  if (profileExists(profile)) {
    return false;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }

  const profileDir = join(getProfilesDir(), profile);
  mkdirSync(profileDir, { recursive: true });

  const cleaned = stripUndefined(config);
  if (Object.keys(cleaned).length > 0) {
    writeFileSync(join(profileDir, 'config.json'), JSON.stringify(cleaned, null, 2));
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
  ensureProfilesDir();

  const profileDir = join(getProfilesDir(), getCurrentProfile());
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

export function ensureConfigDir(): void {
  resolveConfigDir();
}

// ============================================
// Profile Config Loading/Saving
// ============================================

export function loadProfile(profile?: string): ProfileConfig {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  const configFile = join(getProfilesDir(), profileName, 'config.json');

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

  writeFileSync(join(profileDir, 'config.json'), JSON.stringify(stripUndefined(config), null, 2));
}

function stripUndefined(config: ProfileConfig): ProfileConfig {
  const result: ProfileConfig = {};
  if (config.apiKey !== undefined) result.apiKey = config.apiKey;
  if (config.baseUrl !== undefined) result.baseUrl = config.baseUrl;
  return result;
}

// ============================================
// Credential Accessors
// ============================================

export function getApiKey(): string | undefined {
  return process.env.STRIPEAPPS_API_KEY || loadProfile().apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = loadProfile();
  config.apiKey = apiKey;
  saveProfile(config);
}

export function getBaseUrl(): string | undefined {
  return process.env.STRIPEAPPS_BASE_URL || loadProfile().baseUrl;
}

export function setBaseUrl(baseUrl: string): void {
  const config = loadProfile();
  config.baseUrl = baseUrl;
  saveProfile(config);
}

// ============================================
// Utility Functions
// ============================================

export function clearConfig(): void {
  saveProfile({});
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}
