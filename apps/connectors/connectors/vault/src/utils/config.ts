import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONNECTOR_NAME = 'vault';
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  baseUrl?: string;
  token?: string;
  namespace?: string;
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
    const name = readFileSync(CURRENT_PROFILE_FILE, 'utf-8').trim();
    if (name) return name;
  }
  return DEFAULT_PROFILE;
}

export function setCurrentProfile(profile: string): void {
  ensureConfigDir();
  writeFileSync(CURRENT_PROFILE_FILE, profile, 'utf-8');
}

export function listProfiles(): string[] {
  ensureConfigDir();
  if (!existsSync(PROFILES_DIR)) return [];
  return readdirSync(PROFILES_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
}

export function profileExists(profile: string): boolean {
  return existsSync(getProfilePath(profile));
}

export function loadProfile(profile?: string): ProfileConfig {
  const name = profile ?? getCurrentProfile();
  const path = getProfilePath(name);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8')) as ProfileConfig;
}

export function saveProfile(profile: string, config: ProfileConfig): void {
  ensureConfigDir();
  writeFileSync(getProfilePath(profile), JSON.stringify(config, null, 2), 'utf-8');
}

export function createProfile(name: string, config: ProfileConfig = {}): void {
  if (profileExists(name)) throw new Error(`Profile "${name}" already exists`);
  saveProfile(name, config);
}

export function deleteProfile(name: string): boolean {
  const path = getProfilePath(name);
  if (!existsSync(path)) return false;
  rmSync(path);
  if (getCurrentProfile() === name) setCurrentProfile(DEFAULT_PROFILE);
  return true;
}

export function getConfigDir(): string {
  ensureConfigDir();
  return CONFIG_DIR;
}

export function getBaseUrl(): string | undefined {
  return process.env.VAULT_BASE_URL?.trim() || loadProfile().baseUrl?.trim();
}

export function setBaseUrl(baseUrl: string): void {
  const config = loadProfile();
  config.baseUrl = baseUrl;
  saveProfile(getCurrentProfile(), config);
}

export function getToken(): string | undefined {
  return process.env.VAULT_TOKEN?.trim() || loadProfile().token?.trim();
}

export function setToken(token: string): void {
  const config = loadProfile();
  config.token = token;
  saveProfile(getCurrentProfile(), config);
}

export function getNamespace(): string | undefined {
  return process.env.VAULT_NAMESPACE?.trim() || loadProfile().namespace?.trim();
}

export function setNamespace(namespace: string): void {
  const config = loadProfile();
  config.namespace = namespace;
  saveProfile(getCurrentProfile(), config);
}

export function clearConfig(): void {
  saveProfile(getCurrentProfile(), {});
}

export function loadVaultConfig(): { baseUrl: string; token: string; namespace?: string } {
  const baseUrl = getBaseUrl();
  const token = getToken();
  if (!baseUrl) throw new Error('Vault base URL not configured. Set VAULT_BASE_URL or run connect-vault config set-base-url');
  if (!token) throw new Error('Vault token not configured. Set VAULT_TOKEN or run connect-vault config set-token');
  const namespace = getNamespace();
  return namespace ? { baseUrl, token, namespace } : { baseUrl, token };
}
