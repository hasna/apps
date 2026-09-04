/**
 * Auth status detection and token management for the local auth server.
 * Reads connector CLAUDE.md files to determine auth type, checks profile
 * directories for stored credentials, and handles token operations.
 */

import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { randomBytes } from "crypto";
import { join } from "path";
import { getConnectorDocs } from "../lib/installer.js";
import { withWriteLock } from "../lib/lock.js";
import {
  getConnectorConfigDir as getPreferredConnectorConfigDir,
  getConnectorConfigReadDirs as getResolvedConnectorConfigReadDirs,
  normalizeConnectorName,
} from "../lib/connector-resolver.js";

/** Timeout for external HTTP requests (10 seconds) */
const FETCH_TIMEOUT = 10_000;
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

/** In-memory CSRF state store for OAuth flows */
const oauthStateStore = new Map<string, { connector: string; createdAt: number }>();

// Google OAuth2 endpoints
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

// Scopes per Google connector
const GOOGLE_SCOPES: Record<string, string> = {
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.labels",
    "https://mail.google.com/",
  ].join(" "),
  googlecalendar: [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
  ].join(" "),
  googledrive: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.file",
  ].join(" "),
  googledocs: [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.file",
  ].join(" "),
  googlesheets: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
  ].join(" "),
  googletasks: [
    "https://www.googleapis.com/auth/tasks",
  ].join(" "),
  googlecontacts: [
    "https://www.googleapis.com/auth/contacts",
    "https://www.googleapis.com/auth/contacts.readonly",
  ].join(" "),
  google: [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ].join(" "),
  "vertex-ai": [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ].join(" "),
};

export type AuthType = "oauth" | "apikey" | "bearer";

export interface AuthStatus {
  type: AuthType;
  configured: boolean;
  tokenExpiry?: number;
  hasRefreshToken?: boolean;
  hasOAuthCredentials?: boolean;
  envVars: { variable: string; description: string; set: boolean }[];
  envVarSetCount: number;
  envVarTotalCount: number;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

/**
 * Get the auth type for a connector by parsing its CLAUDE.md
 */
export function getAuthType(name: string): AuthType {
  name = normalizeConnectorName(name);
  const docs = getConnectorDocs(name);
  if (!docs?.auth) return "apikey";

  const authLower = docs.auth.toLowerCase();
  if (authLower.includes("oauth")) return "oauth";
  if (authLower.includes("bearer token")) return "bearer";
  return "apikey";
}

/**
 * Get the base config directory for a connector
 */
function getConnectorConfigDir(name: string): string {
  name = normalizeConnectorName(name);
  return getPreferredConnectorConfigDir(name);
}

function getConnectorConfigReadDirs(name: string): string[] {
  name = normalizeConnectorName(name);
  return getResolvedConnectorConfigReadDirs(name);
}

function chmodIfPossible(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Best-effort hardening for platforms/filesystems that support POSIX modes.
  }
}

function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodIfPossible(path, PRIVATE_DIR_MODE);
}

function writePrivateJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: PRIVATE_FILE_MODE });
  chmodIfPossible(path, PRIVATE_FILE_MODE);
}

function writePrivateText(path: string, data: string): void {
  writeFileSync(path, data, { mode: PRIVATE_FILE_MODE });
  chmodIfPossible(path, PRIVATE_FILE_MODE);
}

/**
 * Get the current profile name for a connector
 */
function getCurrentProfile(name: string): string {
  name = normalizeConnectorName(name);
  for (const configDir of getConnectorConfigReadDirs(name)) {
    const currentProfileFile = join(configDir, "current_profile");

    if (existsSync(currentProfileFile)) {
      try {
        return readFileSync(currentProfileFile, "utf-8").trim() || "default";
      } catch {
        return "default";
      }
    }
  }
  return "default";
}

