import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { TalkdeskConfig } from '../types';

export interface TalkdeskCliConfig {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  baseUrl?: string;
  authUrl?: string;
}

const CONNECTOR_NAME = 'connect-talkdesk';
const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

let profileOverride: string | undefined;

// Config directory: ~/.hasna/connectors/connect-talkdesk/
const BASE_CONFIG_DIR = join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);

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

export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }
  ensureBaseConfigDir();

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
  }

  const currentProfileFile = getCurrentProfileFile();
  if (existsSync(currentProfileFile)) {
    try {
      const profile = readFileSync(currentProfileFile, 'utf-8').trim();
      if (profile && profileExists(profile)) {
        return profile;
      }
    } catch {
      // fall through to default
    }
  }
  return DEFAULT_PROFILE;
}

export function setCurrentProfile(profile: string): void {
  ensureBaseConfigDir();
  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist. Create it first with "profile create ${profile}"`);
  }
  writeFileSync(getCurrentProfileFile(), profile);
}

export function profileExists(profile: string): boolean {
  return existsSync(join(getProfilesDir(), profile));
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

export function createProfile(profile: string): void {
  ensureBaseConfigDir();
  if (profileExists(profile)) {
    throw new Error(`Profile "${profile}" already exists`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }
  mkdirSync(join(getProfilesDir(), profile), { recursive: true });
}

export function deleteProfile(profile: string): void {
  if (profile === DEFAULT_PROFILE) {
    throw new Error('Cannot delete the default profile');
  }
  if (!profileExists(profile)) {
    throw new Error(`Profile "${profile}" does not exist`);
  }
  if (getCurrentProfile() === profile) {
    setCurrentProfile(DEFAULT_PROFILE);
  }
  rmSync(join(getProfilesDir(), profile), { recursive: true });
}

function getProfileDir(): string {
  ensureBaseConfigDir();
  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
  }
  const profileDir = join(profilesDir, getCurrentProfile());
  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }
  return profileDir;
}

export function getConfigDir(): string {
  return getProfileDir();
}

export function getBaseConfigDir(): string {
  return BASE_CONFIG_DIR;
}

export function ensureConfigDir(): void {
  getProfileDir();
}

// ============================================
// Config Management
// ============================================

export function loadConfig(): TalkdeskCliConfig {
  ensureConfigDir();
  const configFile = join(getProfileDir(), 'config.json');
  if (!existsSync(configFile)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(configFile, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveConfig(config: TalkdeskCliConfig): void {
  ensureConfigDir();
  writeFileSync(join(getProfileDir(), 'config.json'), JSON.stringify(config, null, 2));
}

export function getClientId(): string | undefined {
  return process.env.TALKDESK_CLIENT_ID || loadConfig().clientId;
}

export function setClientId(clientId: string): void {
  const config = loadConfig();
  config.clientId = clientId;
  saveConfig(config);
}

export function getClientSecret(): string | undefined {
  return process.env.TALKDESK_CLIENT_SECRET || loadConfig().clientSecret;
}

export function setClientSecret(clientSecret: string): void {
  const config = loadConfig();
  config.clientSecret = clientSecret;
  saveConfig(config);
}

export function getAccessToken(): string | undefined {
  return process.env.TALKDESK_ACCESS_TOKEN || loadConfig().accessToken;
}

export function setAccessToken(accessToken: string): void {
  const config = loadConfig();
  config.accessToken = accessToken;
  saveConfig(config);
}

export function getBaseUrl(): string | undefined {
  return process.env.TALKDESK_BASE_URL || loadConfig().baseUrl;
}

export function setBaseUrl(baseUrl: string): void {
  const config = loadConfig();
  config.baseUrl = baseUrl;
  saveConfig(config);
}

export function getAuthUrl(): string | undefined {
  return process.env.TALKDESK_AUTH_URL || loadConfig().authUrl;
}

export function setAuthUrl(authUrl: string): void {
  const config = loadConfig();
  config.authUrl = authUrl;
  saveConfig(config);
}

export function clearConfig(): void {
  saveConfig({});
}

// ============================================
// Utility Functions
// ============================================

export function isAuthenticated(): boolean {
  const token = getAccessToken();
  if (token) {
    return true;
  }
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const authUrl = getAuthUrl();
  return !!clientId && !!clientSecret && !!authUrl;
}

/**
 * Resolve the effective TalkdeskConfig from environment variables and the
 * active profile's stored config (environment takes precedence).
 */
export function resolveConfig(): TalkdeskConfig {
  return {
    clientId: getClientId(),
    clientSecret: getClientSecret(),
    accessToken: getAccessToken(),
    baseUrl: getBaseUrl(),
    authUrl: getAuthUrl(),
  };
}
