import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-x';
const DEFAULT_PROFILE = 'default';

// Shared app credentials (stored at base level, shared across all profiles)
export interface AppCredentials {
  apiKey?: string;
  apiSecret?: string;
  bearerToken?: string;
  clientId?: string;
  clientSecret?: string;
}

// Per-profile user tokens
export interface ProfileConfig {
  // OAuth 2.0 user tokens
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  tokenScopes?: string[];
  // OAuth 1.0a user tokens (for legacy endpoints)
  oauth1AccessToken?: string;
  oauth1AccessTokenSecret?: string;
  // Authenticated user info
  userId?: string;
  username?: string;
}

// Store for --profile flag override (set by CLI before commands run)
let profileOverride: string | undefined;

// Config directory: ~/.connect/connect-x/
const CONFIG_DIR = join(homedir(), '.connect', CONNECTOR_NAME);
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const CURRENT_PROFILE_FILE = join(CONFIG_DIR, 'current_profile');
const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');

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
// Shared App Credentials (base level)
// ============================================

function loadCredentials(): AppCredentials {
  ensureConfigDir();

  if (!existsSync(CREDENTIALS_FILE)) {
    // Migration: check if credentials exist in any profile and copy to base
    const profiles = listProfiles();
    for (const profile of profiles) {
      const profileConfig = loadProfileRaw(profile);
      if (profileConfig.apiKey || profileConfig.clientId) {
        const creds: AppCredentials = {};
        if (profileConfig.apiKey) creds.apiKey = profileConfig.apiKey;
        if (profileConfig.apiSecret) creds.apiSecret = profileConfig.apiSecret;
        if (profileConfig.bearerToken) creds.bearerToken = profileConfig.bearerToken;
        if (profileConfig.clientId) creds.clientId = profileConfig.clientId;
        if (profileConfig.clientSecret) creds.clientSecret = profileConfig.clientSecret;
        saveCredentials(creds);
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

function loadProfileRaw(profile: string): ProfileConfig & AppCredentials {
  const profilePath = getProfilePath(profile);
  if (!existsSync(profilePath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(profilePath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveCredentials(creds: AppCredentials): void {
  ensureConfigDir();
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
}

// ============================================
// API Key Management (shared)
// ============================================

export function getApiKey(): string | undefined {
  return process.env.X_API_KEY || loadCredentials().apiKey;
}

export function setApiKey(apiKey: string): void {
  const creds = loadCredentials();
  creds.apiKey = apiKey;
  saveCredentials(creds);
}

export function getApiSecret(): string | undefined {
  return process.env.X_API_SECRET || loadCredentials().apiSecret;
}

export function setApiSecret(apiSecret: string): void {
  const creds = loadCredentials();
  creds.apiSecret = apiSecret;
  saveCredentials(creds);
}

export function getBearerToken(): string | undefined {
  return process.env.X_BEARER_TOKEN || loadCredentials().bearerToken;
}

export function setBearerToken(bearerToken: string): void {
  const creds = loadCredentials();
  creds.bearerToken = bearerToken;
  saveCredentials(creds);
}

// ============================================
// OAuth 2.0 Client Credentials (shared)
// ============================================

export function getClientId(): string | undefined {
  return process.env.X_CLIENT_ID || loadCredentials().clientId;
}

export function setClientId(clientId: string): void {
  const creds = loadCredentials();
  creds.clientId = clientId;
  saveCredentials(creds);
}

export function getClientSecret(): string | undefined {
  return process.env.X_CLIENT_SECRET || loadCredentials().clientSecret;
}

export function setClientSecret(clientSecret: string): void {
  const creds = loadCredentials();
  creds.clientSecret = clientSecret;
  saveCredentials(creds);
}

// ============================================
// OAuth 2.0 User Tokens
// ============================================

export function getAccessToken(): string | undefined {
  return process.env.X_ACCESS_TOKEN || loadProfile().accessToken;
}

export function setAccessToken(accessToken: string): void {
  const config = loadProfile();
  config.accessToken = accessToken;
  saveProfile(config);
}

export function getRefreshToken(): string | undefined {
  return process.env.X_REFRESH_TOKEN || loadProfile().refreshToken;
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

export function getTokenScopes(): string[] | undefined {
  return loadProfile().tokenScopes;
}

export function setTokenScopes(scopes: string[]): void {
  const config = loadProfile();
  config.tokenScopes = scopes;
  saveProfile(config);
}

export function isTokenExpired(): boolean {
  const expiresAt = getTokenExpiresAt();
  if (!expiresAt) return true;
  // Consider expired 5 minutes before actual expiry
  return Date.now() > expiresAt - 5 * 60 * 1000;
}

// ============================================
// OAuth 1.0a User Tokens
// ============================================

export function getOAuth1AccessToken(): string | undefined {
  return process.env.X_OAUTH1_ACCESS_TOKEN || loadProfile().oauth1AccessToken;
}

export function setOAuth1AccessToken(token: string): void {
  const config = loadProfile();
  config.oauth1AccessToken = token;
  saveProfile(config);
}

export function getOAuth1AccessTokenSecret(): string | undefined {
  return process.env.X_OAUTH1_ACCESS_TOKEN_SECRET || loadProfile().oauth1AccessTokenSecret;
}

export function setOAuth1AccessTokenSecret(secret: string): void {
  const config = loadProfile();
  config.oauth1AccessTokenSecret = secret;
  saveProfile(config);
}

// ============================================
// User Info
// ============================================

export function getUserId(): string | undefined {
  return loadProfile().userId;
}

export function setUserId(userId: string): void {
  const config = loadProfile();
  config.userId = userId;
  saveProfile(config);
}

export function getUsername(): string | undefined {
  return loadProfile().username;
}

export function setUsername(username: string): void {
  const config = loadProfile();
  config.username = username;
  saveProfile(config);
}

// ============================================
// Save OAuth 2.0 Tokens (batch update)
// ============================================

export function saveOAuth2Tokens(tokens: {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scopes?: string[];
  userId?: string;
  username?: string;
}): void {
  const config = loadProfile();
  config.accessToken = tokens.accessToken;
  if (tokens.refreshToken) {
    config.refreshToken = tokens.refreshToken;
  }
  config.tokenExpiresAt = tokens.expiresAt;
  if (tokens.scopes) {
    config.tokenScopes = tokens.scopes;
  }
  if (tokens.userId) {
    config.userId = tokens.userId;
  }
  if (tokens.username) {
    config.username = tokens.username;
  }
  saveProfile(config);
}

// ============================================
// Save OAuth 1.0a Tokens (batch update)
// ============================================

export function saveOAuth1Tokens(tokens: {
  oauthToken: string;
  oauthTokenSecret: string;
  userId?: string;
  screenName?: string;
}): void {
  const config = loadProfile();
  config.oauth1AccessToken = tokens.oauthToken;
  config.oauth1AccessTokenSecret = tokens.oauthTokenSecret;
  if (tokens.userId) {
    config.userId = tokens.userId;
  }
  if (tokens.screenName) {
    config.username = tokens.screenName;
  }
  saveProfile(config);
}

// ============================================
// Clear User Tokens (logout)
// ============================================

export function clearUserTokens(): void {
  const config = loadProfile();
  delete config.accessToken;
  delete config.refreshToken;
  delete config.tokenExpiresAt;
  delete config.tokenScopes;
  delete config.oauth1AccessToken;
  delete config.oauth1AccessTokenSecret;
  delete config.userId;
  delete config.username;
  saveProfile(config);
}

// ============================================
// Auth Status
// ============================================

export function hasUserAuth(): boolean {
  return hasOAuth2Auth() || hasOAuth1Auth();
}

export function hasOAuth2Auth(): boolean {
  return !!getAccessToken();
}

export function hasOAuth1Auth(): boolean {
  return !!(getOAuth1AccessToken() && getOAuth1AccessTokenSecret());
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
