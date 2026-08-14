import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface ZendeskCliConfig {
  email?: string;
  apiToken?: string;
  baseUrl?: string;
  defaultAccount?: string;
  remoteApiUrl?: string;
}

const CONNECTOR_NAME = 'connect-zendesk';
const DEFAULT_PROFILE = 'default';
const CURRENT_PROFILE_FILE = 'current_profile';
const PROFILES_DIR = 'profiles';

// Store for --profile flag override
let profileOverride: string | undefined;

// Config directory: ~/.hasna/connectors/connect-zendesk/
const BASE_CONFIG_DIR = join(homedir(), '.hasna', 'connectors', CONNECTOR_NAME);

// Old config directory for migration
const OLD_CONFIG_DIR = join(homedir(), '.connect-zendesk');

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
// Migration from old config directory
// ============================================

/**
 * Check if migration from old config directory is needed
 */
export function needsMigration(): boolean {
  const oldConfigFile = join(OLD_CONFIG_DIR, 'config.json');
  const defaultProfileDir = join(getProfilesDir(), DEFAULT_PROFILE);
  const newConfigFile = join(defaultProfileDir, 'config.json');

  // Need migration if old config exists and new config doesn't
  return existsSync(oldConfigFile) && !existsSync(newConfigFile);
}

/**
 * Migrate from old ~/.connect-zendesk/ to new ~/.hasna/connectors/connect-zendesk/ structure
 */
export function migrateFromOldConfig(): { migrated: boolean; message: string } {
  if (!needsMigration()) {
    return { migrated: false, message: 'No migration needed' };
  }

  try {
    // Ensure new directory structure exists
    ensureBaseConfigDir();
    const defaultProfileDir = join(getProfilesDir(), DEFAULT_PROFILE);
    if (!existsSync(defaultProfileDir)) {
      mkdirSync(defaultProfileDir, { recursive: true });
    }

    // Migrate config.json
    const oldConfigFile = join(OLD_CONFIG_DIR, 'config.json');
    if (existsSync(oldConfigFile)) {
      const configContent = readFileSync(oldConfigFile, 'utf-8');
      const newConfigFile = join(defaultProfileDir, 'config.json');
      writeFileSync(newConfigFile, configContent);
    }

    // Set default profile as current
    writeFileSync(getCurrentProfileFile(), DEFAULT_PROFILE);

    return {
      migrated: true,
      message: `Migrated config from ${OLD_CONFIG_DIR} to ${BASE_CONFIG_DIR}`
    };
  } catch (err) {
    return {
      migrated: false,
      message: `Migration failed: ${String(err)}`
    };
  }
}

// ============================================
// Exports Directory (shared across profiles)
// ============================================

const EXPORTS_DIR = join(BASE_CONFIG_DIR, 'exports');
const LOG_FILE = join(BASE_CONFIG_DIR, 'connect-zendesk.log');

/**
 * Get the exports directory path (shared across profiles)
 */
export function getExportsDir(): string {
  ensureBaseConfigDir();
  if (!existsSync(EXPORTS_DIR)) {
    mkdirSync(EXPORTS_DIR, { recursive: true });
  }
  return EXPORTS_DIR;
}

/**
 * Get the log file path
 */
export function getLogFile(): string {
  return LOG_FILE;
}

// ============================================
// Init Command Support
// ============================================

const README_CONTENT = `# connect-zendesk Configuration Directory

This directory contains configuration and data for the connect-zendesk CLI.

## Directory Structure

\`\`\`
~/.hasna/connectors/connect-zendesk/
├── current_profile      # Current active profile name
├── profiles/
│   ├── default/
│   │   └── config.json  # Default profile configuration
│   └── <profile-name>/
│       └── config.json  # Named profile configuration
├── exports/             # Exported CSV/JSON data (shared)
└── connect-zendesk.log  # Activity logs (shared)
\`\`\`

## Profile Management

\`\`\`bash
connect-zendesk profile list              # List all profiles
connect-zendesk profile create <name>     # Create a new profile
connect-zendesk profile use <name>        # Switch to a profile
connect-zendesk profile delete <name>     # Delete a profile
connect-zendesk profile show              # Show current profile
connect-zendesk --profile <name> <cmd>    # Use profile for single command
\`\`\`

## Configuration

Set your Zendesk credentials using the CLI:

\`\`\`bash
connect-zendesk config set-email your-email@example.com
connect-zendesk config set-token your-api-token
connect-zendesk config set-base-url https://your-subdomain.zendesk.com/api/v2
\`\`\`

Or use environment variables:

\`\`\`bash
export ZENDESK_EMAIL=your-email@example.com
export ZENDESK_API_TOKEN=your-api-token
export ZENDESK_BASE_URL=https://your-subdomain.zendesk.com/api/v2
\`\`\`

## Exports

Export data using:

\`\`\`bash
connect-zendesk tickets export --format csv -o tickets.csv
connect-zendesk users export --format csv -o users.csv
connect-zendesk organizations export --format csv -o orgs.csv
\`\`\`

Exported files are saved to the \`exports/\` directory.

## More Information

- CLI Help: \`connect-zendesk --help\`
- Documentation: https://github.com/hasna/connect-zendesk
- Zendesk API: https://developer.zendesk.com/api-reference/
`;

