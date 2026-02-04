import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-snap';
const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

export interface ProfileConfig {
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  tokenExpiresAt?: number; // Unix timestamp
  defaultOrganizationId?: string;
  defaultAdAccountId?: string;
  organizations?: Record<string, string>; // named organizations
  adAccounts?: Record<string, string>; // named ad accounts
}

// Store for --profile flag override (set by CLI before commands run)
let profileOverride: string | undefined;

// Store config in ~/.connect/connect-snap/ (always in home directory)
function resolveBaseConfigDir(): string {
  return join(homedir(), '.connect', CONNECTOR_NAME);
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

/**
 * Migrate old config structure (JSON files) to new profile directory structure
 */
function migrateToProfileStructure(): void {
  const profilesDir = getProfilesDir();
  const defaultProfileDir = join(profilesDir, DEFAULT_PROFILE);

  // If profiles directory already exists, no migration needed
  if (existsSync(profilesDir)) {
    return;
  }

  // Check if old structure exists (JSON files in profiles/)
  const oldProfilesDir = join(BASE_CONFIG_DIR, 'profiles');
  const hasOldJsonProfiles = existsSync(oldProfilesDir) &&
    readdirSync(oldProfilesDir).some(f => f.endsWith('.json'));

  if (!hasOldJsonProfiles) {
    // Fresh install, just create the profiles directory
    mkdirSync(profilesDir, { recursive: true });
    return;
  }

  // Migrate JSON profiles to directory structure
  const jsonFiles = readdirSync(oldProfilesDir).filter(f => f.endsWith('.json'));

  for (const jsonFile of jsonFiles) {
    const profileName = jsonFile.replace('.json', '');
    const newProfileDir = join(profilesDir, profileName);
    const oldJsonPath = join(oldProfilesDir, jsonFile);

    mkdirSync(newProfileDir, { recursive: true });

    // Move JSON content to config.json in the new directory
    if (existsSync(oldJsonPath)) {
      renameSync(oldJsonPath, join(newProfileDir, 'config.json'));
    }
  }
}

/**
 * Check if a profile exists
 */
export function profileExists(profile: string): boolean {
  migrateToProfileStructure();
  const profileDir = join(getProfilesDir(), profile);
  return existsSync(profileDir);
}

/**
 * Get the current active profile name
 */
export function getCurrentProfile(): string {
  // CLI override takes priority
  if (profileOverride) {
    return profileOverride;
  }

  ensureBaseConfigDir();
  migrateToProfileStructure();

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

/**
 * Set the current active profile
 */
export function setCurrentProfile(profile: string): void {
  ensureBaseConfigDir();
  migrateToProfileStructure();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  writeFileSync(getCurrentProfileFile(), profile);
}

/**
 * List all available profiles
 */
export function listProfiles(): string[] {
  ensureBaseConfigDir();
  migrateToProfileStructure();

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    return [];
  }

  return readdirSync(profilesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort();
}

/**
 * Create a new profile
 */
export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  ensureBaseConfigDir();
  migrateToProfileStructure();

  if (profileExists(profile)) {
    return false;
  }

  // Validate profile name
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }

  const profileDir = join(getProfilesDir(), profile);
  mkdirSync(profileDir, { recursive: true });

  // Save initial config
  if (Object.keys(config).length > 0) {
    writeFileSync(join(profileDir, 'config.json'), JSON.stringify(config, null, 2));
  }

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

  const profileDir = join(getProfilesDir(), profile);
  rmSync(profileDir, { recursive: true });
  return true;
}

/**
 * Get the config directory for the current profile
 */
function resolveConfigDir(): string {
  ensureBaseConfigDir();
  migrateToProfileStructure();

  const profile = getCurrentProfile();
  const profileDir = join(getProfilesDir(), profile);

  // Ensure profile directory exists
  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }

  return profileDir;
}

// Always compute config dir dynamically (no caching - profiles can change)
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
// Export/Import Directories
// ============================================

export function getExportsDir(): string {
  return join(getConfigDirInternal(), 'exports');
}

export function getImportsDir(): string {
  return join(getConfigDirInternal(), 'imports');
}

