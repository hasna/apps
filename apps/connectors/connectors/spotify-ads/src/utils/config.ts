import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { CliConfig, OAuth2Tokens, ProfileConfig } from '../types';
import { DEFAULT_BASE_URL } from '../api/client';

const CONNECTOR_NAME = 'spotify-ads';
const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

let profileOverride: string | undefined;

function resolveBaseConfigDir(): string {
  return join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

const BASE_CONFIG_DIR = resolveBaseConfigDir();

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
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

function ensureProfilesDir(): void {
  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
  }
}

export function profileExists(profile: string): boolean {
  ensureProfilesDir();
  return existsSync(join(getProfilesDir(), profile));
}

export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureBaseConfigDir();
  ensureProfilesDir();

  const currentProfileFile = getCurrentProfileFile();
  if (existsSync(currentProfileFile)) {
    try {
      const profile = readFileSync(currentProfileFile, 'utf-8').trim();
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
  ensureBaseConfigDir();
  ensureProfilesDir();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  writeFileSync(getCurrentProfileFile(), profile);
}

export function listProfiles(): string[] {
  ensureBaseConfigDir();
  ensureProfilesDir();

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    return [];
  }

  return readdirSync(profilesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort();
}

export function createProfile(profile: string): boolean {
  ensureBaseConfigDir();
  ensureProfilesDir();

  if (profileExists(profile)) {
    return false;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }

  mkdirSync(join(getProfilesDir(), profile), { recursive: true });
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

  rmSync(join(getProfilesDir(), profile), { recursive: true });
  return true;
}

function resolveConfigDir(): string {
  ensureBaseConfigDir();
  ensureProfilesDir();

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

function loadBaseConfig(): CliConfig {
  ensureBaseConfigDir();
  const configFile = join(BASE_CONFIG_DIR, 'credentials.json');

  if (!existsSync(configFile)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(configFile, 'utf-8'));
  } catch {
    return {};
  }
}

function saveBaseConfig(config: CliConfig): void {
  ensureBaseConfigDir();
  writeFileSync(join(BASE_CONFIG_DIR, 'credentials.json'), JSON.stringify(config, null, 2));
}

export function getClientId(): string | undefined {
  return process.env.SPOTIFY_ADS_CLIENT_ID || loadBaseConfig().clientId;
}

export function getClientSecret(): string | undefined {
  return process.env.SPOTIFY_ADS_CLIENT_SECRET || loadBaseConfig().clientSecret;
}

export function setCredentials(clientId: string, clientSecret: string): void {
  const config = loadBaseConfig();
  config.clientId = clientId;
  config.clientSecret = clientSecret;
  saveBaseConfig(config);
}

export function loadTokens(): OAuth2Tokens | null {
  const tokensFile = join(resolveConfigDir(), 'tokens.json');

  if (!existsSync(tokensFile)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(tokensFile, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveTokens(tokens: OAuth2Tokens): void {
  writeFileSync(join(resolveConfigDir(), 'tokens.json'), JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function clearTokens(): void {
  const tokensFile = join(resolveConfigDir(), 'tokens.json');
  if (existsSync(tokensFile)) {
    rmSync(tokensFile);
  }
}

export function isAuthenticated(): boolean {
  const tokens = loadTokens();
  return tokens !== null && !!tokens.accessToken;
}

function loadProfileConfig(): ProfileConfig {
  const configFile = join(resolveConfigDir(), 'config.json');

  if (!existsSync(configFile)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(configFile, 'utf-8'));
  } catch {
    return {};
  }
}

function saveProfileConfig(config: ProfileConfig): void {
  writeFileSync(join(resolveConfigDir(), 'config.json'), JSON.stringify(config, null, 2));
}

export function getAdAccountId(): string | undefined {
  return loadProfileConfig().adAccountId;
}

export function setAdAccountId(adAccountId: string): void {
  const config = loadProfileConfig();
  config.adAccountId = adAccountId;
  saveProfileConfig(config);
}

export function getBusinessId(): string | undefined {
  return loadProfileConfig().businessId;
}

export function setBusinessId(businessId: string): void {
  const config = loadProfileConfig();
  config.businessId = businessId;
  saveProfileConfig(config);
}

export function getBaseUrl(): string {
  return process.env.SPOTIFY_ADS_BASE_URL || DEFAULT_BASE_URL;
}

export function getAccessToken(): string | undefined {
  if (process.env.SPOTIFY_ADS_ACCESS_TOKEN) {
    return process.env.SPOTIFY_ADS_ACCESS_TOKEN;
  }
  return loadTokens()?.accessToken;
}

export function clearConfig(): void {
  saveProfileConfig({});
  clearTokens();
}