function loadProfileConfigFromDir(configDir: string, profile: string): Record<string, unknown> {
  let flatConfig: Record<string, unknown> = {};
  let dirConfig: Record<string, unknown> = {};

  const profileFile = join(configDir, "profiles", `${profile}.json`);
  if (existsSync(profileFile)) {
    try {
      flatConfig = JSON.parse(readFileSync(profileFile, "utf-8"));
    } catch {
      // ignore parse errors
    }
  }

  const profileDirConfig = join(configDir, "profiles", profile, "config.json");
  if (existsSync(profileDirConfig)) {
    try {
      dirConfig = JSON.parse(readFileSync(profileDirConfig, "utf-8"));
    } catch {
      // ignore parse errors
    }
  }

  return { ...flatConfig, ...dirConfig };
}

/**
 * Load the profile config for a connector (handles both file patterns).
 * Checks both flat (profiles/<name>.json) and directory (profiles/<name>/config.json)
 * patterns and merges results. Directory pattern takes precedence when both exist.
 */
function loadProfileConfig(name: string): Record<string, unknown> {
  name = normalizeConnectorName(name);
  const profile = getCurrentProfile(name);
  const merged: Record<string, unknown> = {};

  // Read legacy first, then preferred, so prefixless config wins when both exist.
  for (const configDir of [...getConnectorConfigReadDirs(name)].reverse()) {
    Object.assign(merged, loadProfileConfigFromDir(configDir, profile));
  }

  return merged;
}

/**
 * Load OAuth tokens for a connector
 */
export function loadTokens(name: string): OAuthTokens | null {
  name = normalizeConnectorName(name);
  const profile = getCurrentProfile(name);

  for (const configDir of getConnectorConfigReadDirs(name)) {
    // Pattern 1: profiles/<name>/tokens.json (e.g., Gmail directory pattern)
    const tokensFile = join(configDir, "profiles", profile, "tokens.json");
    if (existsSync(tokensFile)) {
      try {
        return JSON.parse(readFileSync(tokensFile, "utf-8"));
      } catch {
        return null;
      }
    }
  }

  // Pattern 2: tokens stored in the profile config file itself
  // Some connectors (e.g. Google Calendar, Drive) store refreshToken/accessToken
  // directly in profiles/<name>.json or profiles/<name>/config.json
  const profileConfig = loadProfileConfig(name);
  if (profileConfig.refreshToken || profileConfig.accessToken) {
    return {
      accessToken: (profileConfig.accessToken as string) ?? "",
      refreshToken: profileConfig.refreshToken as string | undefined,
      expiresAt: (profileConfig.expiresAt as number) ?? 0,
      tokenType: profileConfig.tokenType as string | undefined,
      scope: profileConfig.scope as string | undefined,
    };
  }

  return null;
}

function isStoredOAuthEnvVarSet(
  variable: string,
  oauthConfig: { clientId?: string; clientSecret?: string },
  tokens: OAuthTokens | null,
  profileConfig: Record<string, unknown>
): boolean {
  if (variable.endsWith("_CLIENT_ID")) {
    return Boolean(oauthConfig.clientId || profileConfig.clientId);
  }
  if (variable.endsWith("_CLIENT_SECRET")) {
    return Boolean(oauthConfig.clientSecret || profileConfig.clientSecret);
  }
  if (variable.endsWith("_ACCESS_TOKEN")) {
    return Boolean(tokens?.accessToken || profileConfig.accessToken);
  }
  if (variable.endsWith("_REFRESH_TOKEN")) {
    return Boolean(tokens?.refreshToken || profileConfig.refreshToken);
  }
  if (variable.endsWith("_TOKEN_EXPIRES_AT")) {
    return Boolean(tokens?.expiresAt || profileConfig.expiresAt);
  }
  return false;
}

function envVarToConfigField(variable: string, connectorName: string): string {
  const connectorPrefix = normalizeConnectorName(connectorName).replace(/-/g, "_").toUpperCase();
  const suffix = variable.startsWith(`${connectorPrefix}_`)
    ? variable.slice(connectorPrefix.length + 1)
    : variable.split("_").slice(1).join("_");
  const parts = suffix.toLowerCase().split("_").filter(Boolean);

  return parts
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join("");
}

