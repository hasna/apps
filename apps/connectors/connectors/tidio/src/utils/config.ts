import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  chmodSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { join, resolve, sep } from 'path';

const CONNECTOR_NAME = 'connect-tidio';
const DEFAULT_PROFILE = 'default';
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface ProfileConfig {
  clientId?: string;
  clientSecret?: string;
}

let profileOverride: string | undefined;

function rootConfigDir(): string {
  return process.env.TIDIO_CONFIG_HOME || join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

function profilesDir(): string {
  return join(rootConfigDir(), 'profiles');
}

function currentProfileFile(): string {
  return join(rootConfigDir(), 'current_profile');
}

export function validateProfileName(profile: string): string {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }
  return profile;
}

function ensureInsideProfilesDir(path: string): string {
  const root = resolve(profilesDir());
  const candidate = resolve(path);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error('Profile path escapes the profiles directory');
  }
  return candidate;
}

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile ? validateProfileName(profile) : undefined;
}

export function ensureConfigDir(): void {
  mkdirSync(rootConfigDir(), { recursive: true, mode: 0o700 });
  chmodSync(rootConfigDir(), 0o700);
  mkdirSync(profilesDir(), { recursive: true, mode: 0o700 });
  chmodSync(profilesDir(), 0o700);
}

function getProfilePath(profile: string): string {
  const validProfile = validateProfileName(profile);
  return ensureInsideProfilesDir(join(profilesDir(), `${validProfile}.json`));
}

function writePrivateFile(path: string, value: string): void {
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureConfigDir();

  if (existsSync(currentProfileFile())) {
    try {
      const profile = readFileSync(currentProfileFile(), 'utf-8').trim();
      if (profile && validateProfileName(profile) && profileExists(profile)) {
        return profile;
      }
    } catch {
      // Fall through to default.
    }
  }

  return DEFAULT_PROFILE;
}

export function setCurrentProfile(profile: string): void {
  const validProfile = validateProfileName(profile);
  ensureConfigDir();

  if (!profileExists(validProfile) && validProfile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${validProfile}" does not exist`);
  }

  writePrivateFile(currentProfileFile(), validProfile);
}

export function profileExists(profile: string): boolean {
  return existsSync(getProfilePath(profile));
}

export function listProfiles(): string[] {
  ensureConfigDir();

  if (!existsSync(profilesDir())) {
    return [];
  }

  return readdirSync(profilesDir())
    .filter(file => file.endsWith('.json'))
    .map(file => file.replace(/\.json$/, ''))
    .filter(profile => PROFILE_NAME_PATTERN.test(profile))
    .sort();
}

export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  const validProfile = validateProfileName(profile);
  ensureConfigDir();

  if (profileExists(validProfile)) {
    return false;
  }

  writePrivateFile(getProfilePath(validProfile), `${JSON.stringify(config, null, 2)}\n`);
  return true;
}

export function deleteProfile(profile: string): boolean {
  const validProfile = validateProfileName(profile);
  if (validProfile === DEFAULT_PROFILE) {
    return false;
  }

  if (!profileExists(validProfile)) {
    return false;
  }

  if (getCurrentProfile() === validProfile) {
    setCurrentProfile(DEFAULT_PROFILE);
  }

  rmSync(getProfilePath(validProfile));
  return true;
}

export function loadProfile(profile?: string): ProfileConfig {
  ensureConfigDir();
  const profileName = profile ? validateProfileName(profile) : getCurrentProfile();
  const profilePath = getProfilePath(profileName);

  if (!existsSync(profilePath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(profilePath, 'utf-8')) as ProfileConfig;
  } catch {
    return {};
  }
}

export function saveProfile(config: ProfileConfig, profile?: string): void {
  ensureConfigDir();
  const profileName = profile ? validateProfileName(profile) : getCurrentProfile();
  writePrivateFile(getProfilePath(profileName), `${JSON.stringify(config, null, 2)}\n`);
}

export function getClientCredentials(): ProfileConfig {
  return {
    clientId: process.env.TIDIO_CLIENT_ID || loadProfile().clientId,
    clientSecret: process.env.TIDIO_CLIENT_SECRET || loadProfile().clientSecret,
  };
}

export function setClientCredentials(clientId: string, clientSecret: string): void {
  const config = loadProfile();
  config.clientId = clientId;
  config.clientSecret = clientSecret;
  saveProfile(config);
}

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return rootConfigDir();
}

export function getProfilesDir(): string {
  return profilesDir();
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}
