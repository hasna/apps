import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { OAuth2Config, OAuth2Tokens } from '../types';

const CONNECTOR_NAME = 'zoho-subscriptions';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  // API Key authentication
  apiKey?: string;
  token?: string;       // Alias for apiKey
  apiSecret?: string;

  // OAuth2 authentication
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;

  // OAuth2 client credentials (stored separately for security)
  clientId?: string;
  clientSecret?: string;

  organizationId?: string;
  dataCenter?: string;
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
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 });
  }
  for (const dir of [CONFIG_DIR, PROFILES_DIR]) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Best effort on filesystems that do not support POSIX modes.
    }
  }
}

function writePrivateFile(path: string, value: string): void {
  writeFileSync(path, value, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
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

  writePrivateFile(CURRENT_PROFILE_FILE, profile);
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

  writePrivateFile(getProfilePath(profile), JSON.stringify(config, null, 2));
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
  writePrivateFile(getProfilePath(profileName), JSON.stringify(config, null, 2));
}

// ============================================
// API Key Management
// ============================================

export function getApiKey(): string | undefined {
  return getToken();
}

export function setApiKey(apiKey: string): void {
  const config = loadProfile();
  config.apiKey = apiKey;
  saveProfile(config);
}

export function getApiSecret(): string | undefined {
  return process.env.ZOHO_SUBSCRIPTIONS_CLIENT_SECRET || loadProfile().apiSecret;
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
// ============================================

/**
 * Get token (alias for getApiKey - some connectors prefer 'token' naming)
 */
export function getToken(): string | undefined {
  return (
    process.env.ZOHO_SUBSCRIPTIONS_TOKEN ||
    loadProfile().accessToken ||
    loadProfile().token ||
    loadProfile().apiKey
  );
}

export function getOrganizationId(): string | undefined {
  return process.env.ZOHO_SUBSCRIPTIONS_ORG_ID || loadProfile().organizationId;
}

export function setOrganizationId(organizationId: string): void {
  const config = loadProfile();
  config.organizationId = organizationId;
  saveProfile(config);
}

export function getDataCenter(): string | undefined {
  return process.env.ZOHO_SUBSCRIPTIONS_DATA_CENTER || loadProfile().dataCenter;
}

export function setDataCenter(dataCenter: string): void {
  const config = loadProfile();
  config.dataCenter = dataCenter;
  saveProfile(config);
}

/**
 * Set token (alias for setApiKey)
 */
export function setToken(token: string): void {
  const config = loadProfile();
  config.token = token;
  config.apiKey = token;
  config.accessToken = token;
  saveProfile(config);
}

// ============================================
// OAuth2 Configuration Functions
// ============================================

/**
 * Get OAuth2 client configuration
 */
export function getOAuthConfig(): OAuth2Config | null {
  const profile = loadProfile();
  if (profile.clientId && profile.clientSecret) {
    return {
      clientId: profile.clientId,
      clientSecret: profile.clientSecret,
    };
  }
  return null;
}

/**
 * Set OAuth2 client credentials
 */
export function setOAuthConfig(config: OAuth2Config): void {
  const profile = loadProfile();
  profile.clientId = config.clientId;
  profile.clientSecret = config.clientSecret;
  saveProfile(profile);
}

/**
 * Load OAuth2 tokens
 */
export function loadOAuthTokens(): OAuth2Tokens | null {
  const profile = loadProfile();
  if (profile.accessToken) {
    return {
      accessToken: profile.accessToken,
      refreshToken: profile.refreshToken,
      expiresAt: profile.expiresAt || 0,
      tokenType: profile.tokenType,
      scope: profile.scope,
    };
  }
  return null;
}

/**
 * Save OAuth2 tokens
 */
export function saveOAuthTokens(tokens: OAuth2Tokens): void {
  const profile = loadProfile();
  profile.accessToken = tokens.accessToken;
  profile.refreshToken = tokens.refreshToken;
  profile.expiresAt = tokens.expiresAt;
  profile.tokenType = tokens.tokenType;
  profile.scope = tokens.scope;
  saveProfile(profile);
}

/**
 * Clear OAuth2 tokens (logout)
 */
export function clearOAuthTokens(): void {
  const profile = loadProfile();
  delete profile.accessToken;
  delete profile.refreshToken;
  delete profile.expiresAt;
  delete profile.tokenType;
  delete profile.scope;
  saveProfile(profile);
}

/**
 * Get the access token (for OAuth2 authentication)
 */
export function getAccessToken(): string | undefined {
  return loadProfile().accessToken;
}
