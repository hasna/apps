import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface ClickBankCliConfig {
  apiKey?: string;
  defaultAccount?: string;
}

const CONNECTOR_NAME = 'connect-clickbank';
const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

// Store for --profile flag override
let profileOverride: string | undefined;

// Config directory: ~/.connect/connect-clickbank/
const BASE_CONFIG_DIR = join(homedir(), '.connect', CONNECTOR_NAME);

// Old config location for migration
const OLD_CONFIG_DIR = join(homedir(), '.connect-clickbank');

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
 * Migrate from old config location to new multi-profile structure
 */
function migrateOldConfig(): void {
  const oldConfigFile = join(OLD_CONFIG_DIR, 'config.json');

  if (!existsSync(oldConfigFile)) {
    return;
  }

  // Check if we've already migrated (new structure exists with content)
  const profilesDir = getProfilesDir();
  const defaultProfileDir = join(profilesDir, DEFAULT_PROFILE);
  const newConfigFile = join(defaultProfileDir, 'config.json');

  if (existsSync(newConfigFile)) {
    return; // Already migrated
  }

  try {
    // Read old config
    const oldContent = readFileSync(oldConfigFile, 'utf-8');
    const oldConfig = JSON.parse(oldContent);

    // Ensure new directory structure
    ensureBaseConfigDir();
    if (!existsSync(profilesDir)) {
      mkdirSync(profilesDir, { recursive: true });
    }
    if (!existsSync(defaultProfileDir)) {
      mkdirSync(defaultProfileDir, { recursive: true });
    }

    // Write to new location
    writeFileSync(newConfigFile, JSON.stringify(oldConfig, null, 2));

    // Set default as current profile
    writeFileSync(getCurrentProfileFile(), DEFAULT_PROFILE);

    console.log(`Migrated config from ${OLD_CONFIG_DIR} to ${BASE_CONFIG_DIR}`);
  } catch {
    // Migration failed silently - user can manually migrate if needed
  }
}

/**
 * Get the current active profile name
 */
export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureBaseConfigDir();
  migrateOldConfig();

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

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
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
  migrateOldConfig();

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
    setCurrentProfile(DEFAULT_PROFILE);
  }

  const profileDir = join(getProfilesDir(), profile);
  rmSync(profileDir, { recursive: true });
}

/**
 * Get the config directory for the current profile
 */
function getProfileDir(): string {
  ensureBaseConfigDir();
  migrateOldConfig();

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
  }

  const profile = getCurrentProfile();
  const profileDir = join(profilesDir, profile);

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

export function loadConfig(): ClickBankCliConfig {
  ensureConfigDir();
  const configFile = join(getProfileDir(), 'config.json');

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

export function saveConfig(config: ClickBankCliConfig): void {
  ensureConfigDir();
  const configFile = join(getProfileDir(), 'config.json');
  writeFileSync(configFile, JSON.stringify(config, null, 2));
}

export function getApiKey(): string | undefined {
  // Priority: environment variable > config file
  return process.env.CLICKBANK_API_KEY || loadConfig().apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = loadConfig();
  config.apiKey = apiKey;
  saveConfig(config);
}

export function getDefaultAccount(): string | undefined {
  return loadConfig().defaultAccount;
}

export function setDefaultAccount(account: string): void {
  const config = loadConfig();
  config.defaultAccount = account;
  saveConfig(config);
}

export function clearConfig(): void {
  saveConfig({});
}

export function isAuthenticated(): boolean {
  const apiKey = getApiKey();
  return apiKey !== undefined && apiKey !== '';
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}
