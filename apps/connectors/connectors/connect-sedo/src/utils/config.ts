import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface ProfileConfig {
  partnerId?: string;
  signKey?: string;
  username?: string;
  password?: string;
}

interface GlobalConfig {
  activeProfile?: string;
}

const CONFIG_DIR = join(homedir(), '.connect', 'connect-sedo');
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const GLOBAL_CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const DEFAULT_PROFILE = 'default';

// In-memory profile override for --profile flag
let profileOverride: string | undefined;

function ensureConfigDir(): void {
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
    return false;
  }
  writeFileSync(profilePath, JSON.stringify(config, null, 2));
  return true;
}

export function deleteProfile(name: string): boolean {
  if (name === DEFAULT_PROFILE) {
    return false;
  }
  const profilePath = getProfilePath(name);
  if (!existsSync(profilePath)) {
    return false;
  }
  unlinkSync(profilePath);

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

// Getters - use environment variables first, then active profile
export function getPartnerId(): string | undefined {
  return process.env.SEDO_PARTNER_ID || loadProfile().partnerId;
}

export function getSignKey(): string | undefined {
  return process.env.SEDO_API_KEY || process.env.SEDO_SIGN_KEY || loadProfile().signKey;
}

export function getUsername(): string | undefined {
  return process.env.SEDO_USERNAME || loadProfile().username;
}

export function getPassword(): string | undefined {
  return process.env.SEDO_PASSWORD || loadProfile().password;
}

// Setters - save to active profile
export function setPartnerId(partnerId: string): void {
  const config = loadProfile();
  config.partnerId = partnerId;
  saveProfile(config);
}

export function setSignKey(signKey: string): void {
  const config = loadProfile();
  config.signKey = signKey;
  saveProfile(config);
}

export function setUsername(username: string): void {
  const config = loadProfile();
  config.username = username;
  saveProfile(config);
}

export function setPassword(password: string): void {
  const config = loadProfile();
  config.password = password;
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
