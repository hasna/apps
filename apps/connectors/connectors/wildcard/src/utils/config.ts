import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { ProviderAuthConfig } from '../types';
import { normalizeBaseUrl } from './url';

const CONNECTOR_NAME = 'connect-wildcard';
const DEFAULT_PROFILE = 'default';
const DEFAULT_BASE_URL = 'https://api.wild-card.ai';

export interface ProfileConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultCollectionId?: string;
  providerAuthJson?: Record<string, ProviderAuthConfig>;
}

let profileOverride: string | undefined;

const CONFIG_DIR = join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const CURRENT_PROFILE_FILE = join(CONFIG_DIR, 'current_profile');

export function setProfileOverride(profile: string | undefined): void {
  profileOverride = profile;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
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
  writeFileSync(getProfilePath(profile), JSON.stringify(config, null, 2));
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
    return JSON.parse(readFileSync(profilePath, 'utf-8')) as ProfileConfig;
  } catch {
    return {};
  }
}

export function saveProfile(config: ProfileConfig, profile?: string): void {
  ensureConfigDir();
  const profileName = profile || getCurrentProfile();
  writeFileSync(getProfilePath(profileName), JSON.stringify(config, null, 2));
}

export function getApiKey(): string | undefined {
  return process.env.WILDCARD_API_KEY?.trim() || loadProfile().apiKey?.trim();
}

export function setApiKey(apiKey: string): void {
  const config = loadProfile();
  config.apiKey = apiKey;
  saveProfile(config);
}

export function getBaseUrl(): string {
  const fromEnv = process.env.WILDCARD_BASE_URL?.trim();
  if (fromEnv) return normalizeBaseUrl(fromEnv, 'WILDCARD_BASE_URL');
  const fromProfile = loadProfile().baseUrl?.trim();
  if (fromProfile) return normalizeBaseUrl(fromProfile, 'baseUrl');
  return DEFAULT_BASE_URL;
}

export function setBaseUrl(baseUrl: string): void {
  const config = loadProfile();
  config.baseUrl = normalizeBaseUrl(baseUrl, 'baseUrl');
  saveProfile(config);
}

export function getDefaultCollectionId(): string | undefined {
  return process.env.WILDCARD_DEFAULT_COLLECTION_ID?.trim()
    || loadProfile().defaultCollectionId?.trim();
}

export function setDefaultCollectionId(collectionId: string): void {
  const config = loadProfile();
  config.defaultCollectionId = collectionId.trim();
  saveProfile(config);
}

export function getProviderAuthJson(): Record<string, ProviderAuthConfig> {
  const fromEnv = process.env.WILDCARD_PROVIDER_AUTH_JSON?.trim();
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('WILDCARD_PROVIDER_AUTH_JSON must be an object');
      }
      return parsed as Record<string, ProviderAuthConfig>;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Invalid WILDCARD_PROVIDER_AUTH_JSON: ${error.message}`);
      }
      throw new Error('Invalid WILDCARD_PROVIDER_AUTH_JSON');
    }
  }
  return loadProfile().providerAuthJson ?? {};
}

export function setProviderAuthJson(providerAuthJson: Record<string, ProviderAuthConfig>): void {
  const config = loadProfile();
  config.providerAuthJson = providerAuthJson;
  saveProfile(config);
}

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getWildcardConfig(): {
  apiKey: string;
  baseUrl: string;
  defaultCollectionId?: string;
  providerAuthJson: Record<string, ProviderAuthConfig>;
} {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Wildcard: API key is required');
  }
  return {
    apiKey,
    baseUrl: getBaseUrl(),
    defaultCollectionId: getDefaultCollectionId(),
    providerAuthJson: getProviderAuthJson(),
  };
}
