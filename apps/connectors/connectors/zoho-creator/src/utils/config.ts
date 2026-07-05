import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { VALID_DATA_CENTERS, VALID_ENVIRONMENTS } from '../api/client';
import type { ZohoCreatorConfig, ZohoCreatorDataCenter, ZohoCreatorEnvironment } from '../types';

const CONNECTOR_NAME = 'zoho-creator';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  accessToken?: string;
  dataCenter?: ZohoCreatorDataCenter;
  environment?: ZohoCreatorEnvironment;
}

let profileOverride: string | undefined;

const CONFIG_DIR = join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const CURRENT_PROFILE_FILE = join(CONFIG_DIR, 'current_profile');

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(PROFILES_DIR)) mkdirSync(PROFILES_DIR, { recursive: true });
}

function getProfilePath(profile: string): string {
  return join(PROFILES_DIR, `${profile}.json`);
}

export function getCurrentProfile(): string {
  if (profileOverride) return profileOverride;
  ensureConfigDir();
  if (existsSync(CURRENT_PROFILE_FILE)) {
    try {
      const profile = readFileSync(CURRENT_PROFILE_FILE, 'utf-8').trim();
      if (profile && profileExists(profile)) return profile;
    } catch {
      // fall through
    }
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
  return readdirSync(PROFILES_DIR)
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
  validateProfileConfig(config);
  writeFileSync(getProfilePath(profile), JSON.stringify(config, null, 2));
  return true;
}

export function deleteProfile(profile: string): boolean {
  if (profile === DEFAULT_PROFILE || !profileExists(profile)) return false;
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
  validateProfileConfig(config);
  const profileName = profile || getCurrentProfile();
  writeFileSync(getProfilePath(profileName), JSON.stringify(config, null, 2));
}

export function getAccessToken(): string | undefined {
  return process.env.ZOHOCREATOR_ACCESS_TOKEN || loadProfile().accessToken;
}

export function setAccessToken(accessToken: string): void {
  const config = loadProfile();
  config.accessToken = accessToken;
  saveProfile(config);
}

export function getDataCenter(): ZohoCreatorDataCenter | undefined {
  const env = process.env.ZOHOCREATOR_DATA_CENTER as ZohoCreatorDataCenter | undefined;
  return env || loadProfile().dataCenter;
}

export function setDataCenter(dataCenter: ZohoCreatorDataCenter): void {
  validateDataCenter(dataCenter);
  const config = loadProfile();
  config.dataCenter = dataCenter;
  saveProfile(config);
}

export function getEnvironment(): ZohoCreatorEnvironment | undefined {
  const env = process.env.ZOHOCREATOR_ENVIRONMENT as ZohoCreatorEnvironment | undefined;
  return env || loadProfile().environment;
}

export function setEnvironment(environment: ZohoCreatorEnvironment): void {
  validateEnvironment(environment);
  const config = loadProfile();
  config.environment = environment;
  saveProfile(config);
}

export function getZohoCreatorConfig(): ZohoCreatorConfig | null {
  const accessToken = getAccessToken();
  if (!accessToken) return null;
  return {
    accessToken,
    dataCenter: getDataCenter(),
    environment: getEnvironment(),
  };
}

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

function validateProfileConfig(config: ProfileConfig): void {
  if (config.dataCenter !== undefined) validateDataCenter(config.dataCenter);
  if (config.environment !== undefined) validateEnvironment(config.environment);
}

function validateDataCenter(dataCenter: ZohoCreatorDataCenter): void {
  if (!VALID_DATA_CENTERS.includes(dataCenter)) {
    throw new Error(`Zoho Creator data_center must be one of: ${VALID_DATA_CENTERS.join(', ')}`);
  }
}

function validateEnvironment(environment: ZohoCreatorEnvironment): void {
  if (!VALID_ENVIRONMENTS.includes(environment)) {
    throw new Error(`Zoho Creator environment must be one of: ${VALID_ENVIRONMENTS.join(', ')}`);
  }
}
