import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-stitch-data';
const DEFAULT_PROFILE = 'default';
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export interface ProfileConfig {
  accessToken?: string;
  clientId?: number;
  baseUrl?: string;
}

// Store for --profile flag override (set by CLI before commands run)
let profileOverride: string | undefined;

// Config directory: ~/.hasna/connectors/{connector-name}/
const CONFIG_DIR = join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const CURRENT_PROFILE_FILE = join(CONFIG_DIR, 'current_profile');

// ============================================
// Profile Management
// ============================================

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: PRIVATE_DIR_MODE });
  }
  chmodSync(CONFIG_DIR, PRIVATE_DIR_MODE);

  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true, mode: PRIVATE_DIR_MODE });
  }
  chmodSync(PROFILES_DIR, PRIVATE_DIR_MODE);
}

function getProfilePath(profile: string): string {
  return join(PROFILES_DIR, `${profile}.json`);
}

function writePrivateFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: PRIVATE_FILE_MODE });
  chmodSync(path, PRIVATE_FILE_MODE);
}

/** Get the current active profile name. */
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

/** Set the current active profile. */
export function setCurrentProfile(profile: string): void {
  ensureConfigDir();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  writePrivateFile(CURRENT_PROFILE_FILE, profile);
}

/** Check if a profile exists. */
export function profileExists(profile: string): boolean {
  return existsSync(getProfilePath(profile));
}

/** List all available profiles. */
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

/** Create a new profile. */
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

/** Delete a profile. */
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

/** Load profile config. */
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

/** Save profile config. */
export function saveProfile(config: ProfileConfig, profile?: string): void {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  writePrivateFile(getProfilePath(profileName), JSON.stringify(config, null, 2));
}

// ============================================
// Stitch Credentials Management
// ============================================

export function getAccessToken(): string | undefined {
  return process.env.STITCH_ACCESS_TOKEN || loadProfile().accessToken;
}

export function setAccessToken(token: string): void {
  const config = loadProfile();
  config.accessToken = token;
  saveProfile(config);
}

export function maskAccessToken(token: string): string {
  if (token.length > 8) {
    return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
  }
  return '***';
}

export function getClientId(): number | undefined {
  const envClientId = process.env.STITCH_CLIENT_ID;
  if (envClientId) {
    const parsed = Number(envClientId);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return loadProfile().clientId;
}

export function setClientId(clientId: number): void {
  const config = loadProfile();
  config.clientId = clientId;
  saveProfile(config);
}

export function getBaseUrl(): string | undefined {
  return process.env.STITCH_BASE_URL || loadProfile().baseUrl;
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

export function getConfigDir(): string {
  return CONFIG_DIR;
}
