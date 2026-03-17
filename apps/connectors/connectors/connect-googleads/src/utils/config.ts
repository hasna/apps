import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { OAuth2Tokens, CliConfig } from '../types';

const CONNECTOR_NAME = 'connect-googleads';
const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

// Store for --profile flag override
let profileOverride: string | undefined;

function resolveBaseConfigDir(): string {
  return join(homedir(), '.connectors', CONNECTOR_NAME);
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
  ensureProfilesDir();
  const profileDir = join(getProfilesDir(), profile);
  return existsSync(profileDir);
}

function ensureProfilesDir(): void {
  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
  }
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
      // Fall through to default
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

  const profileDir = join(getProfilesDir(), profile);
  mkdirSync(profileDir, { recursive: true });

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
  ensureProfilesDir();

  const profile = getCurrentProfile();
  const profileDir = join(getProfilesDir(), profile);

  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }

  return profileDir;
}

function getConfigDirInternal(): string {
  return resolveConfigDir();
}

export function getConfigDir(): string {
  return getConfigDirInternal();
}

export function getBaseConfigDir(): string {
  return BASE_CONFIG_DIR;
}

export function ensureConfigDir(): void {
  const configDir = getConfigDirInternal();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

// ============================================
// OAuth2 Credentials (shared across profiles)
// ============================================

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
  const configFile = join(BASE_CONFIG_DIR, 'credentials.json');
  writeFileSync(configFile, JSON.stringify(config, null, 2));
}

export function getClientId(): string | undefined {
  return process.env.GOOGLE_ADS_CLIENT_ID || loadBaseConfig().clientId;
}

export function getClientSecret(): string | undefined {
  return process.env.GOOGLE_ADS_CLIENT_SECRET || loadBaseConfig().clientSecret;
}

export function getDeveloperToken(): string | undefined {
  return process.env.GOOGLE_ADS_DEVELOPER_TOKEN || loadBaseConfig().developerToken;
}

export function setCredentials(clientId: string, clientSecret: string): void {
  const config = loadBaseConfig();
  config.clientId = clientId;
  config.clientSecret = clientSecret;
  saveBaseConfig(config);
}

export function setDeveloperToken(token: string): void {
  const config = loadBaseConfig();
  config.developerToken = token;
  saveBaseConfig(config);
}

// ============================================
// OAuth2 Tokens (per profile)
// ============================================

export function loadTokens(): OAuth2Tokens | null {
  ensureConfigDir();
  const tokensFile = join(getConfigDirInternal(), 'tokens.json');

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
  ensureConfigDir();
  const tokensFile = join(getConfigDirInternal(), 'tokens.json');
  writeFileSync(tokensFile, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function clearTokens(): void {
  const tokensFile = join(getConfigDirInternal(), 'tokens.json');
  if (existsSync(tokensFile)) {
    rmSync(tokensFile);
  }
}

export function isTokenExpired(): boolean {
  const tokens = loadTokens();
  if (!tokens) return true;
  return Date.now() >= tokens.expiresAt - 5 * 60 * 1000;
}

export function isAuthenticated(): boolean {
  const tokens = loadTokens();
  return tokens !== null && tokens.accessToken !== undefined && tokens.refreshToken !== undefined;
}

// ============================================
// Profile Config (customer ID, etc.)
// ============================================

interface ProfileConfig {
  customerId?: string;
  loginCustomerId?: string;
  accountName?: string;
}

function loadProfileConfig(): ProfileConfig {
  ensureConfigDir();
  const configFile = join(getConfigDirInternal(), 'config.json');

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
  ensureConfigDir();
  const configFile = join(getConfigDirInternal(), 'config.json');
  writeFileSync(configFile, JSON.stringify(config, null, 2));
}

export function getCustomerId(): string | undefined {
  return process.env.GOOGLE_ADS_CUSTOMER_ID || loadProfileConfig().customerId;
}

export function setCustomerId(customerId: string): void {
  const config = loadProfileConfig();
  config.customerId = customerId;
  saveProfileConfig(config);
}

export function getLoginCustomerId(): string | undefined {
  return process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || loadProfileConfig().loginCustomerId || loadBaseConfig().loginCustomerId;
}

export function setLoginCustomerId(customerId: string): void {
  const config = loadProfileConfig();
  config.loginCustomerId = customerId;
  saveProfileConfig(config);
}

export function getAccountName(): string | undefined {
  return loadProfileConfig().accountName;
}

export function setAccountName(name: string): void {
  const config = loadProfileConfig();
  config.accountName = name;
  saveProfileConfig(config);
}

export function getAccessToken(): string | undefined {
  if (process.env.GOOGLE_ADS_ACCESS_TOKEN) {
    return process.env.GOOGLE_ADS_ACCESS_TOKEN;
  }
  const tokens = loadTokens();
  return tokens?.accessToken;
}

export function clearConfig(): void {
  saveProfileConfig({});
  clearTokens();
}
