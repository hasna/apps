import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { ProfileConfig } from '../types';

const CONNECTOR_NAME = 'connect-vertex-ai';
const DEFAULT_PROFILE = 'default';
const CONFIG_DIR = join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const CURRENT_PROFILE_FILE = join(CONFIG_DIR, 'current_profile');
const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');

let profileOverride: string | undefined;

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
    const profile = readFileSync(CURRENT_PROFILE_FILE, 'utf-8').trim();
    if (profile && profileExists(profile)) return profile;
  }
  return DEFAULT_PROFILE;
}

export function setCurrentProfile(profile: string): void {
  ensureConfigDir();
  if (!profileExists(profile)) {
    throw new Error(`Profile "${profile}" does not exist`);
  }
  writeFileSync(CURRENT_PROFILE_FILE, profile);
}

export function profileExists(profile: string): boolean {
  return existsSync(getProfilePath(profile));
}

export function listProfiles(): string[] {
  ensureConfigDir();
  return readdirSync(PROFILES_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

export function createProfile(profile: string): void {
  ensureConfigDir();
  if (profileExists(profile)) throw new Error(`Profile "${profile}" already exists`);
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }
  saveProfile(profile, {});
}

export function deleteProfile(profile: string): void {
  if (profile === DEFAULT_PROFILE) throw new Error('Cannot delete the default profile');
  if (!profileExists(profile)) throw new Error(`Profile "${profile}" does not exist`);
  if (getCurrentProfile() === profile) setCurrentProfile(DEFAULT_PROFILE);
  rmSync(getProfilePath(profile));
}

export function loadProfile(profile?: string): ProfileConfig {
  ensureConfigDir();
  const path = getProfilePath(profile ?? getCurrentProfile());
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ProfileConfig;
  } catch {
    return {};
  }
}

export function saveProfile(profile: string, config: ProfileConfig): void {
  ensureConfigDir();
  writeFileSync(getProfilePath(profile), JSON.stringify(config, null, 2));
}

function loadCredentials(): ProfileConfig {
  if (!existsSync(CREDENTIALS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8')) as ProfileConfig;
  } catch {
    return {};
  }
}

function saveCredentials(config: ProfileConfig): void {
  ensureConfigDir();
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(config, null, 2));
}

export function getClientId(): string | undefined {
  return process.env.VERTEX_AI_CLIENT_ID || loadCredentials().clientId || loadProfile().clientId;
}

export function getClientSecret(): string | undefined {
  return process.env.VERTEX_AI_CLIENT_SECRET || loadCredentials().clientSecret || loadProfile().clientSecret;
}

export function setCredentials(clientId: string, clientSecret: string): void {
  saveCredentials({ clientId, clientSecret });
}

export function getAccessToken(): string | undefined {
  return process.env.VERTEX_AI_ACCESS_TOKEN || loadProfile().accessToken;
}

export function getRefreshToken(): string | undefined {
  return process.env.VERTEX_AI_REFRESH_TOKEN || loadProfile().refreshToken;
}

export function getProjectId(): string | undefined {
  return process.env.VERTEX_AI_PROJECT_ID || loadProfile().projectId;
}

export function getLocation(): string {
  return process.env.VERTEX_AI_LOCATION || loadProfile().location || 'us-central1';
}

export function setProjectId(projectId: string): void {
  const profile = getCurrentProfile();
  const config = loadProfile(profile);
  config.projectId = projectId;
  saveProfile(profile, config);
}

export function setLocation(location: string): void {
  const profile = getCurrentProfile();
  const config = loadProfile(profile);
  config.location = location;
  saveProfile(profile, config);
}

export function setTokens(tokens: {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}): void {
  const profile = getCurrentProfile();
  const config = loadProfile(profile);
  config.accessToken = tokens.accessToken;
  if (tokens.refreshToken) config.refreshToken = tokens.refreshToken;
  if (tokens.expiresIn) config.tokenExpiry = Date.now() + tokens.expiresIn * 1000;
  saveProfile(profile, config);
}

export function isTokenExpired(): boolean {
  const config = loadProfile();
  if (!config.tokenExpiry) return false;
  return Date.now() >= config.tokenExpiry - 5 * 60 * 1000;
}

export function isAuthenticated(): boolean {
  const config = loadProfile();
  return Boolean(config.accessToken || config.refreshToken || process.env.VERTEX_AI_ACCESS_TOKEN);
}

export function clearConfig(): void {
  const profile = getCurrentProfile();
  saveProfile(profile, {});
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export { CONNECTOR_NAME };
