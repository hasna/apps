import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-twitch';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  scope?: string;
  login?: string;
}

let profileOverride: string | undefined;

function getConfigDirPath(): string {
  return process.env.TWITCH_CONFIG_DIR || join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

function getProfilesDirPath(): string {
  return join(getConfigDirPath(), 'profiles');
}

function getCurrentProfileFilePath(): string {
  return join(getConfigDirPath(), 'current_profile');
}

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function ensureConfigDir(): void {
  const configDir = getConfigDirPath();
  const profilesDir = getProfilesDirPath();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  if (!existsSync(profilesDir)) mkdirSync(profilesDir, { recursive: true });
}

function getProfilePath(profile: string): string {
  return join(getProfilesDirPath(), `${profile}.json`);
}

export function getCurrentProfile(): string {
  if (profileOverride) return profileOverride;
  ensureConfigDir();
  const currentProfileFile = getCurrentProfileFilePath();
  if (existsSync(currentProfileFile)) {
    try {
      const profile = readFileSync(currentProfileFile, 'utf-8').trim();
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
  writeFileSync(getCurrentProfileFilePath(), profile);
}

export function profileExists(profile: string): boolean {
  return existsSync(getProfilePath(profile));
}

export function listProfiles(): string[] {
  ensureConfigDir();
  const profilesDir = getProfilesDirPath();
  if (!existsSync(profilesDir)) return [];
  return readdirSync(profilesDir)
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
  if (profile === DEFAULT_PROFILE) return false;
  if (!profileExists(profile)) return false;
  if (getCurrentProfile() === profile) setCurrentProfile(DEFAULT_PROFILE);
  rmSync(getProfilePath(profile));
  return true;
}

export function loadProfile(profile?: string): ProfileConfig {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  const profilePath = getProfilePath(profileName);
  if (!existsSync(profilePath)) return {};
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

export function getClientId(): string | undefined {
  return process.env.TWITCH_CLIENT_ID || loadProfile().clientId;
}

export function setClientId(clientId: string): void {
  const config = loadProfile();
  config.clientId = clientId;
  saveProfile(config);
}

export function getClientSecret(): string | undefined {
  return process.env.TWITCH_CLIENT_SECRET || loadProfile().clientSecret;
}

export function setClientSecret(clientSecret: string): void {
  const config = loadProfile();
  config.clientSecret = clientSecret;
  saveProfile(config);
}

export function getAccessToken(): string | undefined {
  return process.env.TWITCH_ACCESS_TOKEN || loadProfile().accessToken;
}

export function getRefreshToken(): string | undefined {
  return process.env.TWITCH_REFRESH_TOKEN || loadProfile().refreshToken;
}

export function getTokenExpiresAt(): number | undefined {
  return loadProfile().tokenExpiresAt;
}

export function getLogin(): string | undefined {
  return loadProfile().login;
}

export function setLogin(login: string): void {
  const config = loadProfile();
  config.login = login;
  saveProfile(config);
}

export function isTokenExpired(): boolean {
  const expiresAt = getTokenExpiresAt();
  if (!expiresAt) return true;
  return Date.now() >= expiresAt - 60000;
}

export function saveTokens(
  accessToken: string,
  refreshToken: string | undefined,
  expiresIn: number,
  scope: string | string[],
): void {
  const config = loadProfile();
  config.accessToken = accessToken;
  if (refreshToken) config.refreshToken = refreshToken;
  config.tokenExpiresAt = Date.now() + expiresIn * 1000;
  config.scope = Array.isArray(scope) ? scope.join(' ') : scope;
  saveProfile(config);
}

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return getConfigDirPath();
}
