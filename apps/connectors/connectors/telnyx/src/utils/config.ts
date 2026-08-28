import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface TelnyxCliConfig {
  apiKey?: string;
}

const CONNECTOR_NAME = 'connect-telnyx';
const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

// Store for --profile flag override
let profileOverride: string | undefined;

// Config directory: ~/.hasna/connectors/connect-telnyx/
const BASE_CONFIG_DIR = join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);

// ============================================
// Profile Management
// ============================================

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

/**
 * Get the current active profile name
 */
export function getCurrentProfile(): string {
  if (profileOverride) {
    return profileOverride;
  }

  ensureBaseConfigDir();

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
  }

  const currentProfileFile = getCurrentProfileFile();
  if (existsSync(currentProfileFile)) {
    try {
      const profile = readFileSync(currentProfileFile, 'utf-8').trim();
      if (profile && profileExists(profile)) {
        return profile;
      }
    } catch {
      // Fall through to default
    }
  }

  return DEFAULT_PROFILE;
}

/**
 * Set the current active profile
 */
export function setCurrentProfile(profile: string): void {
  ensureBaseConfigDir();

  if (!profileExists(profile) && profile !== DEFAULT_PROFILE) {
    throw new Error(`Profile "${profile}" does not exist. Create it first with "profile create ${profile}"`);
  }

  writeFileSync(getCurrentProfileFile(), profile);
}

/**
 * Check if a profile exists
 */
export function profileExists(profile: string): boolean {
  const profileDir = join(getProfilesDir(), profile);
  return existsSync(profileDir);
}

/**
 * List all available profiles
 */
export function listProfiles(): string[] {
  ensureBaseConfigDir();

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    return [];
  }

  return readdirSync(profilesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort();
}

/**
 * Create a new profile
 */
export function createProfile(profile: string): void {
  ensureBaseConfigDir();

  if (profileExists(profile)) {
    throw new Error(`Profile "${profile}" already exists`);
  }

  // Validate profile name
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
  }

  const profileDir = join(getProfilesDir(), profile);
  mkdirSync(profileDir, { recursive: true });

  // Create empty config.json
  writeFileSync(join(profileDir, 'config.json'), JSON.stringify({}, null, 2));
}

/**
 * Delete a profile
 */
export function deleteProfile(profile: string): void {
  if (profile === DEFAULT_PROFILE) {
    throw new Error('Cannot delete the default profile');
  }

  if (!profileExists(profile)) {
    throw new Error(`Profile "${profile}" does not exist`);
  }

  const currentProfile = getCurrentProfile();
  if (currentProfile === profile) {
    setCurrentProfile(DEFAULT_PROFILE);
  }

  const profileDir = join(getProfilesDir(), profile);
  rmSync(profileDir, { recursive: true });
}

/**
 * Get the config directory for the current profile
 */
function getProfileDir(): string {
  ensureBaseConfigDir();

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
  }

  const profile = getCurrentProfile();
  const profileDir = join(profilesDir, profile);

  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }

  return profileDir;
}

export function getConfigDir(): string {
  return getProfileDir();
}

export function getBaseConfigDir(): string {
  return BASE_CONFIG_DIR;
}

export function ensureConfigDir(): void {
  getProfileDir();
}

// ============================================
// Init Command Support
// ============================================

const README_CONTENT = `# ${CONNECTOR_NAME} Configuration Directory

This directory contains configuration and data for the ${CONNECTOR_NAME} CLI.

## Directory Structure

\`\`\`
~/.hasna/connectors/${CONNECTOR_NAME}/
├── current_profile      # Current active profile name
└── profiles/
    ├── default/
    │   └── config.json  # Default profile configuration
    └── <profile-name>/
        └── config.json  # Named profile configuration
\`\`\`

## Profile Management

\`\`\`bash
${CONNECTOR_NAME} profile list              # List all profiles
${CONNECTOR_NAME} profile create <name>     # Create a new profile
${CONNECTOR_NAME} profile use <name>        # Switch to a profile
${CONNECTOR_NAME} profile delete <name>     # Delete a profile
${CONNECTOR_NAME} --profile <name> <cmd>    # Use profile for single command
\`\`\`

## Configuration

Set your Telnyx API key using the CLI:

\`\`\`bash
${CONNECTOR_NAME} config set-api-key <api_key>
\`\`\`

Or use environment variables:

\`\`\`bash
export TELNYX_API_KEY=<key>
\`\`\`

## More Information

- CLI Help: \`${CONNECTOR_NAME} --help\`
- Telnyx API: https://developers.telnyx.com/api
`;

/**
 * Initialize the full config directory structure
 */
export function initConfigDir(): { created: string[]; existing: string[] } {
  const created: string[] = [];
  const existing: string[] = [];

  if (!existsSync(BASE_CONFIG_DIR)) {
    mkdirSync(BASE_CONFIG_DIR, { recursive: true });
    created.push(BASE_CONFIG_DIR);
  } else {
    existing.push(BASE_CONFIG_DIR);
  }

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
    created.push(profilesDir);
  } else {
    existing.push(profilesDir);
  }

  const defaultProfileDir = join(profilesDir, DEFAULT_PROFILE);
  if (!existsSync(defaultProfileDir)) {
    mkdirSync(defaultProfileDir, { recursive: true });
    created.push(defaultProfileDir);
  } else {
    existing.push(defaultProfileDir);
  }

  const configFile = join(defaultProfileDir, 'config.json');
  if (!existsSync(configFile)) {
    writeFileSync(configFile, JSON.stringify({}, null, 2));
    created.push(configFile);
  } else {
    existing.push(configFile);
  }

  const readmeFile = join(BASE_CONFIG_DIR, 'README.md');
  if (!existsSync(readmeFile)) {
    writeFileSync(readmeFile, README_CONTENT);
    created.push(readmeFile);
  } else {
    existing.push(readmeFile);
  }

  const currentProfileFile = getCurrentProfileFile();
  if (!existsSync(currentProfileFile)) {
    writeFileSync(currentProfileFile, DEFAULT_PROFILE);
    created.push(currentProfileFile);
  } else {
    existing.push(currentProfileFile);
  }

  return { created, existing };
}

// ============================================
// Config Management
// ============================================

export function loadConfig(): TelnyxCliConfig {
  ensureConfigDir();
  const configFile = join(getProfileDir(), 'config.json');

  if (!existsSync(configFile)) {
    return {};
  }

  try {
    const content = readFileSync(configFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export function saveConfig(config: TelnyxCliConfig): void {
  ensureConfigDir();
  const configFile = join(getProfileDir(), 'config.json');
  writeFileSync(configFile, JSON.stringify(config, null, 2));
}

export function getApiKey(): string | undefined {
  // Priority: environment variable > config file
  return process.env.TELNYX_API_KEY || loadConfig().apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = loadConfig();
  config.apiKey = apiKey;
  saveConfig(config);
}

export function clearConfig(): void {
  saveConfig({});
}

// ============================================
// Utility Functions
// ============================================

export function isAuthenticated(): boolean {
  const apiKey = getApiKey();
  return apiKey !== undefined && apiKey !== '';
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}
