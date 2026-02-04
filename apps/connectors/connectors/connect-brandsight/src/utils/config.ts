import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface ProfileConfig {
  apiKey?: string;
  apiSecret?: string;
  customerId?: string;
  shopperId?: string;
}

interface GlobalConfig {
  activeProfile?: string;
}

const CONFIG_DIR = join(homedir(), '.connect', 'connect-brandsight');
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const GLOBAL_CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const DEFAULT_PROFILE = 'default';

// In-memory profile override for --profile flag
let profileOverride: string | undefined;

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

// Slugify profile name for filesystem
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

function getProfilePath(name: string): string {
  return join(PROFILES_DIR, `${slugify(name)}.json`);
}

// Global config (active profile)
function loadGlobalConfig(): GlobalConfig {
  ensureConfigDir();
  if (!existsSync(GLOBAL_CONFIG_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(GLOBAL_CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveGlobalConfig(config: GlobalConfig): void {
  ensureConfigDir();
  writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Profile management
export function setProfileOverride(name: string | undefined): void {
  profileOverride = name;
}

export function getActiveProfileName(): string {
  return profileOverride || loadGlobalConfig().activeProfile || DEFAULT_PROFILE;
}

export function setActiveProfile(name: string): boolean {
  const profilePath = getProfilePath(name);
  if (!existsSync(profilePath) && name !== DEFAULT_PROFILE) {
    return false;
  }
  const config = loadGlobalConfig();
  config.activeProfile = name;
  saveGlobalConfig(config);
  return true;
}

export function loadProfile(name?: string): ProfileConfig {
  ensureConfigDir();
  const profileName = name || getActiveProfileName();
  const profilePath = getProfilePath(profileName);

  if (!existsSync(profilePath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(profilePath, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveProfile(config: ProfileConfig, name?: string): void {
  ensureConfigDir();
  const profileName = name || getActiveProfileName();
  const profilePath = getProfilePath(profileName);
  writeFileSync(profilePath, JSON.stringify(config, null, 2));
}

export function createProfile(name: string, config: ProfileConfig = {}): boolean {
  ensureConfigDir();
  const profilePath = getProfilePath(name);
  if (existsSync(profilePath)) {
    return false; // Already exists
  }
  writeFileSync(profilePath, JSON.stringify(config, null, 2));
  return true;
}

export function deleteProfile(name: string): boolean {
  if (name === DEFAULT_PROFILE) {
    return false; // Can't delete default
  }
  const profilePath = getProfilePath(name);
  if (!existsSync(profilePath)) {
    return false;
  }
  unlinkSync(profilePath);

  // If this was the active profile, switch to default
  if (getActiveProfileName() === name) {
    setActiveProfile(DEFAULT_PROFILE);
  }
  return true;
}

export function listProfiles(): string[] {
  ensureConfigDir();
  const files = readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => f.replace('.json', ''));
}

export function profileExists(name: string): boolean {
  return existsSync(getProfilePath(name));
}

// Legacy compatibility - load from active profile
export function loadConfig(): ProfileConfig {
  return loadProfile();
}

export function saveConfig(config: ProfileConfig): void {
  saveProfile(config);
}

// Getters - use environment variables first, then active profile
export function getApiKey(): string | undefined {
  return process.env.BRANDSIGHT_API_KEY || loadProfile().apiKey;
}

export function getApiSecret(): string | undefined {
  return process.env.BRANDSIGHT_API_SECRET || loadProfile().apiSecret;
}

export function getCustomerId(): string | undefined {
  return process.env.BRANDSIGHT_CUSTOMER_ID || loadProfile().customerId;
}

export function getShopperId(): string | undefined {
  return process.env.BRANDSIGHT_SHOPPER_ID || loadProfile().shopperId;
}

// Setters - save to active profile
export function setApiKey(apiKey: string): void {
  const config = loadProfile();
  config.apiKey = apiKey;
  saveProfile(config);
}

export function setApiSecret(apiSecret: string): void {
  const config = loadProfile();
  config.apiSecret = apiSecret;
  saveProfile(config);
}

export function setCustomerId(customerId: string): void {
  const config = loadProfile();
  config.customerId = customerId;
  saveProfile(config);
}

export function setShopperId(shopperId: string): void {
  const config = loadProfile();
  config.shopperId = shopperId;
  saveProfile(config);
}

// Legacy compatibility
export function getDefaultAccount(): string | undefined {
  return getActiveProfileName();
}

export function setDefaultAccount(account: string): void {
  setActiveProfile(account);
}

export function clearConfig(): void {
  saveProfile({});
}

// ============================================
// Export/Import Directories
// ============================================

function getProfileExportsDir(profileName: string): string {
  return join(PROFILES_DIR, `${slugify(profileName)}_exports`);
}

function getProfileImportsDir(profileName: string): string {
  return join(PROFILES_DIR, `${slugify(profileName)}_imports`);
}

export function getExportsDir(profileName?: string): string {
  const name = profileName || getActiveProfileName();
  return getProfileExportsDir(name);
}

export function getImportsDir(profileName?: string): string {
  const name = profileName || getActiveProfileName();
  return getProfileImportsDir(name);
}

export function ensureExportsDir(profileName?: string): string {
  const dir = getExportsDir(profileName);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function ensureImportsDir(profileName?: string): string {
  const dir = getImportsDir(profileName);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getBaseConfigDir(): string {
  return CONFIG_DIR;
}