export function ensureExportsDir(): string {
  const dir = getExportsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function ensureImportsDir(): string {
  const dir = getImportsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ============================================
// Profile Config Loading/Saving
// ============================================

/**
 * Load profile config
 */
export function loadProfile(profile?: string): ProfileConfig {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  const profileDir = join(getProfilesDir(), profileName);
  const configFile = join(profileDir, 'config.json');

  if (!existsSync(configFile)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(configFile, 'utf-8'));
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
  const profileDir = join(getProfilesDir(), profileName);

  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }

  writeFileSync(join(profileDir, 'config.json'), JSON.stringify(config, null, 2));
}

// ============================================
// Token Management
// ============================================

export function getAccessToken(): string | undefined {
  return process.env.SNAP_ACCESS_TOKEN || loadProfile().accessToken;
}

export function setAccessToken(accessToken: string): void {
  const config = loadProfile();
  config.accessToken = accessToken;
  saveProfile(config);
}

export function getRefreshToken(): string | undefined {
  return process.env.SNAP_REFRESH_TOKEN || loadProfile().refreshToken;
}

export function setRefreshToken(refreshToken: string): void {
  const config = loadProfile();
  config.refreshToken = refreshToken;
  saveProfile(config);
}

export function getClientId(): string | undefined {
  return process.env.SNAP_CLIENT_ID || loadProfile().clientId;
}

export function setClientId(clientId: string): void {
  const config = loadProfile();
  config.clientId = clientId;
  saveProfile(config);
}

export function getClientSecret(): string | undefined {
  return process.env.SNAP_CLIENT_SECRET || loadProfile().clientSecret;
}

export function setClientSecret(clientSecret: string): void {
  const config = loadProfile();
  config.clientSecret = clientSecret;
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

export function isTokenExpired(): boolean {
  const expiresAt = getTokenExpiresAt();
  if (!expiresAt) return true;
  // Consider token expired if less than 5 minutes remaining
  return Date.now() >= (expiresAt - 5 * 60 * 1000);
}

export function setTokens(accessToken: string, refreshToken: string, expiresIn: number): void {
  const config = loadProfile();
  config.accessToken = accessToken;
  config.refreshToken = refreshToken;
  config.tokenExpiresAt = Date.now() + (expiresIn * 1000);
  saveProfile(config);
}

// ============================================
// Organization Management
// ============================================

export function getDefaultOrganizationId(): string | undefined {
  return process.env.SNAP_ORGANIZATION_ID || loadProfile().defaultOrganizationId;
}

export function setDefaultOrganizationId(organizationId: string): void {
  const config = loadProfile();
  config.defaultOrganizationId = organizationId;
  saveProfile(config);
}

export function getNamedOrganization(name: string): string | undefined {
  const config = loadProfile();
  return config.organizations?.[name];
}

export function setNamedOrganization(name: string, organizationId: string): void {
  const config = loadProfile();
  if (!config.organizations) {
    config.organizations = {};
  }
  config.organizations[name] = organizationId;
  saveProfile(config);
}

export function removeNamedOrganization(name: string): boolean {
  const config = loadProfile();
  if (config.organizations && config.organizations[name]) {
    delete config.organizations[name];
    saveProfile(config);
    return true;
  }
  return false;
}

export function getOrganizationId(nameOrId?: string): string | undefined {
  if (!nameOrId) {
    return getDefaultOrganizationId();
  }
  // Check if it's a named organization first
  const named = getNamedOrganization(nameOrId);
  if (named) {
    return named;
  }
  // Otherwise treat as literal organization ID
  return nameOrId;
}

export function listNamedOrganizations(): Record<string, string> {
  return loadProfile().organizations || {};
}

// ============================================
// Ad Account Management
// ============================================

export function getDefaultAdAccountId(): string | undefined {
  return process.env.SNAP_AD_ACCOUNT_ID || loadProfile().defaultAdAccountId;
}

export function setDefaultAdAccountId(adAccountId: string): void {
  const config = loadProfile();
  config.defaultAdAccountId = adAccountId;
  saveProfile(config);
}

export function getNamedAdAccount(name: string): string | undefined {
  const config = loadProfile();
  return config.adAccounts?.[name];
}

export function setNamedAdAccount(name: string, adAccountId: string): void {
  const config = loadProfile();
  if (!config.adAccounts) {
    config.adAccounts = {};
  }
  config.adAccounts[name] = adAccountId;
  saveProfile(config);
}

export function removeNamedAdAccount(name: string): boolean {
  const config = loadProfile();
  if (config.adAccounts && config.adAccounts[name]) {
    delete config.adAccounts[name];
    saveProfile(config);
    return true;
  }
  return false;
}

export function getAdAccountId(nameOrId?: string): string | undefined {
  if (!nameOrId) {
    return getDefaultAdAccountId();
  }
  // Check if it's a named ad account first
  const named = getNamedAdAccount(nameOrId);
  if (named) {
    return named;
  }
  // Otherwise treat as literal ad account ID
  return nameOrId;
}

export function listNamedAdAccounts(): Record<string, string> {
  return loadProfile().adAccounts || {};
}

// ============================================
// Utility Functions
// ============================================

export function clearConfig(): void {
  saveProfile({});
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}