function isCredentialEnvVar(variable: string): boolean {
  return /(^|_)(API_KEY|API_SECRET|ACCESS_KEY_ID|SECRET_ACCESS_KEY|ACCESS_TOKEN|REFRESH_TOKEN|BEARER_TOKEN|SERVICE_ROLE_KEY|APP_KEY|SECRET_KEY|CONSUMER_KEY|CONSUMER_SECRET|CLIENT_ID|CLIENT_SECRET|PRIVATE_KEY|TOKEN|SECRET|KEY|PASSWORD|PASS|CREDENTIAL|CREDENTIALS)($|_)/.test(variable);
}

function isStoredApiEnvVarSet(
  variable: string,
  connectorName: string,
  profileConfig: Record<string, unknown>
): boolean {
  if (!isCredentialEnvVar(variable)) {
    return false;
  }

  const field = envVarToConfigField(variable, connectorName);
  if (typeof profileConfig[field] === "string" && profileConfig[field].length > 0) {
    return true;
  }

  if (variable.endsWith("_API_KEY")) {
    return typeof profileConfig.apiKey === "string" && profileConfig.apiKey.length > 0;
  }
  if (variable.endsWith("_TOKEN")) {
    return [profileConfig.token, profileConfig.accessToken, profileConfig.bearerToken].some(
      (value) => typeof value === "string" && value.length > 0
    );
  }
  return false;
}

function hasGenericStoredApiCredential(profileConfig: Record<string, unknown>): boolean {
  const credentialFields = [
    "apiKey",
    "apiSecret",
    "token",
    "accessToken",
    "refreshToken",
    "bearerToken",
    "secret",
    "secretToken",
    "key",
  ];

  return credentialFields.some(
    (field) => typeof profileConfig[field] === "string" && profileConfig[field].length > 0
  );
}

/**
 * Get the full auth status for a connector
 */
export function getAuthStatus(name: string): AuthStatus {
  name = normalizeConnectorName(name);
  const authType = getAuthType(name);
  const docs = getConnectorDocs(name);
  const oauthConfig = authType === "oauth" ? getOAuthConfig(name) : {};
  const tokens = authType === "oauth" ? loadTokens(name) : null;
  const profileConfig = loadProfileConfig(name);

  // Build env vars list with set/unset status (process env + stored credentials)
  const envVars = (docs?.envVars || []).map((v) => ({
    variable: v.variable,
    description: v.description,
    set:
      !!process.env[v.variable] ||
      (authType === "oauth" &&
        isStoredOAuthEnvVarSet(v.variable, oauthConfig, tokens, profileConfig)) ||
      ((authType === "apikey" || authType === "bearer") &&
        isStoredApiEnvVarSet(v.variable, name, profileConfig)),
  }));

  const envVarTotalCount = envVars.length;
  const envVarSetCount = envVars.filter((v) => v.set).length;

  if (authType === "oauth") {
    const hasTokens = !!tokens?.accessToken || !!(profileConfig.accessToken);
    const hasRefreshToken = !!tokens?.refreshToken || !!(profileConfig.refreshToken);
    const tokenExpiry = tokens?.expiresAt || (profileConfig.expiresAt as number | undefined);
    const hasOAuthCredentials = Boolean(oauthConfig.clientId && oauthConfig.clientSecret);
    const hasEnvVar = (docs?.envVars || []).some((v) =>
      isCredentialEnvVar(v.variable) &&
      (
        !!process.env[v.variable] ||
        isStoredOAuthEnvVarSet(v.variable, oauthConfig, tokens, profileConfig)
      )
    );

    return {
      type: "oauth",
      configured: hasTokens || hasRefreshToken || hasOAuthCredentials || hasEnvVar,
      tokenExpiry,
      hasRefreshToken,
      hasOAuthCredentials,
      envVars,
      envVarSetCount,
      envVarTotalCount,
    };
  }

  // API key / Bearer token
  const hasEnvVar = (docs?.envVars || []).some((v) =>
    isCredentialEnvVar(v.variable) &&
    (
      !!process.env[v.variable] ||
      isStoredApiEnvVarSet(v.variable, name, profileConfig)
    )
  );
  const hasKey = envVarTotalCount === 0 && hasGenericStoredApiCredential(profileConfig);

  return {
    type: authType,
    configured: hasKey || hasEnvVar,
    envVars,
    envVarSetCount,
    envVarTotalCount,
  };
}

