import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-stampedio';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  publicKey?: string;
  privateKey?: string;
  storeHash?: string;
  storeUrl?: string;
}

// Store for --profile flag override (set by CLI before commands run)
let profileOverride: string | undefined;

// Config directory: ~/.hasna/connectors/{connector-name}/
function configDir(): string {
  return join(process.env.HOME || homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

function profilesDir(): string {
  return join(configDir(), 'profiles');
}

function currentProfileFile(): string {
  return join(configDir(), 'current_profile');
}

// ============================================
// Profile Management
// ============================================

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function ensureConfigDir(): void {
  if (!existsSync(configDir())) mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  if (!existsSync(profilesDir())) mkdirSync(profilesDir(), { recursive: true, mode: 0o700 });
}

function getProfilePath(profile: string): string {
  return join(profilesDir(), `${profile}.json`);
}

function writeProfileFile(profilePath: string, config: ProfileConfig): void {
  writeFileSync(profilePath, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(profilePath, 0o600);
}

export function getCurrentProfile(): string {
  if (profileOverride) return profileOverride;
  ensureConfigDir();
  const currentPath = currentProfileFile();
  if (existsSync(currentPath)) {
    try {
      const profile = readFileSync(currentPath, 'utf-8').trim();
      if (profile && profileExists(profile)) return profile;
    } catch {
      // Fall through to default
    }
  }
  return DEFAULT_PROFILE;
}

export function setCurrentProfile(profile: string): void {
  ensureConfigDir();
  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }
  writeFileSync(currentProfileFile(), profile);
}

export function profileExists(profile: string): boolean {
  return existsSync(getProfilePath(profile));
}

export function listProfiles(): string[] {
  ensureConfigDir();
  const dir = profilesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
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
  writeProfileFile(getProfilePath(profile), config);
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
  writeProfileFile(getProfilePath(profileName), config);
}

// ============================================
// Stamped.io Credentials Management
// Environment variables take precedence over stored profile values.
// ============================================

export function getPublicKey(): string | undefined {
  return process.env.STAMPEDIO_PUBLIC_KEY || loadProfile().publicKey;
}

export function setPublicKey(publicKey: string): void {
  const config = loadProfile();
  config.publicKey = publicKey;
  saveProfile(config);
}

export function getPrivateKey(): string | undefined {
  return process.env.STAMPEDIO_PRIVATE_KEY || loadProfile().privateKey;
}

export function setPrivateKey(privateKey: string): void {
  const config = loadProfile();
  config.privateKey = privateKey;
  saveProfile(config);
}

export function getStoreHash(): string | undefined {
  return process.env.STAMPEDIO_STORE_HASH || loadProfile().storeHash;
}

export function setStoreHash(storeHash: string): void {
  const config = loadProfile();
  config.storeHash = storeHash;
  saveProfile(config);
}

export function getStoreUrl(): string | undefined {
  return process.env.STAMPEDIO_STORE_URL || loadProfile().storeUrl;
}

export function setStoreUrl(storeUrl: string): void {
  const config = loadProfile();
  config.storeUrl = storeUrl;
  saveProfile(config);
}

export function hasCredentials(): boolean {
  return Boolean(getPrivateKey() && getStoreHash());
}

// ============================================
// Utility Functions
// ============================================

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return configDir();
}
