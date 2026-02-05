import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, renameSync, cpSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { CliConfig, OAuth2Tokens } from '../types';

const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

// Store for --profile flag override (set by CLI before commands run)
let profileOverride: string | undefined;

// Store config in ~/.connect/connect-notion/ (always in home directory)
function resolveBaseConfigDir(): string {
  return join(homedir(), '.connect', 'connect-notion');
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

  const hasOldStructure = existsSync(oldConfigFile) || existsSync(oldTokensFile);

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
// OAuth2 Credentials (Client ID/Secret)
// ============================================

export function getClientId(): string | undefined {
  return process.env.NOTION_CLIENT_ID || loadConfig().clientId;
}

export function getClientSecret(): string | undefined {
  return process.env.NOTION_CLIENT_SECRET || loadConfig().clientSecret;
}

export function setClientId(clientId: string): void {
  const config = loadConfig();
  config.clientId = clientId;
  saveConfig(config);
}

export function setClientSecret(clientSecret: string): void {
  const config = loadConfig();
  config.clientSecret = clientSecret;
  saveConfig(config);
}

export function setCredentials(clientId: string, clientSecret: string): void {
  const config = loadConfig();
  config.clientId = clientId;
  config.clientSecret = clientSecret;
  saveConfig(config);
}

// ============================================
// OAuth2 Tokens (Access Token)
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
  return process.env.NOTION_ACCESS_TOKEN || loadTokens()?.accessToken;
}

// ============================================
// API Key Support (Internal Integration Token)
// ============================================

export function getApiKey(): string | undefined {
  return process.env.NOTION_API_KEY || loadConfig().accessToken;
}

export function setApiKey(apiKey: string): void {
  const config = loadConfig();
  config.accessToken = apiKey;
  saveConfig(config);
}

// ============================================
// Workspace Info
// ============================================

export function getWorkspaceId(): string | undefined {
  return loadTokens()?.workspaceId || loadConfig().workspaceId;
}

export function setWorkspaceId(workspaceId: string): void {
  const config = loadConfig();
  config.workspaceId = workspaceId;
  saveConfig(config);
}

export function getWorkspaceName(): string | undefined {
  return loadTokens()?.workspaceName || loadConfig().workspaceName;
}

export function setWorkspaceName(name: string): void {
  const config = loadConfig();
  config.workspaceName = name;
  saveConfig(config);
}

export function getBotId(): string | undefined {
  return loadTokens()?.botId || loadConfig().botId;
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
  // Check for OAuth tokens
  const tokens = loadTokens();
  if (tokens !== null && tokens.accessToken !== undefined) {
    return true;
  }

  // Check for API key (internal integration)
  const apiKey = getApiKey();
  if (apiKey !== undefined && apiKey !== '') {
    return true;
  }

  return false;
}

/**
 * Get a valid access token (either from OAuth or API key)
 */
export function getValidToken(): string {
  // Check OAuth tokens first
  const tokens = loadTokens();
  if (tokens?.accessToken) {
    return tokens.accessToken;
  }

  // Check API key
  const apiKey = getApiKey();
  if (apiKey) {
    return apiKey;
  }

  throw new Error('Not authenticated. Run "connect-notion auth login" or "connect-notion config set-key <api-key>" first.');
}