/**
 * Get required env var names from a connector's CLAUDE.md
 */
export function getEnvVars(name: string): { variable: string; description: string }[] {
  name = normalizeConnectorName(name);
  const docs = getConnectorDocs(name);
  return docs?.envVars || [];
}

/**
 * Save an API key to a connector's profile
 */
export async function saveApiKey(name: string, key: string, field?: string): Promise<void> {
  name = normalizeConnectorName(name);
  return withWriteLock(name, () => _saveApiKey(name, key, field));
}

function _saveApiKey(name: string, key: string, field?: string): void {
  name = normalizeConnectorName(name);
  const configDir = getConnectorConfigDir(name);
  const profile = getCurrentProfile(name);

  // Determine which field to save the key as
  const keyField = field || guessKeyField(name);

  // OAuth client credentials (clientId, clientSecret) belong in credentials.json
  // at the connector root, not in a profile config. Gmail's loadBaseConfig() reads
  // from there, and these are shared across all profiles.
  if (keyField === "clientId" || keyField === "clientSecret") {
    const credentialsFile = join(configDir, "credentials.json");
    ensurePrivateDir(configDir);
    let creds: Record<string, unknown> = {};
    if (existsSync(credentialsFile)) {
      try { creds = JSON.parse(readFileSync(credentialsFile, "utf-8")); } catch { /* use empty */ }
    }
    creds[keyField] = key;
    writePrivateJson(credentialsFile, creds);
    return;
  }

  // Try pattern 1: profiles/<name>.json
  const profilesDir = join(configDir, "profiles");
  const profileFile = join(profilesDir, `${profile}.json`);
  const profileDir = join(profilesDir, profile);

  if (existsSync(profileFile)) {
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(readFileSync(profileFile, "utf-8")); } catch { /* use empty */ }
    config[keyField] = key;
    ensurePrivateDir(configDir);
    ensurePrivateDir(profilesDir);
    writePrivateJson(profileFile, config);
    return;
  }

  // Try pattern 2: profiles/<name>/config.json
  if (existsSync(profileDir)) {
    const configFile = join(profileDir, "config.json");
    let config: Record<string, unknown> = {};
    if (existsSync(configFile)) {
      try { config = JSON.parse(readFileSync(configFile, "utf-8")); } catch { /* use empty */ }
    }
    config[keyField] = key;
    ensurePrivateDir(configDir);
    ensurePrivateDir(profilesDir);
    ensurePrivateDir(profileDir);
    writePrivateJson(configFile, config);
    return;
  }

  // Create new profile using directory pattern (profiles/<name>/config.json)
  // This matches what connector CLIs expect
  ensurePrivateDir(configDir);
  ensurePrivateDir(profilesDir);
  ensurePrivateDir(profileDir);
  writePrivateJson(join(profileDir, "config.json"), { [keyField]: key });
}

/**
 * Guess the key field name based on connector name
 */
function guessKeyField(name: string): string {
  name = normalizeConnectorName(name);
  const docs = getConnectorDocs(name);
  if (!docs?.envVars.length) return "apiKey";

  // Find the primary key env var and derive the field name
  const keyVar = docs.envVars.find(
    (v) =>
      v.variable.includes("API_KEY") ||
      v.variable.includes("API_SECRET") ||
      v.variable.includes("TOKEN") ||
      v.variable.includes("SECRET")
  );

  if (keyVar) {
    // Convert STRIPE_API_KEY -> apiKey
    const parts = keyVar.variable.toLowerCase().split("_");
    // Remove the connector prefix (e.g., "stripe" or "split_io")
    const connectorParts = name.toLowerCase().split(/[-_]/);
    const prefixLength = connectorParts.every((part, index) => parts[index] === part)
      ? connectorParts.length
      : 1;
    const withoutPrefix = parts.slice(prefixLength);
    if (withoutPrefix.length > 0) {
      return withoutPrefix
        .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
        .join("");
    }
  }

  return "apiKey";
}

