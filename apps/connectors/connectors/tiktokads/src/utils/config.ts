import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { CliConfig, OAuth2Tokens } from '../types';

const CONNECTOR_NAME = 'connect-tiktokads';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  accessToken?: string;
  advertiserId?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

let profileOverride: string | undefined;

const CONFIG_DIR = join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const CURRENT_PROFILE_FILE = join(CONFIG_DIR, 'current_profile');
const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(PROFILES_DIR)) mkdirSync(PROFILES_DIR, { recursive: true });
}

function getProfilePath(profile: string): string {
  return join(PROFILES_DIR, `${profile}.json`);
}

export function getCurrentProfile(): string {
  if (profileOverride) return profileOverride;
  ensureConfigDir();
  if (existsSync(CURRENT_PROFILE_FILE)) {
    try {
      const profile = readFileSync(CURRENT_PROFILE_FILE, 'utf-8').trim();
      if (profile && profileExists(profile)) return profile;
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
  if (!existsSync(PROFILES_DIR)) return [];
  return readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
    .sort();
}

export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  ensureConfigDir();
  if (profileExists(profile)) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }
  writeFileSync(getProfilePath(profile), JSON.stringify(config, null, 2));
  return true;
}

export function deleteProfile(profile: string): boolean {
  if (profile === DEFAULT_PROFILE || !profileExists(profile)) return false;
  if (getCurrentProfile() === profile) setCurrentProfile(DEFAULT_PROFILE);
  rmSync(getProfilePath(profile));
  return true;
}

export function loadProfile(profile?: string): ProfileConfig {
  ensureConfigDir();
  const name = profile || getCurrentProfile();
  const path = getProfilePath(name);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveProfile(config: ProfileConfig, profile?: string): void {
  ensureConfigDir();
  writeFileSync(getProfilePath(profile || getCurrentProfile()), JSON.stringify(config, null, 2));
}

function loadCredentials(): CliConfig {
  ensureConfigDir();
  if (!existsSync(CREDENTIALS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveCredentials(config: CliConfig): void {
  ensureConfigDir();
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(config, null, 2));
}

export function setCredentials(clientId: string, clientSecret: string): void {
  saveCredentials({ clientId, clientSecret });
}

export function getClientId(): string | undefined {
  return process.env.TIKTOK_ADS_CLIENT_ID || loadCredentials().clientId || loadProfile().clientId;
}

export function getClientSecret(): string | undefined {
  return process.env.TIKTOK_ADS_CLIENT_SECRET || loadCredentials().clientSecret || loadProfile().clientSecret;
}

export function getAccessToken(): string | undefined {
  return process.env.TIKTOK_ADS_ACCESS_TOKEN || loadProfile().accessToken;
}

export function setAccessToken(token: string): void {
  const profile = loadProfile();
  profile.accessToken = token;
  saveProfile(profile);
}

export function getAdvertiserId(): string | undefined {
  return process.env.TIKTOK_ADS_ADVERTISER_ID || loadProfile().advertiserId;
}

export function setAdvertiserId(advertiserId: string): void {
  const profile = loadProfile();
  profile.advertiserId = advertiserId;
  saveProfile(profile);
}

export function saveTokens(tokens: OAuth2Tokens): void {
  const profile = loadProfile();
  profile.accessToken = tokens.accessToken;
  profile.refreshToken = tokens.refreshToken;
  profile.expiresAt = tokens.expiresAt;
  profile.tokenType = tokens.tokenType;
  profile.scope = tokens.scope;
  saveProfile(profile);
}

export function loadTokens(): OAuth2Tokens | undefined {
  const profile = loadProfile();
  if (!profile.accessToken) return undefined;
  return {
    accessToken: profile.accessToken,
    refreshToken: profile.refreshToken,
    expiresAt: profile.expiresAt || 0,
    tokenType: profile.tokenType,
    scope: profile.scope,
  };
}

export function clearTokens(): void {
  const profile = loadProfile();
  delete profile.accessToken;
  delete profile.refreshToken;
  delete profile.expiresAt;
  delete profile.tokenType;
  delete profile.scope;
  saveProfile(profile);
}

export function isAuthenticated(): boolean {
  return Boolean(getAccessToken());
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function clearConfig(): void {
  const profile = loadProfile();
  delete profile.accessToken;
  delete profile.advertiserId;
  saveProfile(profile);
}
