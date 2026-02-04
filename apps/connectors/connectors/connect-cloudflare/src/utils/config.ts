import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { CliConfig } from '../types';

const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

// Store for --profile flag override (set by CLI before commands run)
let profileOverride: string | undefined;

// Store config in ~/.connect/connect-cloudflare/ (always in home directory)
function resolveBaseConfigDir(): string {
  return join(homedir(), '.connect', 'connect-cloudflare');
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
 * Migrate old config structure to new profile-based structure
 */
function migrateToProfileStructure(): void {
  const profilesDir = getProfilesDir();
  const defaultProfileDir = join(profilesDir, DEFAULT_PROFILE);

  // If profiles directory already exists, no migration needed
  if (existsSync(profilesDir)) {
    return;
  }

  // Check if old structure exists (config.json directly in base dir)
  const oldConfigFile = join(BASE_CONFIG_DIR, 'config.json');

  const hasOldStructure = existsSync(oldConfigFile);

  if (!hasOldStructure) {
    // Fresh install, just create the profiles directory
    mkdirSync(profilesDir, { recursive: true });
    return;
  }

  // Migrate to default profile
  mkdirSync(defaultProfileDir, { recursive: true });

  // Move files to default profile
  if (existsSync(oldConfigFile)) {
    renameSync(oldConfigFile, join(defaultProfileDir, 'config.json'));
  }

  // Set default as current profile
  writeFileSync(getCurrentProfileFile(), DEFAULT_PROFILE);
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

  if (!profileExists(profile)) {
    throw new Error(`Profile "${profile}" does not exist. Create it first with "profile create ${profile}"`);
  }

  writeFileSync(getCurrentProfileFile(), profile);
}

/**
 * Check if a profile exists
 */
export function profileExists(profile: string): boolean {
  const profileDir = join(getProfilesDir(), profile);
  return existsSync(profileDir);
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
export function createProfile(profile: string): void {
  ensureBaseConfigDir();
  migrateToProfileStructure();

  if (profileExists(profile)) {
    throw new Error(`Profile "${profile}" already exists`);
  }

  // Validate profile name
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }

  const profileDir = join(getProfilesDir(), profile);
  mkdirSync(profileDir, { recursive: true });
}

/**
 * Delete a profile
 */
export function deleteProfile(profile: string): void {
  if (profile === DEFAULT_PROFILE) {
    throw new Error('Cannot delete the default profile');
  }

  if (!profileExists(profile)) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  const currentProfile = getCurrentProfile();
  if (currentProfile === profile) {
    // Switch to default before deleting
    setCurrentProfile(DEFAULT_PROFILE);
  }

  const profileDir = join(getProfilesDir(), profile);
  rmSync(profileDir, { recursive: true });
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

export function loadConfig(): CliConfig {
  ensureConfigDir();
  const configFile = join(getConfigDirInternal(), 'config.json');

  if (!existsSync(configFile)) {
    return {};
  }

  try {
    const content = readFileSync(configFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export function saveConfig(config: CliConfig): void {
  ensureConfigDir();
  const configFile = join(getConfigDirInternal(), 'config.json');
  writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
}

// ============================================
// Cloudflare Credentials
// ============================================

export function getApiToken(): string | undefined {
  return process.env.CLOUDFLARE_API_TOKEN || loadConfig().apiToken;
}

export function setApiToken(apiToken: string): void {
  const config = loadConfig();
  config.apiToken = apiToken;
  saveConfig(config);
}

export function getApiKey(): string | undefined {
  return process.env.CLOUDFLARE_API_KEY || loadConfig().apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = loadConfig();
  config.apiKey = apiKey;
  saveConfig(config);
}

export function getEmail(): string | undefined {
  return process.env.CLOUDFLARE_EMAIL || loadConfig().email;
}

export function setEmail(email: string): void {
  const config = loadConfig();
  config.email = email;
  saveConfig(config);
}

export function getAccountId(): string | undefined {
  return process.env.CLOUDFLARE_ACCOUNT_ID || loadConfig().accountId;
}

export function setAccountId(accountId: string): void {
  const config = loadConfig();
  config.accountId = accountId;
  saveConfig(config);
}

export function setCredentials(apiToken: string, accountId?: string): void {
  const config = loadConfig();
  config.apiToken = apiToken;
  if (accountId) {
    config.accountId = accountId;
  }
  // Clear legacy auth when setting token
  delete config.apiKey;
  delete config.email;
  saveConfig(config);
}

export function setLegacyCredentials(apiKey: string, email: string, accountId?: string): void {
  const config = loadConfig();
  config.apiKey = apiKey;
  config.email = email;
  if (accountId) {
    config.accountId = accountId;
  }
  // Clear token auth when setting legacy
  delete config.apiToken;
  saveConfig(config);
}

// ============================================
// Clear Config
// ============================================

export function clearConfig(): void {
  saveConfig({});
}

export function isAuthenticated(): boolean {
  const config = loadConfig();
  // Either API token OR (API key + email) is required
  return !!(config.apiToken || (config.apiKey && config.email));
}

export function getAuthType(): 'token' | 'key' | null {
  const config = loadConfig();
  if (config.apiToken) return 'token';
  if (config.apiKey && config.email) return 'key';
  return null;
}