/**
 * Initialize the full config directory structure
 */
export function initConfigDir(): { created: string[]; existing: string[] } {
  const created: string[] = [];
  const existing: string[] = [];

  // Check for migration first
  const migration = migrateFromOldConfig();
  if (migration.migrated) {
    created.push(`[Migrated] ${migration.message}`);
  }

  // Base config directory
  if (!existsSync(BASE_CONFIG_DIR)) {
    mkdirSync(BASE_CONFIG_DIR, { recursive: true });
    created.push(BASE_CONFIG_DIR);
  } else {
    existing.push(BASE_CONFIG_DIR);
  }

  // Profiles directory
  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
    created.push(profilesDir);
  } else {
    existing.push(profilesDir);
  }

  // Default profile directory
  const defaultProfileDir = join(profilesDir, DEFAULT_PROFILE);
  if (!existsSync(defaultProfileDir)) {
    mkdirSync(defaultProfileDir, { recursive: true });
    created.push(defaultProfileDir);
  } else {
    existing.push(defaultProfileDir);
  }

  // Default profile config file
  const configFile = join(defaultProfileDir, 'config.json');
  if (!existsSync(configFile)) {
    writeFileSync(configFile, JSON.stringify({}, null, 2));
    created.push(configFile);
  } else {
    existing.push(configFile);
  }

  // Exports directory
  if (!existsSync(EXPORTS_DIR)) {
    mkdirSync(EXPORTS_DIR, { recursive: true });
    created.push(EXPORTS_DIR);
  } else {
    existing.push(EXPORTS_DIR);
  }

  // Log file
  if (!existsSync(LOG_FILE)) {
    writeFileSync(LOG_FILE, `# connect-zendesk log\n# Created: ${new Date().toISOString()}\n\n`);
    created.push(LOG_FILE);
  } else {
    existing.push(LOG_FILE);
  }

  // README file
  const readmeFile = join(BASE_CONFIG_DIR, 'README.md');
  if (!existsSync(readmeFile)) {
    writeFileSync(readmeFile, README_CONTENT);
    created.push(readmeFile);
  } else {
    existing.push(readmeFile);
  }

  // Current profile file
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

export function loadConfig(): ZendeskCliConfig {
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

export function saveConfig(config: ZendeskCliConfig): void {
  ensureConfigDir();
  const configFile = join(getProfileDir(), 'config.json');
  writeFileSync(configFile, JSON.stringify(config, null, 2));
}

export function getEmail(): string | undefined {
  // Priority: environment variable > config file
  return process.env.ZENDESK_EMAIL || loadConfig().email;
}

export function setEmail(email: string): void {
  const config = loadConfig();
  config.email = email;
  saveConfig(config);
}

export function getApiToken(): string | undefined {
  // Priority: environment variable > config file
  return process.env.ZENDESK_API_TOKEN || loadConfig().apiToken;
}

export function setApiToken(apiToken: string): void {
  const config = loadConfig();
  config.apiToken = apiToken;
  saveConfig(config);
}

export function getBaseUrl(): string | undefined {
  // Priority: environment variable > config file
  return process.env.ZENDESK_BASE_URL || loadConfig().baseUrl;
}

export function setBaseUrl(baseUrl: string): void {
  const config = loadConfig();
  config.baseUrl = baseUrl;
  saveConfig(config);
}

export function getDefaultAccount(): string | undefined {
  return loadConfig().defaultAccount;
}

export function setDefaultAccount(account: string): void {
  const config = loadConfig();
  config.defaultAccount = account;
  saveConfig(config);
}

export function clearConfig(): void {
  saveConfig({});
}

// The remote API host is deployment-specific and has no shippable default.
// Configure it with ZENDESK_REMOTE_API_URL or `connect-zendesk config set-remote-url <url>`.
export function findRemoteApiUrl(): string | undefined {
  return process.env.ZENDESK_REMOTE_API_URL || loadConfig().remoteApiUrl || undefined;
}

export function getRemoteApiUrl(): string {
  const url = findRemoteApiUrl();
  if (!url) {
    throw new Error(
      'Remote API URL is not configured. Set ZENDESK_REMOTE_API_URL or run: connect-zendesk config set-remote-url <url>',
    );
  }
  return url;
}

export function setRemoteApiUrl(url: string): void {
  const config = loadConfig();
  config.remoteApiUrl = url;
  saveConfig(config);
}

// ============================================
// Utility Functions
// ============================================

export function isAuthenticated(): boolean {
  const email = getEmail();
  const token = getApiToken();
  return email !== undefined && email !== '' && token !== undefined && token !== '';
}

export function getActiveProfileName(): string {
  return getCurrentProfile();
}
