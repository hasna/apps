import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { OAuth2Credentials, OAuth2Tokens } from '../types';

const CONNECTOR_NAME = 'connect-taboola';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  // OAuth2 client credentials (client_credentials grant)
  clientId?: string;
  clientSecret?: string;

  // Cached Bearer access token
  accessToken?: string;
  expiresAt?: number;
  tokenType?: string;

  // Default account (network) id to operate on
  accountId?: string;
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
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

function getProfilePath(profile: string): string {
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
      // Fall through to default
    }
  }

  return DEFAULT_PROFILE;
}

export function setCurrentProfile(profile: string): void {
  ensureConfigDir();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  writeFileSync(CURRENT_PROFILE_FILE, profile);
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
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();
}

export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  ensureConfigDir();

  if (profileExists(profile)) {
    return false;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }

  writeFileSync(getProfilePath(profile), JSON.stringify(config, null, 2));
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
  writeFileSync(getProfilePath(profileName), JSON.stringify(config, null, 2));
}

// ============================================
// Credential Management
// ============================================

/** OAuth2 client credentials, resolved from env or the active profile. */
export function getCredentials(): OAuth2Credentials | null {
  const clientId = process.env.TABOOLA_CLIENT_ID || loadProfile().clientId;
  const clientSecret = process.env.TABOOLA_CLIENT_SECRET || loadProfile().clientSecret;
  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }
  return null;
}

export function setCredentials(credentials: OAuth2Credentials): void {
  const config = loadProfile();
  config.clientId = credentials.clientId;
  config.clientSecret = credentials.clientSecret;
  saveProfile(config);
}

/** Pre-issued Bearer access token, resolved from env or the active profile. */
export function getAccessToken(): string | undefined {
  return process.env.TABOOLA_ACCESS_TOKEN || loadProfile().accessToken;
}

export function setAccessToken(token: string): void {
  const config = loadProfile();
  config.accessToken = token;
  saveProfile(config);
}

export function getAccountId(): string | undefined {
  return process.env.TABOOLA_ACCOUNT_ID || loadProfile().accountId;
}

export function setAccountId(accountId: string): void {
  const config = loadProfile();
  config.accountId = accountId;
  saveProfile(config);
}

// ============================================
// Cached Token Management
// ============================================

export function loadTokens(): OAuth2Tokens | null {
  const profile = loadProfile();
  if (profile.accessToken) {
    return {
      accessToken: profile.accessToken,
      expiresAt: profile.expiresAt || 0,
      tokenType: profile.tokenType,
    };
  }
  return null;
}

export function saveTokens(tokens: OAuth2Tokens): void {
  const profile = loadProfile();
  profile.accessToken = tokens.accessToken;
  profile.expiresAt = tokens.expiresAt;
  profile.tokenType = tokens.tokenType;
  saveProfile(profile);
}

export function clearTokens(): void {
  const profile = loadProfile();
  delete profile.accessToken;
  delete profile.expiresAt;
  delete profile.tokenType;
  saveProfile(profile);
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
