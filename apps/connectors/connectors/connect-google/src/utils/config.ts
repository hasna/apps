import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-google';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  accessToken?: string;
  // Optional: store refresh token and client credentials for auto-refresh
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  expiresAt?: number;
}

// Store for --profile flag override (set by CLI before commands run)
let profileOverride: string | undefined;

// Config directory: ~/.connectors/connect-google/
const CONFIG_DIR = join(homedir(), '.connectors', CONNECTOR_NAME);
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

export function ensureProfileDirs(profile: string): void {
  const profileDir = join(PROFILES_DIR, profile);
  const exportsDir = join(profileDir, 'exports');
  const importsDir = join(profileDir, 'imports');

  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }
  if (!existsSync(exportsDir)) {
    mkdirSync(exportsDir, { recursive: true });
  }
  if (!existsSync(importsDir)) {
    mkdirSync(importsDir, { recursive: true });
  }
}

function getProfileDirPath(profile: string): string {
  return join(PROFILES_DIR, profile);
}

function getProfileConfigPath(profile: string): string {
  return join(getProfileDirPath(profile), 'config.json');
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
  return existsSync(getProfileDirPath(profile));
}

/**
 * List all available profiles
 */
export function listProfiles(): string[] {
  ensureConfigDir();

  if (!existsSync(PROFILES_DIR)) {
    return [];
  }

  return readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter(f => f.isDirectory())
    .map(f => f.name)
    .sort();
}

/**
 * Create a new profile with directory structure
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

  // Create profile directories
  ensureProfileDirs(profile);

  // Save config
  writeFileSync(getProfileConfigPath(profile), JSON.stringify(config, null, 2));
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

  rmSync(getProfileDirPath(profile), { recursive: true });
  return true;
}

/**
 * Load profile config
 */
export function loadProfile(profile?: string): ProfileConfig {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  const configPath = getProfileConfigPath(profileName);

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
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
  ensureProfileDirs(profileName);
  writeFileSync(getProfileConfigPath(profileName), JSON.stringify(config, null, 2));
}

// ============================================
// Access Token Management
// ============================================

export function getAccessToken(): string | undefined {
  return process.env.GOOGLE_ACCESS_TOKEN || loadProfile().accessToken;
}

export function setAccessToken(accessToken: string): void {
  const config = loadProfile();
  config.accessToken = accessToken;
  saveProfile(config);
}

export function getRefreshToken(): string | undefined {
  return process.env.GOOGLE_REFRESH_TOKEN || loadProfile().refreshToken;
}

export function setRefreshToken(refreshToken: string): void {
  const config = loadProfile();
  config.refreshToken = refreshToken;
  saveProfile(config);
}

// ============================================
// Token Refresh
// ============================================

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function getClientId(): string | undefined {
  return process.env.GOOGLE_CLIENT_ID || loadProfile().clientId;
}

export function getClientSecret(): string | undefined {
  return process.env.GOOGLE_CLIENT_SECRET || loadProfile().clientSecret;
}

/**
 * Refresh the access token using the refresh token and client credentials
 */
export async function refreshAccessToken(): Promise<ProfileConfig> {
  const profile = loadProfile();
  const clientId = process.env.GOOGLE_CLIENT_ID || profile.clientId;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || profile.clientSecret;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || profile.refreshToken;

  if (!clientId || !clientSecret) {
    throw new Error('OAuth client credentials not configured. Set clientId/clientSecret in profile or GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET env vars.');
  }

  if (!refreshToken) {
    throw new Error('No refresh token available. Please re-authenticate.');
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.json() as { error_description?: string; error?: string };
    throw new Error(`Token refresh failed: ${error.error_description || error.error}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };

  const updatedProfile: ProfileConfig = {
    ...profile,
    accessToken: data.access_token,
    refreshToken: refreshToken, // Keep original refresh token
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  saveProfile(updatedProfile);
  return updatedProfile;
}

/**
 * Get a valid access token, refreshing if necessary.
 * Returns the current token if not expired, otherwise refreshes it.
 */
export async function getValidAccessToken(): Promise<string> {
  // Env var override always wins (no refresh possible)
  if (process.env.GOOGLE_ACCESS_TOKEN) {
    return process.env.GOOGLE_ACCESS_TOKEN;
  }

  const profile = loadProfile();

  if (!profile.accessToken) {
    throw new Error('Not authenticated. Run "connect-google config set-token <token>" or set GOOGLE_ACCESS_TOKEN.');
  }

  // If we have expiry info and a refresh token, check if refresh is needed
  if (profile.expiresAt && profile.refreshToken) {
    // Refresh if token expires within 5 minutes
    if (Date.now() >= profile.expiresAt - 5 * 60 * 1000) {
      const updated = await refreshAccessToken();
      return updated.accessToken!;
    }
  }

  return profile.accessToken;
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

export function getProfileDir(profile?: string): string {
  return join(PROFILES_DIR, profile || getCurrentProfile());
}

export function getExportsDir(profile?: string): string {
  return join(getProfileDir(profile), 'exports');
}

export function getImportsDir(profile?: string): string {
  return join(getProfileDir(profile), 'imports');
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}
