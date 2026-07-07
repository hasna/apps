import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'tenable';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  // Tenable API key authentication
  accessKey?: string;
  secretKey?: string;
  baseUrl?: string;
}

// Store for --profile flag override (set by CLI before commands run)
let profileOverride: string | undefined;

// Config directory: ~/.hasna/connectors/{connector-name}/
const CONFIG_DIR = join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const CURRENT_PROFILE_FILE = join(CONFIG_DIR, 'current_profile');
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

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
  try {
    chmodSync(CONFIG_DIR, PRIVATE_DIR_MODE);
  } catch {
    // Best effort for platforms/filesystems that do not support POSIX modes.
  }
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true, mode: PRIVATE_DIR_MODE });
  }
  try {
    chmodSync(PROFILES_DIR, PRIVATE_DIR_MODE);
  } catch {
    // Best effort for platforms/filesystems that do not support POSIX modes.
  }
}

function getProfilePath(profile: string): string {
  return join(PROFILES_DIR, `${profile}.json`);
}

/**
 * Get the current active profile name
 */
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

/**
 * Set the current active profile
 */
export function setCurrentProfile(profile: string): void {
  ensureConfigDir();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  writeFileSync(CURRENT_PROFILE_FILE, profile, { mode: PRIVATE_FILE_MODE });
  try {
    chmodSync(CURRENT_PROFILE_FILE, PRIVATE_FILE_MODE);
  } catch {
    // Best effort for platforms/filesystems that do not support POSIX modes.
  }
}

/**
 * Check if a profile exists
 */
export function profileExists(profile: string): boolean {
  return existsSync(getProfilePath(profile));
}

/**
 * List all available profiles
 */
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

/**
 * Create a new profile
 */
export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  ensureConfigDir();

  if (profileExists(profile)) {
    return false;
  }

  // Validate profile name
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }

  writeProfileFile(getProfilePath(profile), config);
  return true;
}

/**
 * Delete a profile
 */
export function deleteProfile(profile: string): boolean {
  if (profile === DEFAULT_PROFILE) {
    return false;
  }

  if (!profileExists(profile)) {
    return false;
  }

  // Switch to default if deleting current profile
  if (getCurrentProfile() === profile) {
    setCurrentProfile(DEFAULT_PROFILE);
  }

  rmSync(getProfilePath(profile));
  return true;
}

/**
 * Load profile config
 */
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

/**
 * Save profile config
 */
export function saveProfile(config: ProfileConfig, profile?: string): void {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  writeProfileFile(getProfilePath(profileName), config);
}

function writeProfileFile(path: string, config: ProfileConfig): void {
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: PRIVATE_FILE_MODE });
  try {
    chmodSync(path, PRIVATE_FILE_MODE);
  } catch {
    // Best effort for platforms/filesystems that do not support POSIX modes.
  }
}

// ============================================
// Credential Management
// Tenable uses an access key + secret key pair.
// ============================================

export function getAccessKey(): string | undefined {
  return process.env.TENABLE_ACCESS_KEY || loadProfile().accessKey;
}

export function setAccessKey(accessKey: string): void {
  const config = loadProfile();
  config.accessKey = accessKey;
  saveProfile(config);
}

export function getSecretKey(): string | undefined {
  return process.env.TENABLE_SECRET_KEY || loadProfile().secretKey;
}

export function setSecretKey(secretKey: string): void {
  const config = loadProfile();
  config.secretKey = secretKey;
  saveProfile(config);
}

export function getBaseUrl(): string | undefined {
  return process.env.TENABLE_BASE_URL || loadProfile().baseUrl;
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

export function getActiveProfileName(): string {
  return getCurrentProfile();
}
