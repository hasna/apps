import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { ProfileConfig } from '../types';

const CONNECTOR_NAME = 'connect-googlecontacts';
const DEFAULT_PROFILE = 'default';

// Store for --profile flag override (set by CLI before commands run)
let profileOverride: string | undefined;

// Config directory: ~/.connect/connect-googlecontacts/
const CONFIG_DIR = join(homedir(), '.connect', CONNECTOR_NAME);
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
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
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

  writeFileSync(CURRENT_PROFILE_FILE, profile);
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

  writeFileSync(getProfilePath(profile), JSON.stringify(config, null, 2));
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
  writeFileSync(getProfilePath(profileName), JSON.stringify(config, null, 2));
}

// ============================================
// OAuth2 Credentials (Client ID/Secret) - Stored at BASE level (shared across profiles)
// ============================================

const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');

interface CredentialsConfig {
  clientId?: string;
  clientSecret?: string;
}

function loadCredentials(): CredentialsConfig {
  ensureConfigDir();

  if (!existsSync(CREDENTIALS_FILE)) {
    // Migration: check if credentials exist in any profile and copy to base
    const profiles = listProfiles();
    for (const prof of profiles) {
      const profileConfig = loadProfile(prof);
      if (profileConfig.clientId && profileConfig.clientSecret) {
        const creds = {
          clientId: profileConfig.clientId,
          clientSecret: profileConfig.clientSecret,
        };
        writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
        return creds;
      }
    }
    return {};
  }

  try {
    return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveCredentials(creds: CredentialsConfig): void {
  ensureConfigDir();
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function getClientId(): string | undefined {
  return process.env.GOOGLE_CONTACTS_CLIENT_ID || loadCredentials().clientId;
}

export function setClientId(clientId: string): void {
  const creds = loadCredentials();
  creds.clientId = clientId;
  saveCredentials(creds);
}

export function getClientSecret(): string | undefined {
  return process.env.GOOGLE_CONTACTS_CLIENT_SECRET || loadCredentials().clientSecret;
}

export function setClientSecret(clientSecret: string): void {
  const creds = loadCredentials();
  creds.clientSecret = clientSecret;
  saveCredentials(creds);
}

export function setCredentials(clientId: string, clientSecret: string): void {
  saveCredentials({ clientId, clientSecret });
}

export function getAccessToken(): string | undefined {
  return process.env.GOOGLE_CONTACTS_ACCESS_TOKEN || loadProfile().accessToken;
}

export function setAccessToken(accessToken: string): void {
  const config = loadProfile();
  config.accessToken = accessToken;
  saveProfile(config);
}

export function getRefreshToken(): string | undefined {
  return process.env.GOOGLE_CONTACTS_REFRESH_TOKEN || loadProfile().refreshToken;
}

export function setRefreshToken(refreshToken: string): void {
  const config = loadProfile();
  config.refreshToken = refreshToken;
  saveProfile(config);
}

export function getTokenExpiresAt(): number | undefined {
  return loadProfile().tokenExpiresAt;
}

export function setTokenExpiresAt(expiresAt: number): void {
  const config = loadProfile();
  config.tokenExpiresAt = expiresAt;
  saveProfile(config);
}

export function getRedirectUri(): string {
  return process.env.GOOGLE_CONTACTS_REDIRECT_URI || loadProfile().redirectUri || 'urn:ietf:wg:oauth:2.0:oob';
}

export function setRedirectUri(redirectUri: string): void {
  const config = loadProfile();
  config.redirectUri = redirectUri;
  saveProfile(config);
}

/**
 * Save OAuth tokens to profile (with secure file permissions)
 */
export function saveTokens(tokens: {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}): void {
  const config = loadProfile();
  config.accessToken = tokens.accessToken;
  if (tokens.refreshToken) {
    config.refreshToken = tokens.refreshToken;
  }
  if (tokens.expiresIn) {
    config.tokenExpiresAt = Date.now() + tokens.expiresIn * 1000;
  }
  // Save with restrictive permissions (owner read/write only)
  ensureConfigDir();
  const profileName = getCurrentProfile();
  const profilePath = getProfilePath(profileName);
  writeFileSync(profilePath, JSON.stringify(config, null, 2), { mode: 0o600 });
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

/**
 * Check if the current profile has valid credentials for OAuth
 */
export function hasOAuthCredentials(): boolean {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  return Boolean(clientId && clientSecret);
}

/**
 * Check if the current profile has valid access tokens
 */
export function hasAccessTokens(): boolean {
  const accessToken = getAccessToken();
  return Boolean(accessToken);
}

/**
 * Check if the access token is expired
 */
export function isTokenExpired(): boolean {
  const expiresAt = getTokenExpiresAt();
  if (!expiresAt) return true;
  // Consider expired 60 seconds before actual expiry
  return Date.now() >= (expiresAt - 60000);
}
