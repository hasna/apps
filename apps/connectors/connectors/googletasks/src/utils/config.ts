import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { ProfileConfig } from '../types';

const CONNECTOR_NAME = 'connect-googletasks';
const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

// Store for --profile flag override
let profileOverride: string | undefined;

function resolveBaseConfigDir(): string {
  return join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

const BASE_CONFIG_DIR = resolveBaseConfigDir();

// ============================================
// Profile Management
// ============================================

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function getProfileOverride(): string | undefined {
  return profileOverride;
}

function ensureBaseConfigDir(): void {
  if (!existsSync(BASE_CONFIG_DIR)) {
    mkdirSync(BASE_CONFIG_DIR, { recursive: true });
  }
}

function getProfilesDir(): string {
  return join(BASE_CONFIG_DIR, PROFILES_DIR);
}

function getCurrentProfileFile(): string {
  return join(BASE_CONFIG_DIR, CURRENT_PROFILE_FILE);
}

export function profileExists(profile: string): boolean {
  const profileDir = join(getProfilesDir(), profile);
  return existsSync(profileDir);
}

export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureBaseConfigDir();
  const currentProfileFile = getCurrentProfileFile();

  if (existsSync(currentProfileFile)) {
    try {
      const profile = readFileSync(currentProfileFile, 'utf-8').trim();
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
  ensureBaseConfigDir();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  writeFileSync(getCurrentProfileFile(), profile);
}

export function listProfiles(): string[] {
  ensureBaseConfigDir();
  const profilesDir = getProfilesDir();

  if (!existsSync(profilesDir)) {
    return [];
  }

  return readdirSync(profilesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort();
}

export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  ensureBaseConfigDir();

  if (profileExists(profile)) {
    return false;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }

  const profileDir = join(getProfilesDir(), profile);
  mkdirSync(profileDir, { recursive: true });

  if (Object.keys(config).length > 0) {
    writeFileSync(join(profileDir, 'config.json'), JSON.stringify(config, null, 2));
  }

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

  const profileDir = join(getProfilesDir(), profile);
  rmSync(profileDir, { recursive: true });
  return true;
}

function resolveConfigDir(): string {
  ensureBaseConfigDir();
  const profile = getCurrentProfile();
  const profileDir = join(getProfilesDir(), profile);

  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }

  return profileDir;
}

export function getConfigDir(): string {
  return resolveConfigDir();
}

export function getBaseConfigDir(): string {
  return BASE_CONFIG_DIR;
}

export function ensureConfigDir(): void {
  const configDir = resolveConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

// ============================================
// Profile Config Loading/Saving
// ============================================

export function loadProfile(profile?: string): ProfileConfig {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();

  let config: ProfileConfig = {};

  // Pattern 1: profiles/<name>.json (flat file)
  const flatPath = join(getProfilesDir(), `${profileName}.json`);
  if (existsSync(flatPath)) {
    try { config = JSON.parse(readFileSync(flatPath, 'utf-8')); } catch {}
  }

  // Pattern 2: profiles/<name>/config.json (directory)
  const dirConfigPath = join(getProfilesDir(), profileName, 'config.json');
  if (existsSync(dirConfigPath)) {
    try {
      const dirConfig = JSON.parse(readFileSync(dirConfigPath, 'utf-8'));
      config = { ...config, ...dirConfig };
    } catch {}
  }

  // Pattern 3: profiles/<name>/tokens.json (OAuth tokens)
  const tokensPath = join(getProfilesDir(), profileName, 'tokens.json');
  if (existsSync(tokensPath)) {
    try {
      const tokens = JSON.parse(readFileSync(tokensPath, 'utf-8'));
      if (tokens.accessToken && !config.accessToken) config.accessToken = tokens.accessToken;
      if (tokens.refreshToken && !config.refreshToken) config.refreshToken = tokens.refreshToken;
      if (tokens.expiresAt && !config.tokenExpiry) config.tokenExpiry = tokens.expiresAt;
    } catch {}
  }

  return config;
}

export function saveProfile(config: ProfileConfig, profile?: string): void {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  const profileDir = join(getProfilesDir(), profileName);

  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }

  writeFileSync(join(profileDir, 'config.json'), JSON.stringify(config, null, 2));
}

// ============================================
// OAuth2 Credentials (Client ID/Secret) - Root credentials.json (shared across profiles)
// ============================================

const CREDENTIALS_FILE = join(BASE_CONFIG_DIR, 'credentials.json');

interface CredentialsConfig {
  clientId?: string;
  clientSecret?: string;
}

function loadCredentials(): CredentialsConfig {
  ensureBaseConfigDir();

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
  ensureBaseConfigDir();
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

// ============================================
// OAuth Credentials
// ============================================

export function getClientId(): string | undefined {
  return process.env.GOOGLE_TASKS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || loadCredentials().clientId || loadProfile().clientId;
}

export function setClientId(clientId: string): void {
  const creds = loadCredentials();
  creds.clientId = clientId;
  saveCredentials(creds);
}

export function getClientSecret(): string | undefined {
  return process.env.GOOGLE_TASKS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || loadCredentials().clientSecret || loadProfile().clientSecret;
}

export function setClientSecret(clientSecret: string): void {
  const creds = loadCredentials();
  creds.clientSecret = clientSecret;
  saveCredentials(creds);
}

export function getAccessToken(): string | undefined {
  return process.env.GOOGLE_ACCESS_TOKEN || loadProfile().accessToken;
}

export function setAccessToken(accessToken: string): void {
  const config = loadProfile();
  config.accessToken = accessToken;
  saveProfile(config);
}

export function getRefreshToken(): string | undefined {
  return loadProfile().refreshToken;
}

export function setRefreshToken(refreshToken: string): void {
  const config = loadProfile();
  config.refreshToken = refreshToken;
  saveProfile(config);
}

export function getTokenExpiry(): number | undefined {
  return loadProfile().tokenExpiry;
}

export function setTokenExpiry(expiry: number): void {
  const config = loadProfile();
  config.tokenExpiry = expiry;
  saveProfile(config);
}

export function setCredentials(clientId: string, clientSecret: string): void {
  saveCredentials({ clientId, clientSecret });
}

export function setTokens(accessToken: string, refreshToken: string | undefined, expiresIn: number): void {
  const config = loadProfile();
  config.accessToken = accessToken;
  if (refreshToken) {
    config.refreshToken = refreshToken;
  }
  config.tokenExpiry = Date.now() + (expiresIn * 1000);
  saveProfile(config);
}

export function isTokenExpired(): boolean {
  const expiry = getTokenExpiry();
  if (!expiry) return true;
  return Date.now() >= expiry - 60000; // 1 minute buffer
}

export function clearTokens(): void {
  const config = loadProfile();
  delete config.accessToken;
  delete config.refreshToken;
  delete config.tokenExpiry;
  saveProfile(config);
}

export function clearConfig(): void {
  saveProfile({});
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}
