import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'tinybird';
const DEFAULT_PROFILE = 'default';
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export interface ProfileConfig {
  // Bearer token authentication (dashboard field: api_token)
  api_token?: string;
  apiKey?: string;
  token?: string;
  host?: string;
  apiSecret?: string;
}

// Store for --profile flag override (set by CLI before commands run)
let profileOverride: string | undefined;

// Config directory: ~/.hasna/connectors/{connector-name}/
const CONFIG_DIR = process.env.TINYBIRD_CONFIG_DIR || join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
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
    mkdirSync(CONFIG_DIR, { recursive: true, mode: DIR_MODE });
  }
  chmodSync(CONFIG_DIR, DIR_MODE);
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true, mode: DIR_MODE });
  }
  chmodSync(PROFILES_DIR, DIR_MODE);
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

  writeFileSync(CURRENT_PROFILE_FILE, profile, { mode: FILE_MODE });
  chmodSync(CURRENT_PROFILE_FILE, FILE_MODE);
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
  writeFileSync(profilePath, JSON.stringify(config, null, 2), { mode: FILE_MODE });
  chmodSync(profilePath, FILE_MODE);
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
  writeFileSync(profilePath, JSON.stringify(config, null, 2), { mode: FILE_MODE });
  chmodSync(profilePath, FILE_MODE);
}

// ============================================
// API Key Management
// TODO: Update env var name for your API (e.g., PERPLEXITY_API_KEY)
// ============================================

export function getApiKey(): string | undefined {
  return (
    process.env.TINYBIRD_API_TOKEN ||
    process.env.CONNECTOR_API_KEY ||
    process.env.CONNECTOR_TOKEN ||
    loadProfile().api_token ||
    loadProfile().apiKey ||
    loadProfile().token
  );
}

export function getBaseUrl(): string | undefined {
  return process.env.TINYBIRD_HOST || process.env.CONNECTOR_BASE_URL || loadProfile().host;
}

export function setApiKey(apiKey: string): void {
  const config = loadProfile();
  config.api_token = apiKey;
  config.apiKey = apiKey;
  config.token = apiKey;
  saveProfile(config);
}

export function setBaseUrl(host: string): void {
  const config = loadProfile();
  config.host = host;
  saveProfile(config);
}

export function getApiSecret(): string | undefined {
  return process.env.CONNECTOR_API_SECRET || loadProfile().apiSecret;
}

export function setApiSecret(apiSecret: string): void {
  const config = loadProfile();
  config.apiSecret = apiSecret;
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

// ============================================
// Token/API Key Alias Functions
// TODO: Update env var name for your API
// ============================================

/**
 * Get token (alias for getApiKey - some connectors prefer 'token' naming)
 */
export function getToken(): string | undefined {
  return process.env.CONNECTOR_TOKEN || process.env.CONNECTOR_API_KEY || loadProfile().token || loadProfile().apiKey;
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
