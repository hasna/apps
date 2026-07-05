import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-zerotier';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  apiKey?: string;
}

let profileOverride: string | undefined;

const CONFIG_DIR = join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const CURRENT_PROFILE_FILE = join(CONFIG_DIR, 'current_profile');

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (!existsSync(PROFILES_DIR)) mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 });
  try {
    chmodSync(CONFIG_DIR, 0o700);
    chmodSync(PROFILES_DIR, 0o700);
  } catch { /* best effort on filesystems without chmod support */ }
}

function getProfilePath(profile: string): string {
  return join(PROFILES_DIR, `${profile}.json`);
}

function writeProfileConfig(profile: string, config: ProfileConfig): void {
  const profilePath = getProfilePath(profile);
  writeFileSync(profilePath, JSON.stringify(config, null, 2), { mode: 0o600 });
  try { chmodSync(profilePath, 0o600); } catch { /* best effort on filesystems without chmod support */ }
}

export function getCurrentProfile(): string {
  if (profileOverride) return profileOverride;
  ensureConfigDir();
  if (existsSync(CURRENT_PROFILE_FILE)) {
    try {
      const profile = readFileSync(CURRENT_PROFILE_FILE, 'utf-8').trim();
      if (profile && profileExists(profile)) return profile;
    } catch { /* fall through */ }
  }
  return DEFAULT_PROFILE;
}

export function setCurrentProfile(profile: string): void {
  ensureConfigDir();
  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }
  writeFileSync(CURRENT_PROFILE_FILE, profile);
}

export function profileExists(profile: string): boolean {
  return existsSync(getProfilePath(profile));
}

export function listProfiles(): string[] {
  ensureConfigDir();
  if (!existsSync(PROFILES_DIR)) return [];
  return readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')).sort();
}

export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  ensureConfigDir();
  if (profileExists(profile)) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }
  writeProfileConfig(profile, config);
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
  const profilePath = getProfilePath(profile || getCurrentProfile());
  if (!existsSync(profilePath)) return {};
  try { return JSON.parse(readFileSync(profilePath, 'utf-8')); } catch { return {}; }
}

export function saveProfile(config: ProfileConfig, profile?: string): void {
  ensureConfigDir();
  writeProfileConfig(profile || getCurrentProfile(), config);
}

export function getApiKey(): string | undefined {
  return process.env.ZEROTIER_API_KEY || loadProfile().apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = loadProfile();
  config.apiKey = apiKey;
  saveProfile(config);
}

export function clearConfig(): void { saveProfile({}); }
export function getConfigDir(): string { return CONFIG_DIR; }
export function getActiveProfileName(): string { return getCurrentProfile(); }