/**
 * Get OAuth client credentials for a connector
 */
export function getOAuthConfig(name: string): { clientId?: string; clientSecret?: string } {
  name = normalizeConnectorName(name);
  for (const configDir of getConnectorConfigReadDirs(name)) {
    // Check credentials.json at base level (shared across profiles)
    const credentialsFile = join(configDir, "credentials.json");
    if (existsSync(credentialsFile)) {
      try {
        const creds = JSON.parse(readFileSync(credentialsFile, "utf-8"));
        return { clientId: creds.clientId, clientSecret: creds.clientSecret };
      } catch {
        // fall through
      }
    }
  }

  // Check profile config
  const config = loadProfileConfig(name);
  return {
    clientId: config.clientId as string | undefined,
    clientSecret: config.clientSecret as string | undefined,
  };
}

/**
 * Build OAuth authorization URL for a connector
 */
export function getOAuthStartUrl(name: string, redirectUri: string): string | null {
  name = normalizeConnectorName(name);
  const oauthConfig = getOAuthConfig(name);
  if (!oauthConfig.clientId) return null;

  const scopes = GOOGLE_SCOPES[name];
  if (!scopes) return null;

  // Generate CSRF state token
  const state = randomBytes(32).toString("hex");
  oauthStateStore.set(state, { connector: name, createdAt: Date.now() });

  // Clean up stale state entries (older than 10 minutes)
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of oauthStateStore) {
    if (val.createdAt < tenMinutesAgo) oauthStateStore.delete(key);
  }

  const params = new URLSearchParams({
    client_id: oauthConfig.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Validate and consume an OAuth state token (CSRF protection)
 */
export function validateOAuthState(state: string | null, expectedConnector: string): boolean {
  expectedConnector = normalizeConnectorName(expectedConnector);
  if (!state) return false;
  const entry = oauthStateStore.get(state);
  if (!entry || entry.connector !== expectedConnector) return false;
  oauthStateStore.delete(state);
  // Reject if older than 10 minutes
  return Date.now() - entry.createdAt < 10 * 60 * 1000;
}

/**
 * Exchange an OAuth authorization code for tokens
 */
export async function exchangeOAuthCode(
  name: string,
  code: string,
  redirectUri: string
): Promise<OAuthTokens> {
  name = normalizeConnectorName(name);
  const oauthConfig = getOAuthConfig(name);
  if (!oauthConfig.clientId || !oauthConfig.clientSecret) {
    throw new Error("OAuth credentials not configured for " + name);
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(
      `Token exchange failed: ${(error as Record<string, string>).error_description || (error as Record<string, string>).error || response.statusText}`
    );
  }

  const data = (await response.json()) as Record<string, unknown>;

  const tokens: OAuthTokens = {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresAt: Date.now() + (data.expires_in as number) * 1000,
    tokenType: data.token_type as string,
    scope: data.scope as string,
  };

  // Save tokens
  saveOAuthTokens(name, tokens);
  return tokens;
}

/**
 * Save OAuth tokens to the connector's profile directory
 */
function saveOAuthTokens(name: string, tokens: OAuthTokens): void {
  name = normalizeConnectorName(name);
  const configDir = getConnectorConfigDir(name);
  const profile = getCurrentProfile(name);
  const profilesDir = join(configDir, "profiles");
  const profileDir = join(profilesDir, profile);

  ensurePrivateDir(configDir);
  ensurePrivateDir(profilesDir);
  ensurePrivateDir(profileDir);
  const tokensFile = join(profileDir, "tokens.json");
  writePrivateJson(tokensFile, tokens);
}

/**
 * Refresh an OAuth token using the stored refresh token.
 * Serialized with a per-connector write lock to prevent concurrent agents
 * from racing on token refresh (double-refresh race condition).
 */
export async function refreshOAuthToken(name: string): Promise<OAuthTokens> {
  name = normalizeConnectorName(name);
  return withWriteLock(name, () => _refreshOAuthToken(name));
}

async function _refreshOAuthToken(name: string): Promise<OAuthTokens> {
  name = normalizeConnectorName(name);
  const oauthConfig = getOAuthConfig(name);
  const currentTokens = loadTokens(name);

  if (!oauthConfig.clientId || !oauthConfig.clientSecret) {
    throw new Error("OAuth credentials not configured for " + name);
  }

  if (!currentTokens?.refreshToken) {
    throw new Error("No refresh token available. Please re-authenticate.");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      refresh_token: currentTokens.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(
      `Token refresh failed: ${(error as Record<string, string>).error_description || (error as Record<string, string>).error}`
    );
  }

  const data = (await response.json()) as Record<string, unknown>;

  const tokens: OAuthTokens = {
    accessToken: data.access_token as string,
    refreshToken: currentTokens.refreshToken,
    expiresAt: Date.now() + (data.expires_in as number) * 1000,
    tokenType: data.token_type as string,
    scope: (data.scope as string) || currentTokens.scope,
  };

  saveOAuthTokens(name, tokens);
  return tokens;
}

/**
 * Get token expiry time for an OAuth connector
 */
export function getTokenExpiry(name: string): number | null {
  name = normalizeConnectorName(name);
  const tokens = loadTokens(name);
  return tokens?.expiresAt || null;
}

/**
 * List all profile names for a connector.
 * Reads ~/.hasna/connectors/{name}/profiles/ and legacy connect-{name} entries -
 * both .json files (pattern 1) and subdirectories (pattern 2).
 */
export function listProfiles(name: string): string[] {
  name = normalizeConnectorName(name);
  const seen = new Set<string>();
  for (const configDir of getConnectorConfigReadDirs(name)) {
    const profilesDir = join(configDir, "profiles");
    if (!existsSync(profilesDir)) continue;

    try {
      const entries = readdirSync(profilesDir);
      for (const entry of entries) {
        const fullPath = join(profilesDir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          // Pattern 2: profiles/<name>/ directory
          seen.add(entry);
        } else if (entry.endsWith(".json")) {
          // Pattern 1: profiles/<name>.json file
          seen.add(entry.replace(/\.json$/, ""));
        }
      }
    } catch {
      // If we can't read the directory, keep checking other dirs.
    }
  }

  // Ensure "default" is always present
  seen.add("default");

  return Array.from(seen).sort();
}

/**
 * Switch the active profile for a connector.
 * Writes the profile name to ~/.hasna/connectors/{name}/current_profile
 */
export function switchProfile(name: string, profile: string): void {
  name = normalizeConnectorName(name);
  const configDir = getConnectorConfigDir(name);
  ensurePrivateDir(configDir);
  writePrivateText(join(configDir, "current_profile"), profile);
}

/**
 * Delete a profile for a connector.
 * Removes the profile file or directory from ~/.hasna/connectors/{name}/profiles/.
 * Refuses to delete the "default" profile.
 * Returns true if deletion succeeded, false if profile not found or is "default".
 */
export function deleteProfile(name: string, profile: string): boolean {
  name = normalizeConnectorName(name);
  if (profile === "default") return false;

  const configDir = getConnectorConfigDir(name);
  const profilesDir = join(configDir, "profiles");

  // Try pattern 1: profiles/<name>.json
  const profileFile = join(profilesDir, `${profile}.json`);
  if (existsSync(profileFile)) {
    rmSync(profileFile);
    // If this was the current profile, switch back to default
    if (getCurrentProfile(name) === profile) {
      switchProfile(name, "default");
    }
    return true;
  }

  // Try pattern 2: profiles/<name>/ directory
  const profileDir = join(profilesDir, profile);
  if (existsSync(profileDir)) {
    rmSync(profileDir, { recursive: true });
    if (getCurrentProfile(name) === profile) {
      switchProfile(name, "default");
    }
    return true;
  }

  return false;
}
