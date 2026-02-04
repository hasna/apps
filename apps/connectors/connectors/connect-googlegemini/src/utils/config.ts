import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { GeminiConfig } from '../types';

const CONNECTOR_NAME = 'connect-googlegemini';
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
export function createProfile(name: string, config: GeminiConfig = {}): void {
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
export function loadProfile(name?: string): GeminiConfig {
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
  return JSON.parse(content) as GeminiConfig;
}

// Save profile config
export function saveProfile(name: string, config: GeminiConfig): void {
  ensureConfigDirs();
  const profilePath = getProfilePath(name);
  fs.writeFileSync(profilePath, JSON.stringify(config, null, 2));
}

// Get config value with env var override
export function getApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || loadProfile().apiKey;
}

export function getBaseUrl(): string {
  return process.env.GEMINI_BASE_URL || loadProfile().baseUrl || 'https://generativelanguage.googleapis.com';
}

// Set config values
export function setApiKey(key: string, profileName?: string): void {
  const name = profileName || getCurrentProfile();
  const config = loadProfile(name);
  config.apiKey = key;
  saveProfile(name, config);
}

export function setBaseUrl(url: string, profileName?: string): void {
  const name = profileName || getCurrentProfile();
  const config = loadProfile(name);
  config.baseUrl = url;
  saveProfile(name, config);
}

// Check if we have valid API key
export function hasApiKey(): boolean {
  return !!getApiKey();
}

// Clear all config for a profile
export function clearConfig(profileName?: string): void {
  const name = profileName || getCurrentProfile();
  saveProfile(name, {});
}
