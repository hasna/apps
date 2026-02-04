import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, renameSync, cpSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { CliConfig, OAuth2Tokens } from '../types';

const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

// Store for --profile flag override (set by CLI before commands run)
let profileOverride: string | undefined;

// Store config in ~/.connect/connect-gmail/ (always in home directory)
function resolveBaseConfigDir(): string {
  return join(homedir(), '.connect', 'connect-gmail');
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
  const oldTokensFile = join(BASE_CONFIG_DIR, 'tokens.json');
  const oldSettingsFile = join(BASE_CONFIG_DIR, 'settings.json');
  const oldContactsDir = join(BASE_CONFIG_DIR, 'contacts');

  const hasOldStructure = existsSync(oldConfigFile) || existsSync(oldTokensFile) ||
                          existsSync(oldSettingsFile) || existsSync(oldContactsDir);

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
  if (existsSync(oldTokensFile)) {
    renameSync(oldTokensFile, join(defaultProfileDir, 'tokens.json'));
  }
  if (existsSync(oldSettingsFile)) {
    renameSync(oldSettingsFile, join(defaultProfileDir, 'settings.json'));
  }
  if (existsSync(oldContactsDir)) {
    cpSync(oldContactsDir, join(defaultProfileDir, 'contacts'), { recursive: true });
    rmSync(oldContactsDir, { recursive: true });
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
  writeFileSync(configFile, JSON.stringify(config, null, 2));
}

// ============================================
// OAuth2 Credentials (Client ID/Secret) - Stored at BASE level (shared across profiles)
// ============================================

function loadBaseConfig(): CliConfig {
  ensureBaseConfigDir();
  const configFile = join(BASE_CONFIG_DIR, 'credentials.json');

  if (!existsSync(configFile)) {
    // Migration: check if credentials exist in any profile and copy to base
    const profiles = listProfiles();
    for (const profile of profiles) {
      // Read directly from profile's config file (not via loadConfig which uses current profile)
      const profileConfigFile = join(getProfilesDir(), profile, 'config.json');
      if (existsSync(profileConfigFile)) {
        try {
          const content = readFileSync(profileConfigFile, 'utf-8');
          const profileConfig = JSON.parse(content) as CliConfig;
          if (profileConfig.clientId && profileConfig.clientSecret) {
            // Found credentials in a profile, save to base
            writeFileSync(configFile, JSON.stringify({
              clientId: profileConfig.clientId,
              clientSecret: profileConfig.clientSecret,
            }, null, 2));
            return { clientId: profileConfig.clientId, clientSecret: profileConfig.clientSecret };
          }
        } catch {
          // Continue to next profile
        }
      }
    }
    return {};
  }

  try {
    const content = readFileSync(configFile, 'utf-8');
    return JSON.parse(content);
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
  return process.env.GMAIL_CLIENT_ID || loadBaseConfig().clientId;
}

export function getClientSecret(): string | undefined {
  return process.env.GMAIL_CLIENT_SECRET || loadBaseConfig().clientSecret;
}

export function setClientId(clientId: string): void {
  const config = loadBaseConfig();
  config.clientId = clientId;
  saveBaseConfig(config);
}

export function setClientSecret(clientSecret: string): void {
  const config = loadBaseConfig();
  config.clientSecret = clientSecret;
  saveBaseConfig(config);
}

export function setCredentials(clientId: string, clientSecret: string): void {
  const config = loadBaseConfig();
  config.clientId = clientId;
  config.clientSecret = clientSecret;
  saveBaseConfig(config);
}

// ============================================
// OAuth2 Tokens (Access/Refresh)
// ============================================

export function loadTokens(): OAuth2Tokens | null {
  ensureConfigDir();
  const tokensFile = join(getConfigDirInternal(), 'tokens.json');

  if (!existsSync(tokensFile)) {
    return null;
  }

  try {
    const content = readFileSync(tokensFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function saveTokens(tokens: OAuth2Tokens): void {
  ensureConfigDir();
  const tokensFile = join(getConfigDirInternal(), 'tokens.json');
  writeFileSync(tokensFile, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function getAccessToken(): string | undefined {
  return process.env.GMAIL_ACCESS_TOKEN || loadTokens()?.accessToken;
}

export function getRefreshToken(): string | undefined {
  return process.env.GMAIL_REFRESH_TOKEN || loadTokens()?.refreshToken;
}

export function isTokenExpired(): boolean {
  const tokens = loadTokens();
  if (!tokens) return true;
  // Add 5 minute buffer
  return Date.now() >= tokens.expiresAt - 5 * 60 * 1000;
}

// ============================================
// User Profile
// ============================================

export function getUserEmail(): string | undefined {
  return loadConfig().userEmail;
}

export function setUserEmail(email: string): void {
  const config = loadConfig();
  config.userEmail = email;
  saveConfig(config);
}

export function getUserName(): string | undefined {
  return loadConfig().userName;
}

export function setUserName(name: string): void {
  const config = loadConfig();
  config.userName = name;
  saveConfig(config);
}

export function getFormattedSender(): string {
  const email = getUserEmail();
  const name = getUserName();

  if (!email) {
    throw new Error('User email not configured');
  }

  if (name) {
    return `"${name}" <${email}>`;
  }

  return email;
}

// ============================================
// Clear Config
// ============================================

export function clearTokens(): void {
  const tokensFile = join(getConfigDirInternal(), 'tokens.json');
  if (existsSync(tokensFile)) {
    writeFileSync(tokensFile, '{}');
  }
}

export function clearConfig(): void {
  saveConfig({});
  clearTokens();
}

export function isAuthenticated(): boolean {
  const tokens = loadTokens();
  return tokens !== null && tokens.accessToken !== undefined && tokens.refreshToken !== undefined;
}
