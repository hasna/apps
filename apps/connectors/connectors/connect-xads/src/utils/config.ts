import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { XAdsConfig } from '../types';

const CONNECTOR_NAME = 'connect-xads';
const CONFIG_DIR = path.join(os.homedir(), '.connect', CONNECTOR_NAME);
const PROFILES_DIR = path.join(CONFIG_DIR, 'profiles');
const CURRENT_PROFILE_FILE = path.join(CONFIG_DIR, 'current_profile');

// Ensure config directories exist
function ensureConfigDirs(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

// Get profile file path
function getProfilePath(name: string): string {
  return path.join(PROFILES_DIR, `${name}.json`);
}

// Get current profile name
export function getCurrentProfile(): string {
  ensureConfigDirs();
  if (fs.existsSync(CURRENT_PROFILE_FILE)) {
    return fs.readFileSync(CURRENT_PROFILE_FILE, 'utf-8').trim() || 'default';
  }
  return 'default';
}

// Set current profile
export function setCurrentProfile(name: string): void {
  ensureConfigDirs();
  if (!fs.existsSync(getProfilePath(name))) {
    throw new Error(`Profile '${name}' does not exist`);
  }
  fs.writeFileSync(CURRENT_PROFILE_FILE, name);
}

// List all profiles
export function listProfiles(): string[] {
  ensureConfigDirs();
  const files = fs.readdirSync(PROFILES_DIR);
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
}

// Create a new profile
export function createProfile(name: string, config: XAdsConfig = {}): void {
  ensureConfigDirs();
  const profilePath = getProfilePath(name);
  if (fs.existsSync(profilePath)) {
    throw new Error(`Profile '${name}' already exists`);
  }
  fs.writeFileSync(profilePath, JSON.stringify(config, null, 2));
}

// Delete a profile
export function deleteProfile(name: string): void {
  if (name === 'default') {
    throw new Error("Cannot delete 'default' profile");
  }
  const profilePath = getProfilePath(name);
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile '${name}' does not exist`);
  }
  fs.unlinkSync(profilePath);

  // If deleting current profile, switch to default
  if (getCurrentProfile() === name) {
    setCurrentProfile('default');
  }
}

// Load profile config
export function loadProfile(name?: string): XAdsConfig {
  ensureConfigDirs();
  const profileName = name || getCurrentProfile();
  const profilePath = getProfilePath(profileName);

  if (!fs.existsSync(profilePath)) {
    // Create default profile if it doesn't exist
    if (profileName === 'default') {
      createProfile('default', {});
      return {};
    }
    throw new Error(`Profile '${profileName}' does not exist`);
  }

  const content = fs.readFileSync(profilePath, 'utf-8');
  return JSON.parse(content) as XAdsConfig;
}

// Save profile config
export function saveProfile(name: string, config: XAdsConfig): void {
  ensureConfigDirs();
  const profilePath = getProfilePath(name);
  fs.writeFileSync(profilePath, JSON.stringify(config, null, 2));
}

// Get config value with env var override
export function getConsumerKey(): string | undefined {
  return process.env.X_ADS_CONSUMER_KEY || loadProfile().consumerKey;
}

export function getConsumerSecret(): string | undefined {
  return process.env.X_ADS_CONSUMER_SECRET || loadProfile().consumerSecret;
}

export function getAccessToken(): string | undefined {
  return process.env.X_ADS_ACCESS_TOKEN || loadProfile().accessToken;
}

export function getAccessTokenSecret(): string | undefined {
  return process.env.X_ADS_ACCESS_TOKEN_SECRET || loadProfile().accessTokenSecret;
}

export function getAccountId(): string | undefined {
  return process.env.X_ADS_ACCOUNT_ID || loadProfile().accountId;
}

// Set config values
export function setConsumerKey(key: string, profileName?: string): void {
  const name = profileName || getCurrentProfile();
  const config = loadProfile(name);
  config.consumerKey = key;
  saveProfile(name, config);
}

export function setConsumerSecret(secret: string, profileName?: string): void {
  const name = profileName || getCurrentProfile();
  const config = loadProfile(name);
  config.consumerSecret = secret;
  saveProfile(name, config);
}

export function setAccessToken(token: string, profileName?: string): void {
  const name = profileName || getCurrentProfile();
  const config = loadProfile(name);
  config.accessToken = token;
  saveProfile(name, config);
}

export function setAccessTokenSecret(secret: string, profileName?: string): void {
  const name = profileName || getCurrentProfile();
  const config = loadProfile(name);
  config.accessTokenSecret = secret;
  saveProfile(name, config);
}

export function setAccountId(id: string, profileName?: string): void {
  const name = profileName || getCurrentProfile();
  const config = loadProfile(name);
  config.accountId = id;
  saveProfile(name, config);
}

// Check if we have valid OAuth credentials
export function hasOAuthCredentials(): boolean {
  const consumerKey = getConsumerKey();
  const consumerSecret = getConsumerSecret();
  const accessToken = getAccessToken();
  const accessTokenSecret = getAccessTokenSecret();
  return !!(consumerKey && consumerSecret && accessToken && accessTokenSecret);
}

// Clear all config for a profile
export function clearConfig(profileName?: string): void {
  const name = profileName || getCurrentProfile();
  saveProfile(name, {});
}
