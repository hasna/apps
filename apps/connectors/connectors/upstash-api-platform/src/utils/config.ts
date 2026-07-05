import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-upstash-api-platform';
const DEFAULT_PROFILE = 'default';
const CONFIG_DIR_MODE = 0o700;
const CONFIG_FILE_MODE = 0o600;
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface ProfileConfig {
  email?: string;
  apiKey?: string;
}

let profileOverride: string | undefined;
let emailOverride: string | undefined;
let apiKeyOverride: string | undefined;

const CONFIG_DIR = process.env.UPSTASH_API_PLATFORM_CONFIG_DIR || join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const CURRENT_PROFILE_FILE = join(CONFIG_DIR, 'current_profile');

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function setCredentialOverride(email: string | undefined, apiKey: string | undefined): void {
  emailOverride = email;
  apiKeyOverride = apiKey;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: CONFIG_DIR_MODE });
  }
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true, mode: CONFIG_DIR_MODE });
  }
  chmodSync(CONFIG_DIR, CONFIG_DIR_MODE);
  chmodSync(PROFILES_DIR, CONFIG_DIR_MODE);
}

function validateProfileName(profile: string): void {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }
}

function getProfilePath(profile: string): string {
  validateProfileName(profile);
  return join(PROFILES_DIR, `${profile}.json`);
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
      // fall through
    }
  }

  return DEFAULT_PROFILE;
}

export function setCurrentProfile(profile: string): void {
  ensureConfigDir();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  writeFileSync(CURRENT_PROFILE_FILE, profile, { mode: CONFIG_FILE_MODE });
  chmodSync(CURRENT_PROFILE_FILE, CONFIG_FILE_MODE);
}

export function profileExists(profile: string): boolean {
  return existsSync(getProfilePath(profile));
}

export function listProfiles(): string[] {
  ensureConfigDir();

  if (!existsSync(PROFILES_DIR)) {
    return [];
  }

  return readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
    .sort();
}

export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  ensureConfigDir();

  if (profileExists(profile)) {
    return false;
  }

  writeFileSync(getProfilePath(profile), JSON.stringify(config, null, 2), { mode: CONFIG_FILE_MODE });
  chmodSync(getProfilePath(profile), CONFIG_FILE_MODE);
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
  writeFileSync(getProfilePath(profileName), JSON.stringify(config, null, 2), { mode: CONFIG_FILE_MODE });
  chmodSync(getProfilePath(profileName), CONFIG_FILE_MODE);
}

export function getEmail(): string | undefined {
  return emailOverride || process.env.UPSTASH_EMAIL || loadProfile().email;
}

export function setEmail(email: string): void {
  const config = loadProfile();
  config.email = email;
  saveProfile(config);
}

export function getApiKey(): string | undefined {
  return apiKeyOverride || process.env.UPSTASH_API_KEY || loadProfile().apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = loadProfile();
  config.apiKey = apiKey;
  saveProfile(config);
}

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function isConfigured(): boolean {
  return Boolean(getEmail() && getApiKey());
}
