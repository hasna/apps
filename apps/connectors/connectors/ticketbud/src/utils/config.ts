import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { OAuth2Config, OAuth2Tokens } from '../types';

const CONNECTOR_NAME = 'connect-ticketbud';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
  clientId?: string;
  clientSecret?: string;
}

let profileOverride: string | undefined;

const CONFIG_DIR = join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const CURRENT_PROFILE_FILE = join(CONFIG_DIR, 'current_profile');

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
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
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
  if (profile === DEFAULT_PROFILE || !profileExists(profile)) {
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

export function getAccessToken(): string | undefined {
  return process.env.TICKETBUD_ACCESS_TOKEN || loadProfile().accessToken;
}

export function setAccessToken(accessToken: string): void {
  const config = loadProfile();
  config.accessToken = accessToken;
  saveProfile(config);
}

export function getClientId(): string | undefined {
  return process.env.TICKETBUD_CLIENT_ID || loadProfile().clientId;
}

export function getClientSecret(): string | undefined {
  return process.env.TICKETBUD_CLIENT_SECRET || loadProfile().clientSecret;
}

export function setOAuthCredentials(clientId: string, clientSecret: string): void {
  const config = loadProfile();
  config.clientId = clientId;
  config.clientSecret = clientSecret;
  saveProfile(config);
}

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

export function saveOAuthTokens(tokens: OAuth2Tokens): void {
  const profile = loadProfile();
  profile.accessToken = tokens.accessToken;
  profile.refreshToken = tokens.refreshToken;
  profile.expiresAt = tokens.expiresAt;
  profile.tokenType = tokens.tokenType;
  profile.scope = tokens.scope;
  saveProfile(profile);
}

export function clearOAuthTokens(): void {
  const profile = loadProfile();
  delete profile.accessToken;
  delete profile.refreshToken;
  delete profile.expiresAt;
  delete profile.tokenType;
  delete profile.scope;
  saveProfile(profile);
}

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function isAuthenticated(): boolean {
  return Boolean(getAccessToken());
}
