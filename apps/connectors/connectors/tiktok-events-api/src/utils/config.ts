import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'connect-tiktok-events-api';
const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

export interface ProfileConfig {
  accessToken?: string;
  advertiserId?: string;
  pixelCode?: string;
  appId?: string;
  offlineEventSetId?: string;
  crmEventSetId?: string;
  testEventCode?: string;
  baseUrl?: string;
}

let profileOverride: string | undefined;

function resolveBaseConfigDir(): string {
  return join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);
}

const BASE_CONFIG_DIR = resolveBaseConfigDir();

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

export function profileExists(profile: string): boolean {
  ensureProfilesDir();
  return existsSync(join(getProfilesDir(), profile));
}

function ensureProfilesDir(): void {
  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
  }
}

export function getCurrentProfile(): string {
  if (profileOverride) return profileOverride;

  ensureBaseConfigDir();
  ensureProfilesDir();

  const currentProfileFile = getCurrentProfileFile();
  if (existsSync(currentProfileFile)) {
    try {
      const profile = readFileSync(currentProfileFile, 'utf-8').trim();
      if (profile && profileExists(profile)) return profile;
    } catch {
      // fall through
    }
  }

  return DEFAULT_PROFILE;
}

export function setCurrentProfile(profile: string): void {
  ensureBaseConfigDir();
  ensureProfilesDir();
  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist`);
  }
  writeFileSync(getCurrentProfileFile(), profile);
}

export function listProfiles(): string[] {
  ensureBaseConfigDir();
  ensureProfilesDir();
  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) return [];

  return readdirSync(profilesDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort();
}

export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  ensureBaseConfigDir();
  ensureProfilesDir();
  if (profileExists(profile)) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }

  const profileDir = join(getProfilesDir(), profile);
  mkdirSync(profileDir, { recursive: true });
  if (Object.keys(config).length > 0) {
    writeFileSync(join(profileDir, 'config.json'), JSON.stringify(config, null, 2));
  }
  return true;
}

export function deleteProfile(profile: string): boolean {
  if (profile === DEFAULT_PROFILE) return false;
  if (!profileExists(profile)) return false;
  if (getCurrentProfile() === profile) setCurrentProfile(DEFAULT_PROFILE);
  rmSync(join(getProfilesDir(), profile), { recursive: true });
  return true;
}

function resolveConfigDir(): string {
  ensureBaseConfigDir();
  ensureProfilesDir();
  const profile = getCurrentProfile();
  const profileDir = join(getProfilesDir(), profile);
  if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true });
  return profileDir;
}

export function getConfigDir(): string {
  return resolveConfigDir();
}

export function getBaseConfigDir(): string {
  return BASE_CONFIG_DIR;
}

export function loadProfile(profile?: string): ProfileConfig {
  const profileName = profile || getCurrentProfile();
  const configFile = join(getProfilesDir(), profileName, 'config.json');
  if (!existsSync(configFile)) return {};
  try {
    return JSON.parse(readFileSync(configFile, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveProfile(config: ProfileConfig, profile?: string): void {
  const profileName = profile || getCurrentProfile();
  const profileDir = join(getProfilesDir(), profileName);
  if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, 'config.json'), JSON.stringify(config, null, 2));
}

export function getAccessToken(): string | undefined {
  return process.env.TIKTOK_ACCESS_TOKEN || loadProfile().accessToken;
}

export function setAccessToken(accessToken: string): void {
  const config = loadProfile();
  config.accessToken = accessToken;
  saveProfile(config);
}

export function getAdvertiserId(): string | undefined {
  return process.env.TIKTOK_ADVERTISER_ID || loadProfile().advertiserId;
}

export function setAdvertiserId(advertiserId: string): void {
  const config = loadProfile();
  config.advertiserId = advertiserId;
  saveProfile(config);
}

export function getPixelCode(): string | undefined {
  return process.env.TIKTOK_PIXEL_CODE || loadProfile().pixelCode;
}

export function setPixelCode(pixelCode: string): void {
  const config = loadProfile();
  config.pixelCode = pixelCode;
  saveProfile(config);
}

export function getAppId(): string | undefined {
  return process.env.TIKTOK_APP_ID || loadProfile().appId;
}

export function setAppId(appId: string): void {
  const config = loadProfile();
  config.appId = appId;
  saveProfile(config);
}

export function getOfflineEventSetId(): string | undefined {
  return process.env.TIKTOK_OFFLINE_EVENT_SET_ID || loadProfile().offlineEventSetId;
}

export function setOfflineEventSetId(offlineEventSetId: string): void {
  const config = loadProfile();
  config.offlineEventSetId = offlineEventSetId;
  saveProfile(config);
}

export function getCrmEventSetId(): string | undefined {
  return process.env.TIKTOK_CRM_EVENT_SET_ID || loadProfile().crmEventSetId;
}

export function setCrmEventSetId(crmEventSetId: string): void {
  const config = loadProfile();
  config.crmEventSetId = crmEventSetId;
  saveProfile(config);
}

export function getTestEventCode(): string | undefined {
  return process.env.TIKTOK_TEST_EVENT_CODE || loadProfile().testEventCode;
}

export function setTestEventCode(testEventCode: string): void {
  const config = loadProfile();
  config.testEventCode = testEventCode;
  saveProfile(config);
}

export function getApiBaseUrl(): string | undefined {
  return process.env.TIKTOK_API_BASE_URL || loadProfile().baseUrl;
}

export function setApiBaseUrl(baseUrl: string): void {
  const config = loadProfile();
  config.baseUrl = baseUrl;
  saveProfile(config);
}

export function clearConfig(): void {
  saveProfile({});
}

export { CONNECTOR_NAME };
