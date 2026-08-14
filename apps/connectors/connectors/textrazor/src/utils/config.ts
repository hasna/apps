import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-textrazor';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  apiKey?: string;
  token?: string;
}

// Store for --profile flag override (set by CLI before commands run)
let profileOverride: string | undefined;

function getConfigRoot(): string {
  return process.env.TEXTRAZOR_CONFIG_DIR || join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

function getProfilesDir(): string {
  return join(getConfigRoot(), 'profiles');
}

function getCurrentProfilePath(): string {
  return join(getConfigRoot(), 'current_profile');
}

// ============================================
// Profile Management
// ============================================

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function ensureConfigDir(): void {
  const configDir = getConfigRoot();
  const profilesDir = getProfilesDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
  } else {
    chmodSync(configDir, 0o700);
  }
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true, mode: 0o700 });
  } else {
    chmodSync(profilesDir, 0o700);
  }
}

function getProfilePath(profile: string): string {
  return join(getProfilesDir(), `${profile}.json`);
}

/**
 * Get the current active profile name
 */
export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureConfigDir();

  const currentProfilePath = getCurrentProfilePath();
  if (existsSync(currentProfilePath)) {
    try {
      const profile = readFileSync(currentProfilePath, 'utf-8').trim();
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

  const currentProfilePath = getCurrentProfilePath();
  writeFileSync(currentProfilePath, profile, { mode: 0o600 });
  chmodSync(currentProfilePath, 0o600);
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

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    return [];
  }

  return readdirSync(profilesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
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

  const profilePath = getProfilePath(profile);
  writeFileSync(profilePath, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(profilePath, 0o600);
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
  const profilePath = getProfilePath(profileName);
  writeFileSync(profilePath, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(profilePath, 0o600);
}

// ============================================
// API Key Management
// ============================================

export function getApiKey(): string | undefined {
  return process.env.TEXTRAZOR_API_KEY || process.env.TEXTRAZOR_TOKEN || loadProfile().apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = loadProfile();
  config.apiKey = apiKey;
  saveProfile(config);
}

// ============================================
// Utility Functions
// ============================================

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return getConfigRoot();
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}

/**
 * Get token alias for the TextRazor API key.
 */
export function getToken(): string | undefined {
  return process.env.TEXTRAZOR_TOKEN || process.env.TEXTRAZOR_API_KEY || loadProfile().token || loadProfile().apiKey;
}

/**
 * Set token (alias for setApiKey)
 */
export function setToken(token: string): void {
  const config = loadProfile();
  config.token = token;
  config.apiKey = token; // Keep both in sync
  saveProfile(config);
}
