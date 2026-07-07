import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ProfileConfig } from "../types/index.js";

const CONNECTOR_NAME = "connect-triple-whale";
const DEFAULT_PROFILE = "default";

let profileOverride: string | undefined;

const CONFIG_DIR = join(homedir(), ".hasna", "connectors", CONNECTOR_NAME);
const PROFILES_DIR = join(CONFIG_DIR, "profiles");
const CURRENT_PROFILE_FILE = join(CONFIG_DIR, "current_profile");

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
      const profile = readFileSync(CURRENT_PROFILE_FILE, "utf-8").trim();
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
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort();
}

export function createProfile(profile: string, config: ProfileConfig = {}): boolean {
  ensureConfigDir();
  if (profileExists(profile)) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error("Profile name can only contain letters, numbers, hyphens, and underscores");
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
    return JSON.parse(readFileSync(profilePath, "utf-8")) as ProfileConfig;
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
  return process.env.TRIPLE_WHALE_API_KEY || loadProfile().apiKey;
}

export function setApiKey(key: string): void {
  const config = loadProfile();
  config.apiKey = key;
  saveProfile(config);
}

export function getShopDomain(): string | undefined {
  return process.env.TRIPLE_WHALE_SHOP_DOMAIN || loadProfile().shopDomain;
}

export function setShopDomain(domain: string): void {
  const config = loadProfile();
  config.shopDomain = domain;
  saveProfile(config);
}

export function getBaseUrl(): string | undefined {
  return process.env.TRIPLE_WHALE_BASE_URL || loadProfile().baseUrl;
}

export function setBaseUrl(url: string): void {
  const config = loadProfile();
  config.baseUrl = url;
  saveProfile(config);
}

export function clearConfig(): void {
  saveProfile({});
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}
