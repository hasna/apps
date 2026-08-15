import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-vectorshift';
const DEFAULT_PROFILE = 'default';
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface ProfileConfig {
  apiKey?: string;
}

let profileOverride: string | undefined;
let configHomeOverride: string | undefined;

function getHomeDir(): string {
  return configHomeOverride || homedir();
}

function getConfigDirPath(): string {
  return join(getHomeDir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

function getProfilesDirPath(): string {
  return join(getConfigDirPath(), 'profiles');
}

function getCurrentProfileFilePath(): string {
  return join(getConfigDirPath(), 'current_profile');
}

export function setConfigHomeForTests(home: string | undefined): void {
  configHomeOverride = home;
  profileOverride = undefined;
}

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile === undefined ? undefined : validateProfileName(profile);
}

export function ensureConfigDir(): void {
  const configDir = getConfigDirPath();
  const profilesDir = getProfilesDirPath();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodSync(configDir, PRIVATE_DIR_MODE);
  if (!existsSync(profilesDir)) mkdirSync(profilesDir, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodSync(profilesDir, PRIVATE_DIR_MODE);
}

export function isValidProfileName(profile: string): boolean {
  return PROFILE_NAME_PATTERN.test(profile);
}

function validateProfileName(profile: string): string {
  if (!isValidProfileName(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }
  return profile;
}

function writePrivateFile(path: string, contents: string): void {
  writeFileSync(path, contents, { mode: PRIVATE_FILE_MODE });
  chmodSync(path, PRIVATE_FILE_MODE);
}

function getProfilePath(profile: string): string {
  return join(getProfilesDirPath(), `${validateProfileName(profile)}.json`);
}

function resolveProfile(profile: string | undefined): string {
  return profile === undefined ? getCurrentProfile() : validateProfileName(profile);
}

export function getCurrentProfile(): string {
  if (profileOverride) return profileOverride;
  ensureConfigDir();
  const currentProfileFile = getCurrentProfileFilePath();
  if (existsSync(currentProfileFile)) {
    try {
      const profile = readFileSync(currentProfileFile, 'utf-8').trim();
      if (profile && isValidProfileName(profile) && profileExists(profile)) return profile;
    } catch { /* fall through */ }
  }
  return DEFAULT_PROFILE;
}

export function setCurrentProfile(profile: string): void {
  const validatedProfile = validateProfileName(profile);
  ensureConfigDir();
  if (!profileExists(validatedProfile) && validatedProfile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${validatedProfile}" does not exist`);
  }
  writePrivateFile(getCurrentProfileFilePath(), validatedProfile);
}

export function profileExists(profile: string): boolean {
  return existsSync(getProfilePath(profile));
}

export function listProfiles(): string[] {
  ensureConfigDir();
  const profilesDir = getProfilesDirPath();
  if (!existsSync(profilesDir)) return [];
  return readdirSync(profilesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .filter(isValidProfileName)
    .sort();
}

export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  const validatedProfile = validateProfileName(profile);
  ensureConfigDir();
  if (profileExists(validatedProfile)) return false;
  writePrivateFile(getProfilePath(validatedProfile), JSON.stringify(config, null, 2));
  return true;
}

export function deleteProfile(profile: string): boolean {
  const validatedProfile = validateProfileName(profile);
  if (validatedProfile === DEFAULT_PROFILE) return false;
  if (!profileExists(validatedProfile)) return false;
  if (getCurrentProfile() === validatedProfile) setCurrentProfile(DEFAULT_PROFILE);
  rmSync(getProfilePath(validatedProfile));
  return true;
}

export function loadProfile(profile?: string): ProfileConfig {
  ensureConfigDir();
  const profilePath = getProfilePath(resolveProfile(profile));
  if (!existsSync(profilePath)) return {};
  try { return JSON.parse(readFileSync(profilePath, 'utf-8')); } catch { return {}; }
}

export function saveProfile(config: ProfileConfig, profile?: string): void {
  ensureConfigDir();
  writePrivateFile(getProfilePath(resolveProfile(profile)), JSON.stringify(config, null, 2));
}

export function getApiKey(): string | undefined {
  return process.env.VECTORSHIFT_API_KEY || loadProfile().apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = loadProfile();
  config.apiKey = apiKey;
  saveProfile(config);
}

export function clearConfig(): void { saveProfile({}); }
export function getConfigDir(): string { return getConfigDirPath(); }
export function getActiveProfileName(): string { return getCurrentProfile(); }
